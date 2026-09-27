-- pgTAP에서 재현한 JSON 연산 우선순위와 집계 상관 참조 오류를 수정한다.
-- 보상 트리거가 기존 기록 저장을 방해하지 않고, 소유 수량 검증을 실행하게 한다.
begin;
create or replace function private.credit_garden_run() returns trigger language plpgsql security definer set search_path=public,private as $$
declare g private.gardens; p jsonb:=private.garden_policy(); n integer; growth integer; i integer;
 item record; picked text; roll double precision; cumulative integer; total integer; rewards jsonb:='{}'; run_source_key text;
begin
 if new.status <> 'completed' or new.gps_quality_summary->>'server_validated' is distinct from 'true'
 or jsonb_typeof(new.gps_quality_summary->'rejection_reasons') is distinct from 'array'
 or ((new.gps_quality_summary->'rejection_reasons') - 'distance_below_3km') <> '[]'::jsonb then return new; end if;
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
create or replace function public.save_garden(p_revision integer,p_placements jsonb,p_visibility text) returns void
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
 or exists(select 1 from (select x->>'itemId' as item_id,count(*) as used from jsonb_array_elements(p_placements) x group by x->>'itemId') counts left join private.garden_inventory inv on inv.owner_id=auth.uid() and inv.item_id=counts.item_id where counts.used>coalesce(inv.quantity,0))
 then raise exception 'Invalid garden layout' using errcode='22023'; end if;
 -- Rebuild projection: never persist arbitrary client metadata for visitors.
 update private.gardens set placements=coalesce((select jsonb_agg(jsonb_build_object('cell',(x->>'cell')::integer,'itemId',x->>'itemId')) from jsonb_array_elements(p_placements) x),'[]'),
 visibility=p_visibility,revision=revision+1 where owner_id=auth.uid();
end $$;


commit;

