-- 선택 참여한 러너의 검증 완료 거리만 정원 보상으로 적립한다. 원장은 재추첨과
-- 삭제 후 재전송을 막되 GPS를 보관하지 않으며, 방문은 단일 관계·공개 판정을 따른다.
begin;
create table private.garden_catalog (
  id text primary key, name text not null, icon text not null,
  rarity text not null check (rarity in ('common','rare')), weight integer not null check(weight > 0)
);
insert into private.garden_catalog values
 ('flower','햇살 꽃','🌼','common',25), ('tree','작은 나무','🌳','common',20),
 ('rock','동글 돌','🪨','common',10), ('mushroom','달빛 버섯','🍄','rare',3),
 ('fountain','별빛 분수','⛲','rare',2);
create function private.garden_policy() returns jsonb language sql immutable as $$
 select '{"version":1,"dropMeters":500,"expansionMeters":42000,"initialCells":16,"growthCells":4,"noDropWeight":40}'::jsonb
$$;
create table private.gardens (
 owner_id uuid primary key references public.profiles(id) on delete cascade,
 enabled_at timestamptz not null default now(), meters numeric not null default 0,
 visibility text not null default 'private' check(visibility in ('private','friends','matching')),
 revision integer not null default 0, placements jsonb not null default '[]'
);
create table private.garden_inventory (
 owner_id uuid references private.gardens(owner_id) on delete cascade,
 item_id text references private.garden_catalog(id), quantity integer not null check(quantity > 0),
 primary key(owner_id,item_id)
);
create table private.garden_credits (
 owner_id uuid references private.gardens(owner_id) on delete cascade,
 session_id uuid not null, source_key text, opportunities integer not null,
 rewards jsonb not null, expansions integer not null, policy_version integer not null,
 primary key(owner_id,session_id), unique(owner_id,source_key)
);
revoke all on private.garden_catalog,private.gardens,private.garden_inventory,private.garden_credits from public,anon,authenticated;

create function private.can_visit_garden(p_owner uuid) returns boolean
language sql stable security definer set search_path = public,private as $$
 select auth.uid() = p_owner or (
 private.pair_contact_allowed(auth.uid(),p_owner)
 and not exists(select 1 from public.account_deletion_requests where user_id in(auth.uid(),p_owner) and cancelled_at is null and completed_at is null)
 and private.consent_granted(auth.uid(),'terms') and private.consent_granted(auth.uid(),'privacy')
 and private.consent_granted(p_owner,'terms') and private.consent_granted(p_owner,'privacy')
 and not private.has_active_moderation_action(auth.uid(),array['visibility_restriction'])
 and not private.has_active_moderation_action(p_owner,array['visibility_restriction'])
 and exists(select 1 from private.gardens g where g.owner_id=p_owner and (
   (g.visibility in ('friends','matching') and private.can_pair_message(auth.uid(),p_owner))
   or (g.visibility='matching' and private.is_pair_visible(p_owner) and exists(
     select 1 from public.encounter_candidates where viewer_id=auth.uid() and candidate_profile_id=p_owner and expires_at>now()))
 )))
$$;

create function public.start_garden() returns void language plpgsql security definer set search_path=public,private as $$
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 insert into private.gardens(owner_id) values(auth.uid()) on conflict do nothing;
 if found then
   insert into private.garden_inventory values(auth.uid(),'flower',1),(auth.uid(),'tree',1),(auth.uid(),'rock',1);
 end if;
end $$;

create function private.credit_garden_run() returns trigger language plpgsql security definer set search_path=public,private as $$
declare g private.gardens; p jsonb:=private.garden_policy(); n integer; growth integer; i integer;
 item record; picked text; roll double precision; cumulative integer; total integer; rewards jsonb:='{}'; run_source_key text;
begin
 if new.status <> 'completed' or new.gps_quality_summary->>'server_validated' is distinct from 'true'
 or jsonb_typeof(new.gps_quality_summary->'rejection_reasons') is distinct from 'array'
 or (new.gps_quality_summary->'rejection_reasons' - 'distance_below_3km') <> '[]'::jsonb then return new; end if;
 select * into g from private.gardens where owner_id=new.user_id for update;
 if not found or new.created_at < g.enabled_at then return new; end if;
 run_source_key:=case when new.source_record_id is not null then new.source::text||':'||new.source_record_id end;
 if exists(select 1 from private.garden_credits c where c.owner_id=new.user_id and (c.session_id=new.id or c.source_key=run_source_key)) then return new; end if;
 n:=floor((g.meters+new.distance_meters)/(p->>'dropMeters')::integer)-floor(g.meters/(p->>'dropMeters')::integer);
 growth:=floor((g.meters+new.distance_meters)/(p->>'expansionMeters')::integer)-floor(g.meters/(p->>'expansionMeters')::integer);
 select sum(weight)+(p->>'noDropWeight')::integer into total from private.garden_catalog;
 for i in 1..n loop
   roll:=random()*total; cumulative:=(p->>'noDropWeight')::integer; picked:=null;
   if roll>=cumulative then
     for item in select * from private.garden_catalog order by id loop
       cumulative:=cumulative+item.weight;
       if roll<cumulative then picked:=item.id; exit; end if;
     end loop;
   end if;
   if picked is not null then
     insert into private.garden_inventory values(new.user_id,picked,1)
       on conflict(owner_id,item_id) do update set quantity=private.garden_inventory.quantity+1;
     rewards:=jsonb_set(rewards,array[picked],to_jsonb(coalesce((rewards->>picked)::integer,0)+1));
   end if;
 end loop;
 insert into private.garden_credits values(new.user_id,new.id,run_source_key,n,rewards,growth,(p->>'version')::integer);
 update private.gardens set meters=meters+new.distance_meters where owner_id=new.user_id;
 return new;
