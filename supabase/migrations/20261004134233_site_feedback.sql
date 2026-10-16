-- Use the existing private reader inbox for general feedback as well as news errors.
alter table public.user_error_reports
  alter column article_slug drop not null,
  alter column article_title drop not null,
  add column report_kind text not null default 'news_error'
    check (report_kind in ('news_error', 'feedback')),
  add column contact text check (contact is null or char_length(contact) <= 160),
  add column telegram_attempts integer not null default 0 check (telegram_attempts >= 0),
  add column telegram_last_attempt_at timestamptz,
  add column telegram_retry_at timestamptz not null default now(),
  add constraint user_error_reports_news_details_check check (
    report_kind = 'feedback' or (article_slug is not null and article_title is not null)
  );

create index idx_user_error_reports_feedback_delivery
  on public.user_error_reports (telegram_retry_at, created_at)
  where report_kind = 'feedback' and telegram_status <> 'sent';

-- Called only by the server after CAPTCHA and IP checks. No public insert/RPC access.
create function public.submit_site_feedback(
  p_message text,
  p_contact text,
  p_request_fingerprint text,
  p_user_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if char_length(trim(coalesce(p_message, ''))) not between 10 and 2000
    or char_length(coalesce(p_contact, '')) > 160
    or p_contact ~ '[[:cntrl:]]'
    or p_request_fingerprint is null
    or p_request_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_feedback';
  end if;

  -- Serialize submissions from the same IP across web instances.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_fingerprint, 0));
  if (
    select count(*) from public.user_error_reports
    where report_kind = 'feedback'
      and request_fingerprint = p_request_fingerprint
      and created_at >= now() - interval '1 hour'
  ) >= 5 then
    raise exception 'report_rate_limited';
  end if;

  if p_user_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 1));
    if (
      select count(*) from public.user_error_reports
      where report_kind = 'feedback' and reporter_user_id = p_user_id
        and created_at >= now() - interval '1 day'
    ) >= 20 then
      raise exception 'report_rate_limited';
    end if;
  end if;

  insert into public.user_error_reports (
    report_kind, message, contact, page_path, request_fingerprint, reporter_user_id
  ) values (
    'feedback', trim(p_message), nullif(trim(p_contact), ''), '/feedback', p_request_fingerprint,
    case when exists (select 1 from public.profiles where id = p_user_id) then p_user_id else null end
  ) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.submit_site_feedback(text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.submit_site_feedback(text, text, text, uuid) to service_role;

-- A five-minute lease prevents two workers from sending the same message concurrently.
create function public.claim_site_feedback_delivery()
returns setof public.user_error_reports
language sql
security invoker
set search_path = ''
as $$
  with due as (
    select id from public.user_error_reports
    where report_kind = 'feedback' and telegram_status <> 'sent'
      and (telegram_attempts < 5 or telegram_status in ('pending', 'not_configured'))
      and telegram_retry_at <= now()
    order by created_at
    limit 10
    for update skip locked
  )
  update public.user_error_reports report
  set telegram_attempts = report.telegram_attempts + 1,
      telegram_last_attempt_at = now(),
      telegram_retry_at = now() + interval '5 minutes'
  from due where report.id = due.id
  returning report.*;
$$;

revoke all on function public.claim_site_feedback_delivery() from public, anon, authenticated;
grant execute on function public.claim_site_feedback_delivery() to service_role;

insert into public.admin_job_schedules (
  schedule_key, job_name, schedule_kind, interval_minutes, args, max_attempts, is_enabled, next_run_at
) values (
  'support_feedback_delivery', 'support.dispatch_feedback', 'interval', 2, '{}'::jsonb, 2, true, now()
);
