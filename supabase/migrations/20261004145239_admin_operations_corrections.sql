-- Backend-only diagnostics. No historical rows, prices or production schedules are rewritten.
create index if not exists idx_job_runs_name_latest on public.job_runs(job_name, started_at desc, id desc);
create index if not exists idx_job_runs_schedule_latest on public.job_runs((metadata->>'scheduleKey'), started_at desc, id desc)
  where metadata ? 'scheduleKey';

create or replace function public.get_admin_operations_snapshot()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'latestJobs', coalesce((select jsonb_agg(to_jsonb(j)) from (
      select distinct on (job_name) * from public.job_runs order by job_name, started_at desc, id desc
    ) j), '[]'::jsonb),
    'scheduleJobs', coalesce((select jsonb_agg(jsonb_build_object(
      'scheduleKey', s.schedule_key, 'job', to_jsonb(j), 'lastSuccessAt', ok.finished_at
    )) from public.admin_job_schedules s
      left join lateral (
        select * from public.job_runs r
        where r.id = s.last_job_run_id or (r.metadata ? 'scheduleKey' and r.metadata->>'scheduleKey' = s.schedule_key)
        order by (r.id = s.last_job_run_id) desc nulls last, r.started_at desc, r.id desc limit 1
      ) j on true
      left join lateral (
        select finished_at from public.job_runs r where r.status = 'success'
          and (r.id = s.last_job_run_id or (r.metadata ? 'scheduleKey' and r.metadata->>'scheduleKey' = s.schedule_key))
        order by r.finished_at desc, r.id desc limit 1
      ) ok on true), '[]'::jsonb),
    'queuedJobs', (select count(*) from public.job_runs where queue_version = 1 and status = 'queued'),
    'runningJobs', (select count(*) from public.job_runs where queue_version = 1 and status = 'running'),
    'failedJobs24h', (select count(*) from public.job_runs where status = 'failed' and coalesce(finished_at, started_at) >= now() - interval '24 hours'),
    'telemetry', (select jsonb_build_object(
      'failed24h', count(*) filter (where (t.status = 'failed' or (t.status = 'queued' and (t.error_code is not null or j.status = 'failed'))) and t.updated_at >= now() - interval '24 hours'),
      'queuedErrors', count(*) filter (where t.status = 'queued' and (t.error_code is not null or j.status = 'failed')),
      'queued', count(*) filter (where t.status = 'queued' and t.error_code is null and (j.status in ('queued', 'running') or j.id is null)),
      'staleQueued', count(*) filter (where t.status = 'queued' and t.error_code is null and t.updated_at < now() - interval '30 minutes' and (j.status = 'queued' or j.id is null)),
      'ready24h', count(*) filter (where t.status = 'ready' and t.updated_at >= now() - interval '24 hours'),
      'lastRequestAt', max(t.updated_at), 'lastReadyAt', max(t.updated_at) filter (where t.status = 'ready'),
      'cacheUpdatedAt', (select max(updated_at) from public.telemetry_cache)
    ) from public.telemetry_tasks t left join public.job_runs j on j.id = t.job_id)
  );
$$;
revoke all on function public.get_admin_operations_snapshot() from public, anon, authenticated;
grant execute on function public.get_admin_operations_snapshot() to service_role;

