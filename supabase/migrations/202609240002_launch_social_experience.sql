-- 출시 전 프로필의 선택형 러닝 성향과 본인 발견 상태를 제공한다. 기존 social_profiles
-- 관계 판정을 재사용하며 GPS/정확한 시각은 추가하지 않는다. 약속은 상호 수락된 친구만
-- 제안하고 상대가 확인해야 확정되며 조회/변경은 같은 private 판정을 따른다.
begin;
alter table public.profiles
  add column conversation_preference text not null default 'any' check (conversation_preference in ('any','chatty','quiet')),
  add column preferred_distance text not null default 'any' check (preferred_distance in ('any','short','5k','10k'));
create function public.get_runner_introduction()
returns table(bio text, conversation_preference text, preferred_distance text)
language sql stable security definer set search_path=public as $$
  select p.bio, p.conversation_preference, p.preferred_distance from public.profiles p where p.id=auth.uid();
$$;
create function public.set_runner_introduction(p_bio text, p_conversation text, p_distance text)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_bio is null or char_length(p_bio)>300 or p_conversation is null or p_conversation not in ('any','chatty','quiet')
    or p_distance is null or p_distance not in ('any','short','5k','10k') then
    raise exception 'Invalid runner introduction' using errcode='22023';
  end if;
  update public.profiles set bio=trim(p_bio), conversation_preference=p_conversation, preferred_distance=p_distance where id=auth.uid();
  return found;
end;
$$;
create view public.social_runner_details with (security_barrier=true) as
 select p.id,p.bio,p.conversation_preference,p.preferred_distance
 from public.profiles p join public.social_profiles visible on visible.id=p.id;
revoke all on public.social_runner_details from public,anon,authenticated;
grant select(id,bio,conversation_preference,preferred_distance) on public.social_runner_details to authenticated;

create function public.get_my_discovery_status()
returns text language plpgsql stable security definer set search_path=public as $$
declare p public.profiles%rowtype;
begin
 select * into p from public.profiles where id=auth.uid();
 if not found then return 'profile_required'; end if;
 if not private.adult_social_access_allowed(p.id) then return 'verification_required'; end if;
 if not private.consent_granted(p.id,'terms') or not private.consent_granted(p.id,'privacy')
    or not private.consent_granted(p.id,'location') then return 'consent_required'; end if;
 if not p.discovery_enabled or p.profile_visibility not in ('profile','matching') or p.match_preference='hidden' then return 'hidden'; end if;
 if private.has_active_moderation_action(p.id,array['visibility_restriction','suspension','ban']) then return 'unavailable'; end if;
 if exists(select 1 from public.encounter_candidates c where c.viewer_id=p.id and c.expires_at>now() and private.is_pair_visible(c.candidate_profile_id)) then return 'ready'; end if;
 if exists(select 1 from public.running_sessions r where r.user_id=p.id and r.status='processing') then return 'processing'; end if;
 if not exists(select 1 from public.running_sessions r where r.user_id=p.id and r.status='completed') then return 'first_run'; end if;
 return 'searching';
end;
$$;

create table private.running_appointments (
 id uuid primary key default gen_random_uuid(),
 proposer_id uuid not null references public.profiles(id) on delete cascade,
 recipient_id uuid not null references public.profiles(id) on delete cascade,
 period text not null check(period in ('this_week','next_week')),
 time_band text not null check(time_band in ('morning','daytime','evening')),
 distance text not null check(distance in ('short','5k','10k')),
 status text not null default 'proposed' check(status in ('proposed','confirmed','declined','cancelled','completed')),
 expires_at timestamptz not null default now()+interval '14 days',
 check(proposer_id<>recipient_id)
);
alter table private.running_appointments enable row level security;
revoke all on private.running_appointments from public,anon,authenticated;
create unique index running_appointments_one_active_pair on private.running_appointments
 (least(proposer_id,recipient_id),greatest(proposer_id,recipient_id)) where status in ('proposed','confirmed');

create function private.appointment_contact_allowed(a uuid,b uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select private.can_pair_message(a,b)
  and private.consent_granted(a,'terms') and private.consent_granted(a,'privacy')
  and private.consent_granted(b,'terms') and private.consent_granted(b,'privacy')
  and not exists(select 1 from public.account_deletion_requests where user_id in(a,b) and cancelled_at is null and completed_at is null);
$$;
revoke all on function private.appointment_contact_allowed(uuid,uuid) from public,anon,authenticated;

create function public.list_running_appointments(p_partner uuid)
returns table(id uuid,proposer_id uuid,period text,time_band text,distance text,status text)
language sql stable security definer set search_path=public as $$
 select a.id,a.proposer_id,a.period,a.time_band,a.distance,a.status from private.running_appointments a
 where least(a.proposer_id,a.recipient_id)=least(auth.uid(),p_partner)
 and greatest(a.proposer_id,a.recipient_id)=greatest(auth.uid(),p_partner)
 and auth.uid() in(a.proposer_id,a.recipient_id)
 and private.appointment_contact_allowed(auth.uid(),p_partner) and a.expires_at>now()
 order by a.expires_at desc limit 20;
$$;
create function public.propose_running_appointment(p_partner uuid,p_period text,p_time_band text,p_distance text)
returns uuid language plpgsql security definer set search_path=public as $$
declare result uuid;
begin
 if not coalesce(private.appointment_contact_allowed(auth.uid(),p_partner),false) then
 raise exception 'Accepted safe relationship required' using errcode='42501'; end if;
 update private.running_appointments set status='cancelled'
 where least(proposer_id,recipient_id)=least(auth.uid(),p_partner) and greatest(proposer_id,recipient_id)=greatest(auth.uid(),p_partner)
 and status in('proposed','confirmed') and expires_at<=now();
 insert into private.running_appointments(proposer_id,recipient_id,period,time_band,distance)
 values(auth.uid(),p_partner,p_period,p_time_band,p_distance) returning id into result;
 return result;
end;
$$;
create function public.respond_running_appointment(p_id uuid,p_status text)
returns boolean language plpgsql security definer set search_path=public as $$
declare a private.running_appointments%rowtype; partner uuid;
begin
 select * into a from private.running_appointments where id=p_id for update;
 if not found or auth.uid() is null or auth.uid() not in(a.proposer_id,a.recipient_id) then return false; end if;
 partner:=case when auth.uid()=a.proposer_id then a.recipient_id else a.proposer_id end;
 if not private.appointment_contact_allowed(auth.uid(),partner) or a.expires_at<=now() then return false; end if;
 if not ((a.status='proposed' and auth.uid()=a.recipient_id and p_status in('confirmed','declined'))
 or (a.status in('proposed','confirmed') and p_status='cancelled')
 or (a.status='confirmed' and p_status='completed')) then return false; end if;
 update private.running_appointments set status=p_status where id=a.id;
 return true;
end;
$$;
revoke all on function public.get_runner_introduction(),public.set_runner_introduction(text,text,text),
 public.get_my_discovery_status(),public.list_running_appointments(uuid),
 public.propose_running_appointment(uuid,text,text,text),public.respond_running_appointment(uuid,text) from public,anon,authenticated;
grant execute on function public.get_runner_introduction(),public.set_runner_introduction(text,text,text),
 public.get_my_discovery_status(),public.list_running_appointments(uuid),
 public.propose_running_appointment(uuid,text,text,text),public.respond_running_appointment(uuid,text) to authenticated;
commit;
