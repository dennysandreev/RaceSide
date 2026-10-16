-- Monitoring must not scan completed job history to inspect a small active queue.
set lock_timeout = '5s';
set statement_timeout = '60s';

create index if not exists idx_job_runs_started_at
  on public.job_runs (started_at desc);

create index if not exists idx_job_runs_success_finished_at
  on public.job_runs (job_name, finished_at desc)
  where status = 'success';

create index if not exists idx_job_runs_active_job_name
  on public.job_runs (job_name)
  where queue_version = 1 and status in ('queued', 'running');