create or replace function public.admin_retry_telemetry_task(p_task_id uuid, p_previous_job_id uuid, p_actor_user_id uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_task public.telemetry_tasks; v_previous public.job_runs; v_job uuid;
begin
  select * into v_task from public.telemetry_tasks where id = p_task_id for update;
  if not found or v_task.job_id is distinct from p_previous_job_id then raise exception 'telemetry_attempt_changed'; end if;
  select * into v_previous from public.job_runs where id = p_previous_job_id for update;
  if not found or v_previous.job_name <> 'telemetry.prepare'
    or not (v_previous.status = 'failed' or (v_previous.status = 'queued' and v_previous.queue_version is distinct from 1))
    then raise exception 'telemetry_retry_unavailable'; end if;
  insert into public.job_runs(job_name, status, queue_version, available_at, requested_by, retry_of, max_attempts, metadata)
    values ('telemetry.prepare', 'queued', 1, now(), p_actor_user_id, p_previous_job_id, 3,
      jsonb_build_object('source', 'admin', 'args', jsonb_build_object('taskId', p_task_id))) returning id into v_job;
  update public.telemetry_tasks set job_id = v_job, status = 'queued', error_code = null, result_key = null, updated_at = now() where id = p_task_id;
  return v_job;
end;
$$;
revoke all on function public.admin_retry_telemetry_task(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_retry_telemetry_task(uuid, uuid, uuid) to service_role;

create or replace function public.admin_retry_failed_social_posts(p_limit integer default 50)
returns integer language plpgsql security invoker set search_path = '' as $$
declare v_count integer;
begin
  if p_limit < 1 or p_limit > 100 or p_limit is null then raise exception 'invalid_social_retry_limit'; end if;
  with selected as (
    select id from public.social_posts where status = 'pending' and duplicate_of is null
      and last_processing_error is not null order by updated_at, id for update skip locked limit p_limit
  ), updated as (
    update public.social_posts p set processing_attempts = 0, last_processing_error = null,
      next_retry_at = now(), updated_at = now()
      from selected s where p.id = s.id returning p.id
  ) select count(*) into v_count from updated;
  return v_count;
end;
$$;
revoke all on function public.admin_retry_failed_social_posts(integer) from public, anon, authenticated;
grant execute on function public.admin_retry_failed_social_posts(integer) to service_role;

create or replace function public.get_admin_poll_vote_counts(p_poll_ids uuid[])
returns table(poll_id uuid, vote_count bigint) language sql stable security invoker set search_path = '' as $$
  select v.poll_id, count(*) from public.poll_votes v where v.poll_id = any(p_poll_ids) group by v.poll_id;
$$;
revoke all on function public.get_admin_poll_vote_counts(uuid[]) from public, anon, authenticated;
grant execute on function public.get_admin_poll_vote_counts(uuid[]) to service_role;

-- Identical UTC day and rolling 30-day window for workers, LIVE and the admin UI.
create or replace function public.get_ai_budget_guard(p_purpose text)
returns table(scope text, daily_limit_usd numeric, monthly_limit_usd numeric, daily_spend_usd numeric, monthly_spend_usd numeric, allowed boolean)
language sql stable security invoker set search_path = '' as $$
  with usage as (
    select b.scope, b.daily_limit_usd, b.monthly_limit_usd,
      coalesce(sum(l.estimated_cost_usd) filter (where l.created_at >= (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC')), 0)::numeric as daily_spend_usd,
      coalesce(sum(l.estimated_cost_usd), 0)::numeric as monthly_spend_usd
    from public.admin_ai_budgets b left join public.ai_usage_logs l
      on l.created_at >= now() - interval '30 days' and (b.scope = 'default' or (b.scope = 'social_x' and l.purpose = 'social.x'))
    where b.scope = 'default' or (b.scope = 'social_x' and p_purpose = 'social.x')
    group by b.scope, b.daily_limit_usd, b.monthly_limit_usd
  ) select *, daily_spend_usd < daily_limit_usd and monthly_spend_usd < monthly_limit_usd from usage;
$$;
revoke all on function public.get_ai_budget_guard(text) from public, anon, authenticated;
grant execute on function public.get_ai_budget_guard(text) to service_role;

create or replace function public.get_admin_billing_page(
  p_search_pattern text default '%', p_status text default null, p_provider text default null,
  p_currency text default null, p_since timestamptz default null, p_until timestamptz default null,
  p_page integer default 1, p_page_size integer default 25
)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with filtered as (
    select o.* from public.billing_orders o
    where (p_provider is null or o.provider = p_provider) and (p_currency is null or o.currency = p_currency)
      and (p_status is null or o.status = p_status) and (p_since is null or o.created_at >= p_since) and (p_until is null or o.created_at < p_until)
      and (o.order_number ilike p_search_pattern or o.user_id::text ilike p_search_pattern or o.id::text ilike p_search_pattern
        or o.provider_order_id ilike p_search_pattern or o.provider_label ilike p_search_pattern
        or exists(select 1 from public.payment_transactions t where t.order_id = o.id and t.provider_transaction_id ilike p_search_pattern))
  ), bounds as (
    select count(*) as total, greatest(10, least(coalesce(p_page_size, 25), 100)) as size from filtered
  ), paging as (
    select *, greatest(1, least(coalesce(p_page, 1), greatest(1, ceil(total::numeric / size)::integer))) as page from bounds
  ), selected as (
    select id, order_number, user_id, provider, payment_method, amount_minor, currency, duration_months, status,
      failure_reason, paid_at, created_at, provider_order_id, provider_label, payment_dispute_status, refunded_amount_minor
    from filtered order by created_at desc, id desc limit (select size from paging) offset (select (page - 1)::bigint * size from paging)
  ), diagnostic as (
    select case
      when failure_reason = 'CHECKOUT_EXPIRED' then 'CHECKOUT_EXPIRED'
      when failure_reason = 'LAVA_EMAIL_REJECTED' then 'LAVA_EMAIL_REJECTED'
      when failure_reason = 'LAVA_ORDER_SAVE_FAILED' then 'LAVA_ORDER_SAVE_FAILED'
      when failure_reason in ('LAVA_INVOICE_FAILED', 'LAVA_INVOICE_CREATE_FAILED') then 'INVOICE_FAILED'
      else 'UNKNOWN' end as reason, count(*) as count
    from filtered where status = 'failed' and created_at >= coalesce(p_since, now() - interval '24 hours') group by 1
  )
  select jsonb_build_object('total', total, 'page', page,
    'orders', coalesce((select jsonb_agg(to_jsonb(s)) from selected s), '[]'::jsonb),
    'failures', coalesce((select jsonb_agg(to_jsonb(d)) from diagnostic d), '[]'::jsonb)
  ) from paging;
$$;
revoke all on function public.get_admin_billing_page(text, text, text, text, timestamptz, timestamptz, integer, integer) from public, anon, authenticated;
grant execute on function public.get_admin_billing_page(text, text, text, text, timestamptz, timestamptz, integer, integer) to service_role;

create or replace function public.get_admin_ai_prompt_history(p_prompt_key text, p_page integer default 1, p_page_size integer default 25)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with bounds as (
    select count(*) as total, greatest(10, least(coalesce(p_page_size, 25), 100)) as size from public.ai_prompt_versions where prompt_key = p_prompt_key
  ), paging as (
    select *, greatest(1, least(coalesce(p_page, 1), greatest(1, ceil(total::numeric / size)::integer))) as page from bounds
  ), selected as (
    select id, prompt_key, version, status, model, max_tokens, change_note, checksum, created_at, published_at
    from public.ai_prompt_versions where prompt_key = p_prompt_key order by version desc, id desc
      limit (select size from paging) offset (select (page - 1)::bigint * size from paging)
  ) select jsonb_build_object('total', total, 'page', page, 'items', coalesce((select jsonb_agg(to_jsonb(s)) from selected s), '[]'::jsonb)) from paging;
$$;
revoke all on function public.get_admin_ai_prompt_history(text, integer, integer) from public, anon, authenticated;
grant execute on function public.get_admin_ai_prompt_history(text, integer, integer) to service_role;

create or replace function public.get_admin_ai_prompt_history_overview()
returns setof public.ai_prompt_versions language sql stable security invoker set search_path = '' as $$
  select v.* from public.ai_prompt_versions v join (
    select id, row_number() over(partition by prompt_key order by version desc, id desc) as position from public.ai_prompt_versions
  ) ranked on ranked.id = v.id where ranked.position <= 6 order by v.prompt_key, v.version desc;
$$;
revoke all on function public.get_admin_ai_prompt_history_overview() from public, anon, authenticated;
grant execute on function public.get_admin_ai_prompt_history_overview() to service_role;

create or replace function public.get_admin_ai_latest_drafts()
returns setof public.ai_prompt_versions language sql stable security invoker set search_path = '' as $$
  select distinct on (prompt_key) * from public.ai_prompt_versions where status = 'draft' order by prompt_key, version desc, id desc;
$$;
revoke all on function public.get_admin_ai_latest_drafts() from public, anon, authenticated;
grant execute on function public.get_admin_ai_latest_drafts() to service_role;

create or replace function public.get_admin_sport_season_counts(p_season integer)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'races', (select count(*) from public.races where season_year = p_season),
    'sessions', (select count(*) from public.sessions s join public.races r on r.id = s.race_id where r.season_year = p_season),
    'results', (select count(*) from public.session_results v join public.sessions s on s.id = v.session_id join public.races r on r.id = s.race_id where r.season_year = p_season),
    'driverStandings', (select count(*) from public.driver_standings where season_year = p_season),
    'constructorStandings', (select count(*) from public.constructor_standings where season_year = p_season)
  );
$$;
revoke all on function public.get_admin_sport_season_counts(integer) from public, anon, authenticated;
grant execute on function public.get_admin_sport_season_counts(integer) to service_role;

create or replace function public.get_admin_user_engagement_counts(p_user_ids uuid[])
returns table(user_id uuid, favorite_teams bigint, favorite_drivers bigint, predictions bigint, leagues bigint)
language sql stable security invoker set search_path = '' as $$
  select u.id,
    (select count(*) from public.user_favorite_teams t where t.user_id = u.id),
    (select count(*) from public.user_favorite_drivers d where d.user_id = u.id),
    (select count(*) from public.predictions p where p.user_id = u.id),
    (select count(*) from public.prediction_league_members m where m.user_id = u.id)
  from (select distinct unnest(p_user_ids) as id) u;
$$;
revoke all on function public.get_admin_user_engagement_counts(uuid[]) from public, anon, authenticated;
grant execute on function public.get_admin_user_engagement_counts(uuid[]) to service_role;
