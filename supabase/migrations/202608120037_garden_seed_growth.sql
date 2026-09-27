-- 기존 완성 장식과 배치를 보존하면서 씨앗·개체별 성장·본인 도감을 추가한다.
-- 성장은 기존 검증 보상 원장의 INSERT에만 연결해 지급 자격·중복 판정을 재사용한다.
-- 시간/습관은 서버 내부에서만 판정하며 방문 응답에는 모습과 단계만 보낸다.
begin;
alter table private.garden_catalog drop constraint garden_catalog_weight_check;
alter table private.garden_catalog add constraint garden_catalog_weight_check check(weight >= 0);
alter table private.garden_catalog
 add column kind text not null default 'decoration' check(kind in ('decoration','seed')),
 add column mature_name text,
 add column mature_icon text,
 add column growth_meters integer not null default 0 check(growth_meters >= 0),
 add column trait text not null default 'none' check(trait in ('none','day','evening','steady','comeback')),
 add column tree_neighbor boolean not null default false,
 add column description text not null default '정원을 꾸미는 장식이에요. 성장이 필요하지 않아요.';
update private.garden_catalog set weight=0 where id in ('flower','tree','mushroom');
insert into private.garden_catalog(id,name,icon,rarity,weight,kind,mature_name,mature_icon,growth_meters,trait,tree_neighbor,description) values
 ('sun_seed','해바라기 씨앗','🌰','common',15,'seed','해바라기','🌻',5000,'day',false,'햇살형 · 한국 시간 06~18시 시작 러닝에 성장 +20%. 다른 시간에도 자라요.'),
 ('tree_seed','참나무 씨앗','🌰','common',10,'seed','참나무','🌳',10000,'none',false,'여러 번의 러닝을 차곡차곡 모아 자라요. 완성되면 이웃 식물의 쉼터가 돼요.'),
 ('clover_seed','클로버 씨앗','🌰','common',10,'seed','클로버','🍀',3000,'steady',false,'꾸준형 · 최근 7일 중 서로 다른 3일째 러닝부터 성장 +20%. 연속 출석은 필요 없어요.'),
 ('spring_seed','봄맞이꽃 씨앗','🌰','common',5,'seed','봄맞이꽃','🌸',3000,'comeback',false,'첫걸음형 · 정원 첫 러닝 또는 7일 이상 쉬고 돌아온 날 성장 +20%. 쉬어도 시들지 않아요.'),
 ('fern_spore','숲고사리 포자','✧','common',5,'seed','숲고사리','🌿',4000,'none',true,'이웃형 · 완성된 나무의 상하좌우 옆에서 성장 +10%. 혼자 있어도 잘 자라요.'),
 ('moon_spore','달빛 버섯 포자','✧','rare',3,'seed','달빛 버섯','🍄',5000,'evening',true,'달빛형 · 한국 시간 18~22시 시작 러닝에 +20%, 완성된 나무 옆에서 +10%. 심야 추가 보상은 없어요.');
create or replace function private.garden_policy() returns jsonb language sql immutable as $$
 select '{"version":2,"dropMeters":500,"expansionMeters":42000,"initialCells":16,"growthCells":4,"noDropWeight":40,"traitBonusPercent":20,"neighborBonusPercent":10,"dayStart":6,"dayEnd":18,"eveningEnd":22,"steadyDays":3,"steadyWindowDays":7,"comebackDays":7}'::jsonb
$$;
alter table private.gardens add column seed_gift_claimed boolean not null default false,
 add column layout_updated_at timestamptz not null default now();
