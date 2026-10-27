-- Allow editing in the shared household ledger.
--
-- The original setup only had view / add / delete rules, so Supabase silently
-- blocked every edit: editing an expense failed with "Cannot coerce the result
-- to a single JSON object", and category rename / merge / "Remove as Default"
-- could quietly change nothing.
--
-- Run once in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.

drop policy if exists "Household members can update expenses" on budget_expenses;
create policy "Household members can update expenses"
  on budget_expenses for update
  to authenticated
  using (true) with check (true);

drop policy if exists "Household members can update categories" on budget_categories;
create policy "Household members can update categories"
  on budget_categories for update
  to authenticated
  using (true) with check (true);
