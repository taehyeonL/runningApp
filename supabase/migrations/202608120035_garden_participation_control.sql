-- 선택 참여를 철회해도 정원·아이템·무료 기록 권리는 유지한다. 재개 전 또는
-- 가입 전 워치 기록을 늦게 전송해 소급 지급받지 않도록 실제 시작 시점을 검사한다.
begin;
alter table private.gardens add column collecting boolean not null default true;
create or replace function private.credit_garden_run() returns trigger language plpgsql security definer set search_path=public,private as $$
declare g private.gardens; p jsonb:=private.garden_policy(); n integer; growth integer; i integer;
 item record; picked text; roll double precision; cumulative integer; total integer; rewards jsonb:='{}'; run_source_key text;
begin
 if new.status <> 'completed' or new.gps_quality_summary->>'server_validated' is distinct from 'true'
 or jsonb_typeof(new.gps_quality_summary->'rejection_reasons') is distinct from 'array'
 or ((new.gps_quality_summary->'rejection_reasons') - 'distance_below_3km') <> '[]'::jsonb then return new; end if;
 select * into g from private.gardens where owner_id=new.user_id for update;
 if not found or not g.collecting or new.started_at < g.enabled_at then return new; end if;
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
create or replace function public.get_garden(p_owner uuid) returns jsonb language plpgsql security definer set search_path=public,private as $$
declare g private.gardens; result jsonb; p jsonb:=private.garden_policy();
begin
 if not coalesce(private.can_visit_garden(p_owner),false) then raise exception '정원을 볼 수 없어요. 공개 설정이나 관계가 변경되었어요.' using errcode='42501'; end if;
 select * into g from private.gardens where owner_id=p_owner;
 if not found then return null; end if;
 result:=jsonb_build_object('ownerId',p_owner,'nickname',(select nickname from public.profiles where id=p_owner),
 'cellCount',(p->>'initialCells')::integer+floor(g.meters/(p->>'expansionMeters')::integer)*(p->>'growthCells')::integer,
 'placements',g.placements,'catalog',(select jsonb_agg(to_jsonb(c) order by id) from private.garden_catalog c));
 if auth.uid()=p_owner then result:=result||jsonb_build_object('collecting',g.collecting,'policy',p,'meters',g.meters,'revision',g.revision,'visibility',g.visibility,
 'inventory',coalesce((select jsonb_object_agg(item_id,quantity) from private.garden_inventory where owner_id=p_owner),'{}'));
 end if;
 return result;
end $$;


create function public.set_garden_collecting(p_collecting boolean) returns void language plpgsql security definer set search_path=public,private as $$
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_collecting is null then raise exception 'Invalid participation' using errcode='22023'; end if;
 update private.gardens set collecting=p_collecting, enabled_at=case when p_collecting and not collecting then now() else enabled_at end
 where owner_id=auth.uid();
end $$;
revoke all on function public.set_garden_collecting(boolean) from public,anon,authenticated;
grant execute on function public.set_garden_collecting(boolean) to authenticated;
commit;

