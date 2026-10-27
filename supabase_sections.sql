-- Budget sections: Fixed bills / Variable bills / Flexible spending.
--
-- Adds a "section" column to budget_categories and files the built-in
-- categories into a sensible starting section. Change any of them later in
-- the app (Budgets → tap a category → Edit).
--
-- Needs the update rule from supabase_update_policies.sql (run that first if
-- you haven't). Run in Supabase → SQL Editor → New query → paste → Run.
-- Safe to re-run: it never overwrites a section you've already chosen.

alter table budget_categories
  add column if not exists section text
  check (section in ('fixed', 'variable', 'flexible'));

update budget_categories set section = 'fixed'
  where section is null and name in ('Internet', 'Car Insurance', 'House Insurance', 'Taxes');

update budget_categories set section = 'variable'
  where section is null and name in ('Electric', 'Water', 'Sewer', 'Heating Oil', 'Propane', 'Car Repairs', 'Home Repairs');

update budget_categories set section = 'flexible'
  where section is null and name in ('Gas', 'Food', 'Snacks', 'Coffee', 'Eating Out', 'Home Supplies');
