-- Adeboye Monthly Budget — Income
-- Run once in the Supabase SQL editor. Safe to re-run.
-- Tracks money coming in (paychecks, freelance, gifts, etc.) alongside the
-- existing budget_expenses (money going out).

create table if not exists budget_income (
  id              uuid        default gen_random_uuid() primary key,
  created_at      timestamptz default now(),
  date            date        not null default current_date,
  amount          numeric(10, 2) not null,
  name            text        not null default '',  -- who it's from (employer, client, etc.)
  source          text        not null default '',  -- e.g. Paycheck, Freelance, Gift, Reimbursement
  added_by        uuid        references auth.users(id) on delete set null,
  added_by_name   text
);

alter table budget_income enable row level security;

drop policy if exists "Authenticated users can view all income" on budget_income;
create policy "Authenticated users can view all income"
  on budget_income for select
  to authenticated using (true);

drop policy if exists "Authenticated users can add income" on budget_income;
create policy "Authenticated users can add income"
  on budget_income for insert
  to authenticated with check (true);

drop policy if exists "Users can delete their own income" on budget_income;
create policy "Users can delete their own income"
  on budget_income for delete
  to authenticated using (auth.uid() = added_by);

create index if not exists budget_income_name_idx on budget_income(name);
