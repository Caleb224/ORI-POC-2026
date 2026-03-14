create extension if not exists pgcrypto;

create table if not exists policies (
  id uuid primary key default gen_random_uuid(),
  policy_number text not null unique,
  holder_name text not null,
  status text not null check (status in ('quoted', 'approved', 'active', 'inactive', 'declined')),
  premium_cents integer not null check (premium_cents > 0),
  effective_date date not null,
  end_date date not null,
  issued_at timestamptz,
  created_at timestamptz not null default now()
);

alter table policies add column if not exists end_date date;
update policies
set end_date = (effective_date + interval '1 year')::date
where end_date is null;
alter table policies alter column end_date set not null;

alter table policies add column if not exists issued_at timestamptz;
update policies
set issued_at = created_at
where issued_at is null and status in ('active', 'inactive');

alter table policies drop constraint if exists policies_status_check;
alter table policies
  add constraint policies_status_check
  check (status in ('quoted', 'approved', 'active', 'inactive', 'declined'));

insert into policies (
  policy_number,
  holder_name,
  status,
  premium_cents,
  effective_date,
  end_date,
  issued_at
)
values
  ('POL-2026-0001', 'Jamie Chen', 'quoted', 125000, '2026-04-01', '2027-04-01', null),
  ('POL-2026-0002', 'Aria Singh', 'approved', 98000, '2026-04-15', '2027-04-15', null),
  ('POL-2026-0003', 'Jordan Miles', 'active', 157500, '2026-03-20', '2026-09-20', '2026-03-20T00:00:00Z'),
  ('POL-2026-0004', 'Riley Park', 'declined', 112500, '2026-03-28', '2027-03-28', null),
  ('POL-2025-0099', 'Taylor Brooks', 'inactive', 110000, '2025-02-01', '2025-08-01', '2025-02-01T00:00:00Z')
on conflict (policy_number) do nothing;
