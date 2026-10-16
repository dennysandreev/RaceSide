-- Failed initial invoices must not prevent a customer from trying checkout again.
-- Keep pending and paid contracts unique until auto-renewal is explicitly cancelled.
drop index public.billing_orders_one_recurring_lava_per_user;

create unique index billing_orders_one_recurring_lava_per_user on public.billing_orders(user_id)
  where provider = 'lava' and lava_auto_renew and lava_parent_contract_id is null
    and status in ('pending', 'paid', 'partially_refunded', 'refunded');