end $$;
create trigger garden_run_completion after insert or update of status on public.running_sessions
 for each row execute function private.credit_garden_run();

create function public.get_garden(p_owner uuid) returns jsonb language plpgsql security definer set search_path=public,private as $$
declare g private.gardens; result jsonb; p jsonb:=private.garden_policy();
begin
 if not coalesce(private.can_visit_garden(p_owner),false) then raise exception '정원을 볼 수 없어요. 공개 설정이나 관계가 변경되었어요.' using errcode='42501'; end if;
 select * into g from private.gardens where owner_id=p_owner;
 if not found then return null; end if;
 result:=jsonb_build_object('ownerId',p_owner,'nickname',(select nickname from public.profiles where id=p_owner),
 'cellCount',(p->>'initialCells')::integer+floor(g.meters/(p->>'expansionMeters')::integer)*(p->>'growthCells')::integer,
 'placements',g.placements,'catalog',(select jsonb_agg(to_jsonb(c) order by id) from private.garden_catalog c));
 if auth.uid()=p_owner then result:=result||jsonb_build_object('policy',p,'meters',g.meters,'revision',g.revision,'visibility',g.visibility,
 'inventory',coalesce((select jsonb_object_agg(item_id,quantity) from private.garden_inventory where owner_id=p_owner),'{}'));
 end if;
 return result;
end $$;

create function public.save_garden(p_revision integer,p_placements jsonb,p_visibility text) returns void
language plpgsql security definer set search_path=public,private as $$
declare g private.gardens; p jsonb:=private.garden_policy(); cells integer;
begin
 select * into g from private.gardens where owner_id=auth.uid() for update;
 if not found then raise exception 'Authentication or garden required' using errcode='42501'; end if;
 if p_revision is distinct from g.revision then raise exception '다른 화면에서 정원이 변경되었어요. 새로고침 후 다시 꾸며주세요.' using errcode='40001'; end if;
 cells:=(p->>'initialCells')::integer+floor(g.meters/(p->>'expansionMeters')::integer)*(p->>'growthCells')::integer;
 if p_visibility is null or p_visibility not in ('private','friends','matching') or jsonb_typeof(p_placements) is distinct from 'array' then raise exception 'Invalid garden layout' using errcode='22023'; end if;
 if jsonb_array_length(p_placements)>cells or exists(
 select 1 from jsonb_array_elements(p_placements) x where jsonb_typeof(x) <> 'object' or x->>'cell' is null or x->>'itemId' is null
 or x->>'cell' !~ '^(0|[1-9][0-9]*)$' or (x->>'cell')::numeric>=cells or not exists(select 1 from private.garden_catalog where id=x->>'itemId'))
 or (select count(*)<>count(distinct x->>'cell') from jsonb_array_elements(p_placements) x)
 or exists(select 1 from jsonb_array_elements(p_placements) x group by x->>'itemId' having count(*)>coalesce((select quantity from private.garden_inventory where owner_id=auth.uid() and item_id=x->>'itemId'),0))
 then raise exception 'Invalid garden layout' using errcode='22023'; end if;
 -- Rebuild projection: never persist arbitrary client metadata for visitors.
 update private.gardens set placements=coalesce((select jsonb_agg(jsonb_build_object('cell',(x->>'cell')::integer,'itemId',x->>'itemId')) from jsonb_array_elements(p_placements) x),'[]'),
 visibility=p_visibility,revision=revision+1 where owner_id=auth.uid();
end $$;

create function public.garden_friends() returns jsonb language sql stable security definer set search_path=public,private as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'nickname',p.nickname) order by p.nickname),'[]')
 from public.profiles p where p.id<>auth.uid() and private.can_pair_message(auth.uid(),p.id) and private.can_visit_garden(p.id)
$$;
create function public.run_garden_rewards(p_session uuid) returns jsonb language plpgsql security definer set search_path=public,private as $$
declare s public.running_sessions; c private.garden_credits;
begin
 select * into s from public.running_sessions where id=p_session and user_id=auth.uid();
 if not found then raise exception 'Run unavailable' using errcode='42501'; end if;
 select * into c from private.garden_credits where session_id=s.id and owner_id=auth.uid();
 return jsonb_build_object('status',case when c.session_id is not null then 'credited' when s.status='processing' then 'processing' else 'not_credited' end,
 'opportunities',c.opportunities,'rewards',coalesce(c.rewards,'{}'),'expansions',coalesce(c.expansions,0),
 'catalog',(select jsonb_agg(to_jsonb(i) order by id) from private.garden_catalog i));
end $$;
revoke all on function private.garden_policy(),private.can_visit_garden(uuid),private.credit_garden_run() from public,anon,authenticated;
revoke all on function public.start_garden(),public.get_garden(uuid),public.save_garden(integer,jsonb,text),public.garden_friends(),public.run_garden_rewards(uuid) from public,anon,authenticated;
grant execute on function public.start_garden(),public.get_garden(uuid),public.save_garden(integer,jsonb,text),public.garden_friends(),public.run_garden_rewards(uuid) to authenticated;
commit;