create table private.garden_plants (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references private.gardens(owner_id) on delete cascade,
 item_id text not null references private.garden_catalog(id),
 cell integer check(cell >= 0),
 growth numeric not null default 0 check(growth >= 0),
 positioned_at timestamptz not null default now(),
 unique(owner_id,cell)
);
create table private.garden_collection (
 owner_id uuid not null references private.gardens(owner_id) on delete cascade,
 item_id text not null references private.garden_catalog(id),
 completed boolean not null default false,
 primary key(owner_id,item_id)
);
create table private.garden_growth_days (
 owner_id uuid not null references private.gardens(owner_id) on delete cascade,
 run_day date not null, comeback boolean not null,
 primary key(owner_id,run_day)
);
revoke all on private.garden_plants,private.garden_collection,private.garden_growth_days from public,anon,authenticated;
alter table private.garden_plants enable row level security;
alter table private.garden_collection enable row level security;
alter table private.garden_growth_days enable row level security;
insert into private.garden_collection(owner_id,item_id,completed)
 select owner_id,item_id,true from private.garden_inventory;

create function private.discover_garden_item() returns trigger language plpgsql security definer set search_path=public,private as $$
begin
 insert into private.garden_collection(owner_id,item_id,completed)
 select new.owner_id,new.item_id,kind='decoration' from private.garden_catalog where id=new.item_id
 on conflict(owner_id,item_id) do nothing;
 return new;
end $$;
create trigger garden_item_discovered after insert on private.garden_inventory for each row execute function private.discover_garden_item();

-- Preserve the old, tested snapshot/placement predicates instead of duplicating them.
alter function public.get_garden(uuid) set schema private;
alter function private.get_garden(uuid) rename to garden_base_snapshot;
revoke all on function private.garden_base_snapshot(uuid) from public,anon,authenticated;
create function public.get_garden(p_owner uuid) returns jsonb language plpgsql security definer set search_path=public,private as $$
declare result jsonb:=private.garden_base_snapshot(p_owner); plants jsonb;
begin
 if result is null then return null; end if;
 select coalesce(jsonb_agg(jsonb_build_object('cell',p.cell,'itemId',p.item_id,
 'stage',least(4,floor(p.growth/c.growth_meters*4)::integer)) order by p.cell),'[]') into plants
 from private.garden_plants p join private.garden_catalog c on c.id=p.item_id where p.owner_id=p_owner and p.cell is not null;
 result:=jsonb_set(result,'{placements}',(result->'placements')||plants);
 if auth.uid()=p_owner then
  result:=result||jsonb_build_object('plants',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'itemId',p.item_id,'cell',p.cell,
   'progress',least(100,floor(p.growth/c.growth_meters*100)::integer)) order by p.id)
   from private.garden_plants p join private.garden_catalog c on c.id=p.item_id where p.owner_id=p_owner),'[]'),
   'collection',coalesce((select jsonb_object_agg(item_id,case when completed then 'completed' else 'discovered' end) from private.garden_collection where owner_id=p_owner),'{}'));
 end if;
 return result;
end $$;
alter function public.start_garden() set schema private;
alter function private.start_garden() rename to start_garden_base;
revoke all on function private.start_garden_base() from public,anon,authenticated;
create function public.start_garden() returns void language plpgsql security definer set search_path=public,private as $$
begin
 perform private.start_garden_base();
 update private.gardens set seed_gift_claimed=true where owner_id=auth.uid() and not seed_gift_claimed;
 if found then
  insert into private.garden_inventory values(auth.uid(),'sun_seed',1),(auth.uid(),'clover_seed',1)
  on conflict(owner_id,item_id) do update set quantity=private.garden_inventory.quantity+1;
 end if;
end $$;

create function private.lock_garden_revision(p_revision integer) returns private.gardens
language plpgsql security definer set search_path=public,private as $$
declare g private.gardens;
begin
 select * into g from private.gardens where owner_id=auth.uid() for update;
 if not found then raise exception 'Authentication or garden required' using errcode='42501'; end if;
 if p_revision is distinct from g.revision then raise exception '다른 화면에서 정원이 변경되었어요. 새로고침 후 다시 꾸며주세요.' using errcode='40001'; end if;
 return g;
