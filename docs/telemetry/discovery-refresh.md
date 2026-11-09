# Telemetry discovery refresh

The current season's meetings and every meeting's completed-session list use
one canonical cache entry (`meetings:<year>` and `sessions:<meeting>`), with a
five-minute TTL. Historical meeting lists retain their one-day TTL. Do not wrap
these lists in a second result cache or renew their age when reading them.

`telemetry.refresh_recent` fetches the session schedule once, refreshes the
current meeting list, and writes completed-session lists from those fresh source
rows before enqueuing missing catalogs for sessions completed in the last 48 hours. It
uses the existing `telemetry.prepare` queue, retry policy and per-task deduplication.
All finished sessions of the newest meeting are eligible for catch-up, including
practices. Cancelled and future sessions are excluded. Race pace and report
timing keep their existing independent tasks. High-frequency lap channels are
still loaded on demand, not downloaded for every driver by the periodic job.
Fresh source reads renew discovery TTLs even when a scheduler tick precedes the
previous entry's expiry by a few seconds. An expired current-year meeting list
queues a refresh and does not temporarily move the free demo to an older year.

The existing OpenF1 readiness interval of 31 minutes after the scheduled session
end remains in force. With the five-minute schedule, initial discovery normally
runs 31-36 minutes after the end, plus worker queue and source availability time.
The readiness interval is not a guarantee that OpenF1 already has all channels.

## Production schedule

After both the web and queue-worker images contain this command, configure one
enabled interval schedule in the existing `admin_job_schedules` table:

```sql
insert into public.admin_job_schedules (
  schedule_key, job_name, schedule_kind, interval_minutes, daily_time_utc,
  args, max_attempts, is_enabled, next_run_at
) values (
  'telemetry_refresh_recent', 'telemetry.refresh_recent', 'interval', 5, null,
  '{}'::jsonb, 3, true, now()
) on conflict (schedule_key) do update set
  job_name = excluded.job_name,
  schedule_kind = excluded.schedule_kind,
  interval_minutes = excluded.interval_minutes,
  daily_time_utc = null,
  max_attempts = excluded.max_attempts,
  is_enabled = true,
  next_run_at = excluded.next_run_at,
  updated_at = now();
```

This is operational schedule configuration, not a schema change. The normal
schedule enqueuer suppresses overlapping queued/running instances; do not add a
second host cron or worker loop for this command. Keep the six-hour sporting
session synchronization unchanged: discovery does not update every race row.

When upgrading from the former nested cache, expire only the current season's
`meetings:<year>` entry and the current meeting's `sessions:<meeting>` entry once,
then invoke `node worker/cli.mjs telemetry.refresh_recent`. Do not purge raw
telemetry, comparisons, historical caches or unrelated application data.

Verify that the job succeeds, the current meeting appears in `meetings:<year>`,
completed sessions appear in `sessions:<meeting>`, their catalogs become ready,
and a real comparison contains telemetry points. Also verify the next periodic
run, the five-minute expiry timestamps, and the public LIVE WebSocket after the
web rebuild. Retain production env, the persistent image cache and a rollback
image; restart only the web and necessary worker services.
