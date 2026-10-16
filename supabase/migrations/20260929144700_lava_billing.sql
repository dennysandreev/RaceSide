-- Lava.top recurring card payments reuse the existing atomic payment/access transaction.
alter table public.billing_orders drop constraint billing_orders_provider_check;
alter table public.billing_orders add constraint billing_orders_provider_check check (provider in ('yoomoney', 'tribute', 'lava'));
alter table public.billing_orders drop constraint billing_orders_method_check;
alter table public.billing_orders add constraint billing_orders_method_check check (payment_method in ('yoomoney_card', 'yoomoney_wallet', 'tribute', 'lava', 'lava_rub'));
alter table public.billing_orders drop constraint billing_orders_provider_method_check;
alter table public.billing_orders add constraint billing_orders_provider_method_check check (
  (provider = 'yoomoney' and payment_method in ('yoomoney_card', 'yoomoney_wallet'))
  or (provider = 'tribute' and payment_method = 'tribute')
  or (provider = 'lava' and payment_method in ('lava', 'lava_rub'))
);
alter table public.billing_orders add column buyer_email text;
alter table public.billing_orders add column lava_parent_contract_id text;
alter table public.billing_orders add column lava_auto_renew boolean not null default false;
alter table public.billing_orders add column lava_cancelled_at timestamptz;
alter table public.billing_orders add column refunded_amount_minor bigint not null default 0;
alter table public.billing_orders add column payment_dispute_status text;
alter table public.billing_orders add constraint billing_orders_lava_email_check check (provider <> 'lava' or buyer_email is not null);
alter table public.billing_orders add constraint billing_orders_refund_amount_check check (refunded_amount_minor >= 0 and refunded_amount_minor <= amount_minor);
alter table public.billing_orders add constraint billing_orders_dispute_check check (payment_dispute_status is null or payment_dispute_status = 'initiated');
alter table public.payment_transactions drop constraint payment_transactions_provider_check;
alter table public.payment_transactions add constraint payment_transactions_provider_check check (provider in ('yoomoney', 'tribute', 'lava'));
alter table public.billing_notification_events drop constraint billing_notification_events_provider_check;
alter table public.billing_notification_events add constraint billing_notification_events_provider_check check (provider in ('yoomoney', 'tribute', 'lava'));
create index billing_orders_lava_email_status_idx on public.billing_orders(buyer_email, currency, status)
  where provider = 'lava';
create index billing_orders_lava_parent_idx on public.billing_orders(lava_parent_contract_id)
  where provider = 'lava';
create unique index billing_orders_one_recurring_lava_per_user on public.billing_orders(user_id)
  where provider = 'lava' and lava_auto_renew and lava_parent_contract_id is null;

update public.subscription_prices set amount_minor = 39000, first_purchase_only = false, updated_at = now()
where code = 'plus_monthly' and currency = 'RUB';
update public.subscription_prices set amount_minor = 390000, first_purchase_only = false, updated_at = now()
where code = 'plus_first_year' and currency = 'RUB';
insert into public.subscription_prices(plan_id, code, amount_minor, currency, duration_months, first_purchase_only)
select id, 'plus_monthly_international', 500, 'USD', 1, false
from public.subscription_plans where code = 'raceside_plus'
on conflict (code) do update set amount_minor = excluded.amount_minor, currency = excluded.currency,
  duration_months = excluded.duration_months, first_purchase_only = false, active = true, updated_at = now();
insert into public.subscription_prices(plan_id, code, amount_minor, currency, duration_months, first_purchase_only)
select id, 'plus_first_year_international', 4990, 'USD', 12, false
from public.subscription_plans where code = 'raceside_plus'
on conflict (code) do update set amount_minor = excluded.amount_minor, currency = excluded.currency,
  duration_months = excluded.duration_months, first_purchase_only = false, active = true, updated_at = now();