end $$;
create function private.garden_cell_available(g private.gardens,p_cell integer) returns boolean
language sql stable security definer set search_path=public,private as $$
 select p_cell is not null and p_cell>=0 and p_cell < (private.garden_policy()->>'initialCells')::integer
  +floor(g.meters/(private.garden_policy()->>'expansionMeters')::integer)*(private.garden_policy()->>'growthCells')::integer
 and not exists(select 1 from jsonb_array_elements(g.placements) x where (x->>'cell')::integer=p_cell)
 and not exists(select 1 from private.garden_plants where owner_id=g.owner_id and cell=p_cell)
$$;
create function public.plant_garden_seed(p_item text,p_cell integer,p_revision integer) returns void
language plpgsql security definer set search_path=public,private as $$
declare g private.gardens:=private.lock_garden_revision(p_revision); qty integer;
begin
 if not private.garden_cell_available(g,p_cell) or not exists(select 1 from private.garden_catalog where id=p_item and kind='seed') then
  raise exception '빈 칸과 씨앗을 선택해 주세요.' using errcode='22023'; end if;
 select quantity into qty from private.garden_inventory where owner_id=auth.uid() and item_id=p_item;
 if coalesce(qty,0)<1 then raise exception '보유한 씨앗이 없어요.' using errcode='22023'; end if;
 if qty=1 then delete from private.garden_inventory where owner_id=auth.uid() and item_id=p_item;
 else update private.garden_inventory set quantity=quantity-1 where owner_id=auth.uid() and item_id=p_item; end if;
 insert into private.garden_plants(owner_id,item_id,cell) values(auth.uid(),p_item,p_cell);
 update private.gardens set revision=revision+1,layout_updated_at=now() where owner_id=auth.uid();
end $$;
create function public.move_garden_plant(p_plant uuid,p_cell integer,p_revision integer) returns void
language plpgsql security definer set search_path=public,private as $$
declare g private.gardens:=private.lock_garden_revision(p_revision);
begin
 if not exists(select 1 from private.garden_plants where id=p_plant and owner_id=auth.uid()) then raise exception 'Plant unavailable' using errcode='42501'; end if;
 if p_cell is not null and not private.garden_cell_available(g,p_cell) then raise exception '빈 칸을 선택해 주세요.' using errcode='22023'; end if;
 update private.garden_plants set cell=p_cell,positioned_at=now() where id=p_plant and owner_id=auth.uid();
 update private.gardens set revision=revision+1,layout_updated_at=now() where owner_id=auth.uid();
end $$;
alter function public.save_garden(integer,jsonb,text) set schema private;
alter function private.save_garden(integer,jsonb,text) rename to save_garden_base;
revoke all on function private.save_garden_base(integer,jsonb,text) from public,anon,authenticated;
create function public.save_garden(p_revision integer,p_placements jsonb,p_visibility text) returns void
language plpgsql security definer set search_path=public,private as $$
declare g private.gardens:=private.lock_garden_revision(p_revision);
begin
 if jsonb_typeof(p_placements) is distinct from 'array' then raise exception 'Invalid garden layout' using errcode='22023'; end if;
 if exists(select 1 from jsonb_array_elements(p_placements) x join private.garden_catalog c on c.id=x->>'itemId' where c.kind='seed')
 or exists(select 1 from jsonb_array_elements(p_placements) x join private.garden_plants p on p.owner_id=auth.uid() and p.cell::text=x->>'cell') then
  raise exception 'Invalid garden layout' using errcode='22023'; end if;
 perform private.save_garden_base(p_revision,p_placements,p_visibility);
 if g.placements is distinct from p_placements then update private.gardens set layout_updated_at=now() where owner_id=auth.uid(); end if;
end $$;

