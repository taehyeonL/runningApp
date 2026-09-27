-- 발견 대기 상태로 내부 자동 보류 여부를 추론하지 않도록 제한 상태를 일반 대기로
-- 합친다. 약속의 '이번/다음 주'는 제안 시 한국 달력 주로 고정해 재접속 후 의미가
-- 바뀌지 않게 한다. 이 날짜는 사용자가 선택한 미래 계획이며 실제 러닝 시각이 아니다.
begin;
create or replace function public.get_my_discovery_status()
returns text language plpgsql stable security definer set search_path=public as $$
declare p public.profiles%rowtype;
begin
 select * into p from public.profiles where id=auth.uid();
 if not found then return 'profile_required'; end if;
 if not private.adult_social_access_allowed(p.id) then return 'verification_required'; end if;
 if not private.consent_granted(p.id,'terms') or not private.consent_granted(p.id,'privacy')
    or not private.consent_granted(p.id,'location') then return 'consent_required'; end if;
 if not p.discovery_enabled or p.profile_visibility not in ('profile','matching') or p.match_preference='hidden' then return 'hidden'; end if;
 if private.has_active_moderation_action(p.id,array['visibility_restriction','suspension','ban']) then return 'searching'; end if;
 if exists(select 1 from public.encounter_candidates c where c.viewer_id=p.id and c.expires_at>now() and private.is_pair_visible(c.candidate_profile_id)) then return 'ready'; end if;
 if exists(select 1 from public.running_sessions r where r.user_id=p.id and r.status='processing') then return 'processing'; end if;
 if not exists(select 1 from public.running_sessions r where r.user_id=p.id and r.status='completed') then return 'first_run'; end if;
 return 'searching';
end;
$$;
alter table private.running_appointments add column week_start date;
update private.running_appointments set week_start=
 date_trunc('week',(expires_at-interval '14 days') at time zone 'Asia/Seoul')::date
 +case when period='next_week' then 7 else 0 end;
alter table private.running_appointments alter column week_start set not null;
create function private.anchor_running_appointment_week()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 new.week_start:=date_trunc('week',now() at time zone 'Asia/Seoul')::date+case when new.period='next_week' then 7 else 0 end;
 return new;
end;
$$;
revoke all on function private.anchor_running_appointment_week() from public,anon,authenticated;
create trigger running_appointments_anchor_week before insert on private.running_appointments
for each row execute function private.anchor_running_appointment_week();
drop function public.list_running_appointments(uuid);
create function public.list_running_appointments(p_partner uuid)
returns table(id uuid,proposer_id uuid,period text,time_band text,distance text,status text,week_start date)
language sql stable security definer set search_path=public as $$
 select a.id,a.proposer_id,a.period,a.time_band,a.distance,a.status,a.week_start from private.running_appointments a
 where least(a.proposer_id,a.recipient_id)=least(auth.uid(),p_partner)
 and greatest(a.proposer_id,a.recipient_id)=greatest(auth.uid(),p_partner)
 and auth.uid() in(a.proposer_id,a.recipient_id)
 and private.appointment_contact_allowed(auth.uid(),p_partner) and a.expires_at>now()
 order by a.expires_at desc limit 20;
$$;
revoke all on function public.list_running_appointments(uuid) from public,anon,authenticated;
grant execute on function public.list_running_appointments(uuid) to authenticated;
commit;