create or replace function public.billing_apply_payment(
  p_order_id uuid,
  p_provider text,
  p_provider_event_id text,
  p_provider_event_type text,
  p_provider_reference text,
  p_provider_transaction_id text,
  p_payment_method text,
  p_gross_amount_minor bigint,
  p_net_amount_minor bigint,
  p_currency text,
  p_occurred_at timestamptz,
  p_payload_hash text,
  p_safe_payload jsonb default '{}'::jsonb
)
returns table(applied boolean, subscription_id uuid, period_id uuid, period_end timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_order public.billing_orders;
  v_subscription public.subscriptions;
  v_period public.subscription_periods;
  v_event_status text;
  v_start timestamptz;
  v_end timestamptz;
begin
  if p_provider not in ('yoomoney', 'tribute', 'lava') then raise exception 'invalid_provider'; end if;
  if p_gross_amount_minor <= 0 or p_net_amount_minor < 0 or p_net_amount_minor > p_gross_amount_minor then
    raise exception 'invalid_payment_amount';
  end if;

  insert into public.billing_notification_events(
    provider, provider_event_id, provider_event_type, provider_reference,
    signature_valid, status, payload_hash, safe_payload
  ) values (
    p_provider, p_provider_event_id, p_provider_event_type, p_provider_reference,
    true, 'received', p_payload_hash, coalesce(p_safe_payload, '{}'::jsonb)
  )
  on conflict (provider, provider_event_id) do update
  set attempts = public.billing_notification_events.attempts + 1
  returning status into v_event_status;

  if v_event_status = 'processed' then
    select s.id, sp.id, sp.ends_at
      into subscription_id, period_id, period_end
    from public.billing_orders o
    join public.subscriptions s on s.user_id = o.user_id
    join public.subscription_periods sp on sp.order_id = o.id
    where o.id = p_order_id;
    applied := false;
    return next;
    return;
  end if;

  select * into v_order from public.billing_orders where id = p_order_id for update;
  if not found then raise exception 'billing_order_not_found'; end if;
  if v_order.provider <> p_provider then raise exception 'billing_provider_mismatch'; end if;
  if v_order.payment_method <> p_payment_method then raise exception 'billing_payment_method_mismatch'; end if;
  if v_order.amount_minor <> p_gross_amount_minor or v_order.currency <> p_currency then
    raise exception 'billing_amount_mismatch';
  end if;
  if v_order.status not in ('pending', 'paid')
     and not (v_order.status = 'failed' and (v_order.failure_reason = 'CHECKOUT_EXPIRED' or (p_provider = 'lava' and v_order.failure_reason = 'PROVIDER_PAYMENT_FAILED'))) then
    raise exception 'billing_order_not_payable';
  end if;

  if v_order.status = 'paid' then
    update public.billing_notification_events
    set status = 'processed', processed_at = coalesce(processed_at, now())
    where provider = p_provider and provider_event_id = p_provider_event_id;
    select s.id, sp.id, sp.ends_at
      into subscription_id, period_id, period_end
    from public.subscriptions s
    join public.subscription_periods sp on sp.subscription_id = s.id and sp.order_id = v_order.id
    where s.user_id = v_order.user_id;
    applied := false;
    return next;
    return;
  end if;

  insert into public.payment_transactions(
    order_id, provider, provider_transaction_id, payment_method,
    gross_amount_minor, net_amount_minor, provider_fee_minor, currency, occurred_at
  ) values (
    v_order.id, p_provider, p_provider_transaction_id, p_payment_method,
    p_gross_amount_minor, p_net_amount_minor, p_gross_amount_minor - p_net_amount_minor,
    p_currency, p_occurred_at
  );

  insert into public.subscriptions(user_id, plan_id, status)
  values (v_order.user_id, v_order.plan_id, 'expired')
  on conflict (user_id) do nothing;

  select * into v_subscription from public.subscriptions where user_id = v_order.user_id for update;
  v_start := greatest(p_occurred_at, coalesce(v_subscription.current_period_end, p_occurred_at));
  v_end := v_start + make_interval(months => v_order.duration_months);

  insert into public.subscription_periods(subscription_id, order_id, starts_at, ends_at, source)
  values (v_subscription.id, v_order.id, v_start, v_end, 'payment')
  returning * into v_period;

  update public.subscriptions
  set status = 'active',
      plan_id = v_order.plan_id,
      current_period_start = case
        when v_subscription.current_period_end is null or v_subscription.current_period_end <= p_occurred_at then v_start
        else v_subscription.current_period_start
      end,
      current_period_end = v_end,
      last_paid_order_id = v_order.id,
      updated_at = now()
  where id = v_subscription.id;

  update public.billing_orders
  set status = 'paid', paid_at = p_occurred_at, failed_at = null, failure_reason = null, updated_at = now()
  where id = v_order.id;

  insert into public.billing_email_deliveries(order_id, template, status)
  values (v_order.id, 'payment_confirmation', 'queued')
  on conflict (order_id, template) do nothing;

  update public.billing_notification_events
  set status = 'processed', processed_at = now(), last_error = null
  where provider = p_provider and provider_event_id = p_provider_event_id;

  applied := true;
  subscription_id := v_subscription.id;
  period_id := v_period.id;
  period_end := v_end;
  return next;
end;
$$;

create or replace function public.billing_apply_lava_adjustment(
  p_order_id uuid, p_event_id text, p_event_type text,
  p_amount_minor bigint, p_currency text, p_payload_hash text,
  p_safe_payload jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_order public.billing_orders;
  v_event_status text;
  v_refunded bigint;
  v_subscription_id uuid;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_active_now boolean;
begin
  if p_event_type not in ('refund.success', 'chargeback.initiated') or p_amount_minor <= 0 then
    raise exception 'invalid_lava_adjustment';
  end if;
  insert into public.billing_notification_events(
    provider, provider_event_id, provider_event_type, provider_reference,
    signature_valid, status, payload_hash, safe_payload
  ) values ('lava', p_event_id, p_event_type, p_order_id::text, true, 'received', p_payload_hash, coalesce(p_safe_payload, '{}'::jsonb))
  on conflict (provider, provider_event_id) do update
  set attempts = public.billing_notification_events.attempts + 1
  returning status into v_event_status;
  if v_event_status = 'processed' then return false; end if;

  select * into v_order from public.billing_orders where id = p_order_id for update;
  if not found or v_order.provider <> 'lava' or v_order.currency <> p_currency then
    raise exception 'lava_order_mismatch';
  end if;
  if v_order.status not in ('paid', 'partially_refunded') then
    raise exception 'lava_order_not_adjustable';
  end if;

  if p_event_type = 'refund.success' then
    v_refunded := v_order.refunded_amount_minor + p_amount_minor;
    if v_refunded > v_order.amount_minor then raise exception 'lava_refund_exceeds_payment'; end if;
    update public.billing_orders set
      refunded_amount_minor = v_refunded,
      status = case when v_refunded = amount_minor then 'refunded' else 'partially_refunded' end,
      refunded_at = case when v_refunded = amount_minor then now() else refunded_at end,
      updated_at = now()
    where id = p_order_id;

    if v_refunded = v_order.amount_minor then
      select subscription_id into v_subscription_id
      from public.subscription_periods where order_id = p_order_id for update;
      if v_subscription_id is null then raise exception 'billing_period_not_found'; end if;
      update public.subscription_periods set status = 'refunded', updated_at = now()
      where order_id = p_order_id;
      select min(starts_at), max(ends_at), coalesce(bool_or(starts_at <= now() and ends_at > now()), false)
      into v_period_start, v_period_end, v_active_now
      from public.subscription_periods
      where subscription_id = v_subscription_id and status = 'active' and ends_at > now();
      update public.subscriptions set
        status = case when v_active_now then 'active' else 'expired' end,
        current_period_start = v_period_start,
        current_period_end = v_period_end,
        updated_at = now()
      where id = v_subscription_id;
    end if;
  else
    if p_amount_minor > v_order.amount_minor - v_order.refunded_amount_minor then
      raise exception 'lava_dispute_exceeds_payment';
    end if;
    update public.billing_orders set payment_dispute_status = 'initiated', updated_at = now()
    where id = p_order_id;
  end if;

  update public.billing_notification_events
  set status = 'processed', processed_at = now(), last_error = null
  where provider = 'lava' and provider_event_id = p_event_id;
  return true;
end;
$$;

revoke all on function public.billing_apply_lava_adjustment(uuid,text,text,bigint,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.billing_apply_lava_adjustment(uuid,text,text,bigint,text,text,jsonb) to service_role;

create function public.billing_apply_lava_renewal(
  p_parent_contract_id text, p_invoice_id text, p_amount_minor bigint, p_fee_minor bigint,
  p_currency text, p_occurred_at timestamptz, p_payload_hash text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_root public.billing_orders;
  v_order_id uuid;
  v_event_id text := 'subscription.recurring.payment.success:' || p_invoice_id;
begin
  if p_parent_contract_id = p_invoice_id or p_amount_minor <= 0 or p_fee_minor < 0 or p_fee_minor > p_amount_minor then
    raise exception 'invalid_lava_renewal';
  end if;
  select * into v_root from public.billing_orders
  where provider = 'lava' and provider_order_id = p_parent_contract_id and lava_parent_contract_id is null
  for update;
  if not found or v_root.status not in ('paid', 'partially_refunded', 'refunded') then
    raise exception 'lava_parent_not_paid';
  end if;
  if v_root.amount_minor <> p_amount_minor or v_root.currency <> p_currency then
    raise exception 'lava_renewal_price_mismatch';
  end if;
  insert into public.billing_orders(
    order_number, user_id, plan_id, price_id, provider, payment_method, amount_minor,
    currency, duration_months, plan_name_snapshot, price_name_snapshot, provider_order_id,
    idempotency_key, expires_at, buyer_email, lava_parent_contract_id
  ) values (
    'RS-' || extract(year from p_occurred_at)::integer::text || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
    v_root.user_id, v_root.plan_id, v_root.price_id, 'lava', v_root.payment_method, p_amount_minor,
    p_currency, v_root.duration_months, v_root.plan_name_snapshot, v_root.price_name_snapshot,
    p_invoice_id, p_invoice_id, p_occurred_at + interval '1 hour', v_root.buyer_email, p_parent_contract_id
  ) on conflict (provider, provider_order_id) do nothing returning id into v_order_id;
  if v_order_id is null then
    select id into v_order_id from public.billing_orders where provider = 'lava' and provider_order_id = p_invoice_id;
  end if;
  perform public.billing_apply_payment(
    v_order_id, 'lava', v_event_id, 'subscription.recurring.payment.success', p_invoice_id,
    p_invoice_id, v_root.payment_method, p_amount_minor, p_amount_minor - p_fee_minor,
    p_currency, p_occurred_at, p_payload_hash, jsonb_build_object('parentContractId', p_parent_contract_id)
  );
  return v_order_id;
end;
$$;

create function public.billing_mark_lava_cancelled(
  p_invoice_id text, p_email text, p_event_id text, p_occurred_at timestamptz, p_payload_hash text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_order public.billing_orders;
  v_root_id uuid;
begin
  select * into v_order from public.billing_orders where provider = 'lava' and provider_order_id = p_invoice_id;
  if not found then raise exception 'lava_cancel_order_not_found'; end if;
  if lower(v_order.buyer_email) <> lower(p_email) then raise exception 'lava_cancel_email_mismatch'; end if;
  if v_order.lava_parent_contract_id is null then
    v_root_id := v_order.id;
  else
    select id into v_root_id from public.billing_orders
    where provider = 'lava' and provider_order_id = v_order.lava_parent_contract_id and lava_parent_contract_id is null;
  end if;
  if v_root_id is null then raise exception 'lava_cancel_parent_not_found'; end if;
  update public.billing_orders set lava_auto_renew = false,
    lava_cancelled_at = coalesce(lava_cancelled_at, p_occurred_at), updated_at = now()
  where id = v_root_id;
  insert into public.billing_notification_events(
    provider, provider_event_id, provider_event_type, provider_reference,
    signature_valid, status, payload_hash, safe_payload, processed_at
  ) values ('lava', p_event_id, 'subscription.cancelled', v_root_id::text,
    true, 'processed', p_payload_hash, '{}'::jsonb, now())
  on conflict (provider, provider_event_id) do update set attempts = public.billing_notification_events.attempts + 1;
  return v_root_id;
end;
$$;

revoke all on function public.billing_apply_lava_renewal(text,text,bigint,bigint,text,timestamptz,text) from public, anon, authenticated;
revoke all on function public.billing_mark_lava_cancelled(text,text,text,timestamptz,text) from public, anon, authenticated;
grant execute on function public.billing_apply_lava_renewal(text,text,bigint,bigint,text,timestamptz,text) to service_role;
grant execute on function public.billing_mark_lava_cancelled(text,text,text,timestamptz,text) to service_role;