-- A single private predicate defines trait bonuses; no client timestamps/bonus flags accepted.
create function private.garden_growth_multiplier(p_trait text,p_hour integer,p_days integer,p_comeback boolean,p_neighbor boolean)
returns numeric language sql stable set search_path=public,private as $$
 select 1 + case when
 (p_trait='day' and p_hour >= (p->>'dayStart')::integer and p_hour < (p->>'dayEnd')::integer)
 or (p_trait='evening' and p_hour >= (p->>'dayEnd')::integer and p_hour < (p->>'eveningEnd')::integer)
 or (p_trait='steady' and p_days >= (p->>'steadyDays')::integer)
 or (p_trait='comeback' and p_comeback)
 then (p->>'traitBonusPercent')::numeric/100 else 0 end
 +case when p_neighbor then (p->>'neighborBonusPercent')::numeric/100 else 0 end
 from (select private.garden_policy() p) policy
$$;
create function private.grow_garden_from_credit() returns trigger language plpgsql security definer set search_path=public,private as $$
declare s public.running_sessions; g private.gardens; day date; hour integer; days integer; comeback_day boolean;
begin
 select * into s from public.running_sessions where id=new.session_id and user_id=new.owner_id;
 if not found then return new; end if;
 select * into g from private.gardens where owner_id=new.owner_id for update;
 day:=(s.started_at at time zone 'Asia/Seoul')::date;
 hour:=extract(hour from s.started_at at time zone 'Asia/Seoul');
 insert into private.garden_growth_days(owner_id,run_day,comeback)
 values(new.owner_id,day,not exists(select 1 from private.garden_growth_days where owner_id=new.owner_id
  and run_day>day-(private.garden_policy()->>'comebackDays')::integer and run_day<day))
 on conflict(owner_id,run_day) do nothing;
 select comeback into comeback_day from private.garden_growth_days where owner_id=new.owner_id and run_day=day;
 select count(*) into days from private.garden_growth_days where owner_id=new.owner_id
  and run_day between day-((private.garden_policy()->>'steadyWindowDays')::integer-1) and day;
 -- One UPDATE uses a pre-growth snapshot: a tree maturing this run helps from the next run.
 update private.garden_plants p set growth=least(c.growth_meters,p.growth+s.distance_meters*private.garden_growth_multiplier(c.trait,hour,days,comeback_day,
 c.tree_neighbor and g.layout_updated_at<=s.started_at and (
 exists(select 1 from jsonb_array_elements(g.placements) x where x->>'itemId'='tree'
  and abs((x->>'cell')::integer/4-p.cell/4)+abs((x->>'cell')::integer%4-p.cell%4)=1)
 or exists(select 1 from private.garden_plants t join private.garden_catalog tc on tc.id=t.item_id
  where t.owner_id=p.owner_id and t.item_id='tree_seed' and t.growth>=tc.growth_meters and t.positioned_at<=s.started_at
  and abs(t.cell/4-p.cell/4)+abs(t.cell%4-p.cell%4)=1))))
 from private.garden_catalog c where p.owner_id=new.owner_id and c.id=p.item_id and p.cell is not null
 and p.positioned_at<=s.started_at and p.growth<c.growth_meters;
 insert into private.garden_collection(owner_id,item_id,completed)
 select distinct p.owner_id,p.item_id,true from private.garden_plants p join private.garden_catalog c on c.id=p.item_id
 where p.owner_id=new.owner_id and p.growth>=c.growth_meters
 on conflict(owner_id,item_id) do update set completed=true;
 return new;
end $$;
create trigger garden_credit_growth after insert on private.garden_credits for each row execute function private.grow_garden_from_credit();
revoke all on function private.discover_garden_item(),private.lock_garden_revision(integer),private.garden_cell_available(private.gardens,integer),
 private.garden_growth_multiplier(text,integer,integer,boolean,boolean),private.grow_garden_from_credit() from public,anon,authenticated;
revoke all on function public.get_garden(uuid),public.start_garden(),public.save_garden(integer,jsonb,text),
 public.plant_garden_seed(text,integer,integer),public.move_garden_plant(uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.get_garden(uuid),public.start_garden(),public.save_garden(integer,jsonb,text),
 public.plant_garden_seed(text,integer,integer),public.move_garden_plant(uuid,integer,integer) to authenticated;
commit;
