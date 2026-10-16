// Run with a temporary PGlite runtime; no application dependency or remote DB is required.
// node scripts/check-admin-corrections-sql.mjs /tmp/raceside-sql-check/node_modules/@electric-sql/pglite/dist/index.js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const { PGlite } = await import(process.argv[2] ?? "@electric-sql/pglite");
const db = new PGlite();
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table job_runs(id uuid primary key default gen_random_uuid(), job_name text, status text, queue_version integer, available_at timestamptz,
      started_at timestamptz default now(), finished_at timestamptz, metadata jsonb default '{}', requested_by uuid, retry_of uuid, max_attempts integer default 3);
    create table admin_job_schedules(id uuid default gen_random_uuid(), schedule_key text, job_name text, last_job_run_id uuid);
    create table telemetry_tasks(id uuid primary key default gen_random_uuid(), job_id uuid, status text, error_code text, result_key text, updated_at timestamptz default now());
    create table telemetry_cache(key text, updated_at timestamptz);
    create table social_posts(id uuid primary key default gen_random_uuid(), status text, duplicate_of uuid, published_at timestamptz, processing_attempts integer,
      last_processing_error text, next_retry_at timestamptz, updated_at timestamptz default now());
    create table admin_ai_budgets(scope text, daily_limit_usd numeric, monthly_limit_usd numeric);
    create table ai_usage_logs(created_at timestamptz, purpose text, estimated_cost_usd numeric);
    create table user_favorite_teams(user_id uuid);
    create table user_favorite_drivers(user_id uuid);
    create table predictions(user_id uuid);
    create table prediction_league_members(user_id uuid);
    create table poll_votes(poll_id uuid, option_id uuid);
    create table billing_orders(id uuid primary key default gen_random_uuid(), order_number text, user_id uuid default gen_random_uuid(), provider text default 'lava', payment_method text,
      amount_minor integer default 500, currency text default 'USD', duration_months integer default 1, status text default 'paid', failure_reason text, paid_at timestamptz,
      created_at timestamptz default now(), provider_order_id text, provider_label text, payment_dispute_status text, refunded_amount_minor integer default 0);
    create table payment_transactions(order_id uuid, provider_transaction_id text);
    create table ai_prompt_versions(id uuid primary key default gen_random_uuid(), prompt_key text, version integer, status text, model text, max_tokens integer, change_note text,
      checksum text, created_at timestamptz default now(), published_at timestamptz);
    create table races(id uuid primary key default gen_random_uuid(), season_year integer);
    create table sessions(id uuid primary key default gen_random_uuid(), race_id uuid);
    create table session_results(id uuid primary key default gen_random_uuid(), session_id uuid);
    create table driver_standings(id uuid primary key default gen_random_uuid(), season_year integer);
    create table constructor_standings(id uuid primary key default gen_random_uuid(), season_year integer);
    grant all on all tables in schema public to service_role;
  `);
  await db.exec(await readFile(new URL("../supabase/migrations/20261004145239_admin_operations_corrections.sql", import.meta.url), "utf8"));
  await db.exec(`
    insert into job_runs(job_name,status,queue_version,metadata) select 'frequent','queued',1,'{}'::jsonb from generate_series(1,400);
    insert into job_runs(id,job_name,status,started_at,finished_at,metadata) values
      ('10000000-0000-4000-8000-000000000001','rare','success',now()-interval '8 hours',now()-interval '7 hours','{"scheduleKey":"rare_daily"}'),
      ('10000000-0000-4000-8000-000000000002','rare','failed',now(),now(),'{}'),
      ('10000000-0000-4000-8000-000000000003','telemetry.prepare','failed',now()-interval '40 days',now()-interval '40 days','{}');
    insert into admin_job_schedules(schedule_key,job_name,last_job_run_id) values('rare_daily','rare','10000000-0000-4000-8000-000000000001');
    insert into telemetry_tasks(id,job_id,status,error_code,updated_at) values
      ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','queued','INVALID_TASK',now()-interval '40 days');
  `);
  const snapshot = (await db.query("select get_admin_operations_snapshot() as result")).rows[0].result;
  assert.equal(snapshot.queuedJobs, 400);
  assert.equal(snapshot.latestJobs.find(row => row.job_name === "rare").status, "failed");
  assert.equal(snapshot.scheduleJobs[0].job.status, "success", "manual runs cannot replace the scheduled run");
  assert.ok(snapshot.scheduleJobs[0].lastSuccessAt);
  assert.equal(snapshot.telemetry.queuedErrors, 1, "old queued errors are not hidden by a 24-hour row window");
  assert.equal(snapshot.telemetry.failed24h, 0, "old failures are not permanent current incidents");
  assert.equal(snapshot.telemetry.staleQueued, 0, "a terminal old failure is not an active waiting task");
  const retryArgs = ['20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000001'];
  const newJob = (await db.query("select admin_retry_telemetry_task($1,$2,$3) as id", retryArgs)).rows[0].id;
  const task = (await db.query("select * from telemetry_tasks")).rows[0];
  assert.equal(task.job_id, newJob); assert.equal(task.status, "queued"); assert.equal(task.error_code, null);
  await assert.rejects(db.query("select admin_retry_telemetry_task($1,$2,$3)", retryArgs), /telemetry_attempt_changed/);
  await db.exec(`insert into job_runs(id,job_name,status,queue_version) values('10000000-0000-4000-8000-000000000004','telemetry.prepare','queued',null);
    insert into telemetry_tasks(id,job_id,status) values('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000004','queued');`);
  const legacyJob = (await db.query("select admin_retry_telemetry_task($1,$2,$3) as id", ['20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000004',retryArgs[2]])).rows[0].id;
  assert.notEqual(legacyJob, '10000000-0000-4000-8000-000000000004');
  await db.exec(`
    insert into social_posts(status,published_at,processing_attempts,last_processing_error) values
      ('pending',now()-interval '1 hour',8,'provider'),('pending',now()-interval '1 hour',9,'provider'),('published',now(),8,'provider');
  `);
  assert.equal((await db.query("select admin_retry_failed_social_posts(1) as n")).rows[0].n, 1);
  assert.equal((await db.query("select count(*)::integer as n from social_posts where status='pending' and processing_attempts=0 and last_processing_error is null")).rows[0].n, 1);
  assert.equal((await db.query("select processing_attempts from social_posts where status='published'")).rows[0].processing_attempts, 8);
  await assert.rejects(db.query("select admin_retry_failed_social_posts(101)"), /invalid_social_retry_limit/);
  await db.exec(`
    insert into admin_ai_budgets values('default',1,10);
    insert into ai_usage_logs values(now(),'live_radio_translation',0.5),
      (date_trunc('day',now() at time zone 'UTC') at time zone 'UTC' - interval '1 hour','news',0.3),
      (now()-interval '31 days','news',9);
    set timezone = 'Pacific/Honolulu';
  `);
  const budget = (await db.query("select * from get_ai_budget_guard('live_radio_translation')")).rows[0];
  assert.equal(Number(budget.daily_spend_usd), 0.5); assert.equal(Number(budget.monthly_spend_usd), 0.8); assert.equal(budget.allowed, true);
  await db.exec("insert into ai_usage_logs values(now(),'news',0.5)");
  assert.equal((await db.query("select allowed from get_ai_budget_guard('live_radio_transcription')")).rows[0].allowed, false);
  await db.exec(`
    insert into billing_orders(order_number,created_at) select 'order_'||n, now()-n*interval '1 hour' from generate_series(1,180) n;
    insert into billing_orders(order_number,status,failure_reason) values('invoice_failure','failed','LAVA_ORDER_SAVE_FAILED');
    insert into ai_prompt_versions(prompt_key,version,status) select 'busy',n,'draft' from generate_series(1,130) n;
    insert into ai_prompt_versions(prompt_key,version,status,created_at) values('rare',1,'published',now()-interval '8 months');
  `);
  const page = (await db.query("select get_admin_billing_page(p_page=>999,p_page_size=>10) as result")).rows[0].result;
  assert.equal(page.total, 181); assert.equal(page.page, 19); assert.equal(page.orders.length, 1);
  assert.equal(page.failures.find(row => row.reason === "LAVA_ORDER_SAVE_FAILED").count, 1);
  const searched = (await db.query("select get_admin_billing_page(p_search_pattern=>$1) as result", ['%order\\_180%'])).rows[0].result;
  assert.equal(searched.total, 1);
  const history = (await db.query("select get_admin_ai_prompt_history('busy',6,25) as result")).rows[0].result;
  assert.equal(history.total, 130); assert.equal(history.page, 6); assert.equal(history.items.length, 5);
  assert.equal((await db.query("select count(*)::integer as n from get_admin_ai_prompt_history_overview() where prompt_key='rare'")).rows[0].n, 1);
  assert.equal((await db.query("select version from get_admin_ai_latest_drafts() where prompt_key='busy'")).rows[0].version, 130);
  await db.exec("insert into driver_standings(season_year) values(2025),(2026),(2026)");
  assert.equal((await db.query("select get_admin_sport_season_counts(2026) as result")).rows[0].result.driverStandings, 2);
  const engagementUser = '30000000-0000-4000-8000-000000000001';
  await db.query("insert into predictions(user_id) select $1::uuid from generate_series(1,1200)", [engagementUser]);
  await db.query("insert into prediction_league_members(user_id) select $1::uuid from generate_series(1,1100)", [engagementUser]);
  const engagement = (await db.query("select * from get_admin_user_engagement_counts($1)", [[engagementUser]])).rows[0];
  assert.equal(Number(engagement.predictions), 1200); assert.equal(Number(engagement.leagues), 1100);
  for (const name of ["get_admin_operations_snapshot", "admin_retry_telemetry_task", "admin_retry_failed_social_posts", "get_ai_budget_guard", "get_admin_billing_page", "get_admin_ai_prompt_history", "get_admin_poll_vote_counts", "get_admin_user_engagement_counts", "get_admin_ai_latest_drafts", "get_admin_ai_prompt_history_overview", "get_admin_sport_season_counts"]) {
    const privileges = (await db.query("select has_function_privilege('anon', oid, 'execute') as anon, has_function_privilege('authenticated', oid, 'execute') as authenticated, has_function_privilege('service_role', oid, 'execute') as service from pg_proc where proname=$1", [name])).rows[0];
    assert.deepEqual(privileges, { anon: false, authenticated: false, service: true });
  }
  const timing = (await db.query("explain (analyze, format json) select get_admin_operations_snapshot()")).rows[0]["QUERY PLAN"][0]["Execution Time"];
  console.log(`SQL checks passed: snapshot, schedule association, telemetry retry, bounded social retry, UTC budgets, billing/history pagination, role isolation. Snapshot execution: ${timing} ms (isolated fixture).`);
} finally { await db.close(); }
