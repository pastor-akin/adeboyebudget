import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_CATEGORIES, CategoryEmoji, CategoryColors } from '../constants/theme';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// ─── Types ───────────────────────────────────────────────────────────────────

export type Category = string;

export interface AppCategory {
  name: string;
  emoji: string;
  color: string;
  is_default: boolean;
}

export interface Expense {
  id: string;
  created_at: string;
  date: string;
  amount: number;
  category: Category;
  note?: string;
  added_by?: string;
  added_by_name?: string;
  receipt_url?: string;
}

export interface BudgetLimit {
  id: string;
  month: string;       // "YYYY-MM" for monthly, "YYYY" for yearly
  category: Category;
  amount: number;
  frequency: 'monthly' | 'yearly';
}

export interface Income {
  id: string;
  created_at: string;
  date: string;
  amount: number;
  name: string;
  source: string;
  added_by?: string;
  added_by_name?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function toMonthKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function toYearKey(date: Date = new Date()): string {
  return `${date.getFullYear()}`;
}

export function formatMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString('en-US', {
    month: 'long', year: 'numeric',
  });
}

// ─── Categories ──────────────────────────────────────────────────────────────

export async function getCategories(): Promise<AppCategory[]> {
  const { data, error } = await supabase
    .from('budget_categories')
    .select('*')
    .order('is_default', { ascending: false })
    .order('name');

  if (error || !data || data.length === 0) {
    return DEFAULT_CATEGORIES.map(name => ({
      name,
      emoji: CategoryEmoji[name] ?? '📦',
      color: CategoryColors[name] ?? '#64748B',
      is_default: true,
    }));
  }
  return data;
}

export async function addCategory(name: string, emoji: string, color: string): Promise<void> {
  const { error } = await supabase.from('budget_categories').insert({
    name: name.trim(),
    emoji,
    color,
    is_default: false,
  });
  if (error) throw error;
}

export async function deleteCategory(name: string): Promise<void> {
  const { error } = await supabase
    .from('budget_categories')
    .delete()
    .eq('name', name)
    .eq('is_default', false);
  if (error) throw error;
}

/**
 * Strips a category's "built-in" status (is_default → false) without
 * touching anything else about it — its budget, its expense history, its
 * emoji/color all stay exactly as they are. Once demoted, the category
 * behaves like any custom one: it can be fully deleted (not just cleared)
 * and it can be the source of a merge that actually removes it. Any of the
 * 17 seeded defaults (Coffee, Eating Out, etc.) can be demoted this way —
 * it's a one-way trip; there's no promote-back-to-default action, since a
 * user who wants a category gone doesn't need it to come back as "built-in."
 */
export async function demoteCategory(name: string): Promise<void> {
  const { error } = await supabase
    .from('budget_categories')
    .update({ is_default: false })
    .eq('name', name)
    .eq('is_default', true);
  if (error) throw error;
}

/**
 * Renames a custom category and cascades the new name onto every
 * budget_limits and budget_expenses row that referenced the old name (those
 * tables store the category as a plain string, not a foreign key, so the
 * rename has to be propagated by hand). Past expense history is preserved —
 * only the category label changes.
 */
export async function renameCategory(oldName: string, newName: string): Promise<void> {
  const trimmed = newName.trim();
  if (!trimmed || trimmed === oldName) return;

  const { error: catError } = await supabase
    .from('budget_categories')
    .update({ name: trimmed })
    .eq('name', oldName)
    .eq('is_default', false);
  if (catError) throw catError;

  const { error: limitsError } = await supabase
    .from('budget_limits')
    .update({ category: trimmed })
    .eq('category', oldName);
  if (limitsError) throw limitsError;

  const { error: expensesError } = await supabase
    .from('budget_expenses')
    .update({ category: trimmed })
    .eq('category', oldName);
  if (expensesError) throw expensesError;
}

/**
 * Merges a duplicate category into another one: every expense and every
 * budget_limits row filed under `fromName` is moved onto `intoName` (limits
 * for the same period are summed rather than overwritten), then `fromName`
 * is removed from budget_categories (only if it's a custom category — a
 * default category is cleared of its budget but stays in the list, same as
 * the normal delete behavior). Use this to fix an accidental duplicate
 * category (e.g. two "Eating Out" entries) without losing any history.
 */
// Normalizes a category name for comparison only (never for writing back):
// collapses Unicode look-alikes to one form, trims, and folds internal
// whitespace runs to a single space, then lowercases. Matching this way
// instead of a literal `.eq('category', from)` is what makes merge actually
// find rows for a category name that has picked up an invisible character,
// stray whitespace, or case drift over time (e.g. a direct DB edit) — a
// plain string-equality filter (even a trimmed one) silently matches
// nothing in that case, which is the "Nothing Merged" failure this replaces.
function normalizeCategoryName(s: string): string {
  return s.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

export async function mergeCategory(fromName: string, intoName: string): Promise<{ expensesMoved: number; categoryRemoved: boolean }> {
  const from = fromName;
  const into = intoName;
  const fromKey = normalizeCategoryName(from);
  const intoKey = normalizeCategoryName(into);
  if (!from || !into || fromKey === intoKey) return { expensesMoved: 0, categoryRemoved: false };

  // Fetch everything and match client-side by normalized name, then act on
  // the exact rows found (by id) — this is robust to whatever byte-level
  // drift exists between how `from` is spelled and how it's actually stored.
  const { data: allExpenses, error: expFetchError } = await supabase
    .from('budget_expenses')
    .select('id, category');
  if (expFetchError) throw expFetchError;
  const expenseIds = (allExpenses ?? [])
    .filter(e => normalizeCategoryName(e.category) === fromKey)
    .map(e => e.id);
  if (expenseIds.length > 0) {
    const { error: expError } = await supabase
      .from('budget_expenses')
      .update({ category: into })
      .in('id', expenseIds);
    if (expError) throw expError;
  }

  const { data: allLimits, error: limFetchError } = await supabase.from('budget_limits').select('*');
  if (limFetchError) throw limFetchError;
  const fromLimits = (allLimits ?? []).filter(l => normalizeCategoryName(l.category) === fromKey);
  const intoLimits = (allLimits ?? []).filter(l => normalizeCategoryName(l.category) === intoKey);
  const intoByMonth = new Map(intoLimits.map(l => [l.month, l]));

  for (const fl of fromLimits) {
    const existing = intoByMonth.get(fl.month);
    const amount = existing ? Number(existing.amount) + Number(fl.amount) : Number(fl.amount);
    const { error } = await supabase.from('budget_limits').upsert(
      { month: fl.month, category: into, amount, frequency: fl.frequency, updated_at: new Date().toISOString() },
      { onConflict: 'month,category' },
    );
    if (error) throw error;
  }

  if (fromLimits.length > 0) {
    const { error: delLimitsError } = await supabase
      .from('budget_limits')
      .delete()
      .in('id', fromLimits.map(l => l.id));
    if (delLimitsError) throw delLimitsError;
  }

  // Only a custom (non-default) category actually gets removed here — same
  // rule as the regular delete flow, since a default category always stays
  // in the list. Matched by normalized name too, and deleted by id so a
  // stray character in the stored name can't make this silently no-op.
  const { data: customCats, error: catFetchError } = await supabase
    .from('budget_categories')
    .select('id, name')
    .eq('is_default', false);
  if (catFetchError) throw catFetchError;
  const matchedCat = (customCats ?? []).find(c => normalizeCategoryName(c.name) === fromKey);

  let categoryRemoved = false;
  if (matchedCat) {
    const { error: delCatError } = await supabase
      .from('budget_categories')
      .delete()
      .eq('id', matchedCat.id);
    if (delCatError) throw delCatError;
    categoryRemoved = true;
  }

  return { expensesMoved: expenseIds.length, categoryRemoved };
}

// ─── Expenses ────────────────────────────────────────────────────────────────

export async function getExpenses(month: string): Promise<Expense[]> {
  const [year, mon] = month.split('-').map(Number);
  const start = `${month}-01`;
  const lastDay = new Date(year, mon, 0).getDate();
  const end = `${month}-${String(lastDay).padStart(2, '0')}`;

  const { data, error } = await supabase
    .from('budget_expenses')
    .select('*')
    .gte('date', start)
    .lte('date', end)
    .order('date', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getExpensesForYear(year: string): Promise<Expense[]> {
  const { data, error } = await supabase
    .from('budget_expenses')
    .select('*')
    .gte('date', `${year}-01-01`)
    .lte('date', `${year}-12-31`)
    .order('date', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getAllExpenses(): Promise<Expense[]> {
  const { data, error } = await supabase
    .from('budget_expenses')
    .select('*')
    .order('date', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function uploadReceipt(localUri: string): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  const ext = localUri.split('.').pop() ?? 'jpg';
  const path = `${user?.id}/${Date.now()}.${ext}`;

  const response = await fetch(localUri);
  const blob = await response.blob();

  const { error } = await supabase.storage
    .from('receipts')
    .upload(path, blob, { contentType: `image/${ext}`, upsert: false });
  if (error) throw error;

  const { data, error: urlError } = await supabase.storage
    .from('receipts')
    .createSignedUrl(path, 60 * 60 * 24 * 365);
  if (urlError) throw urlError;
  return data.signedUrl;
}

export async function addExpense(expense: {
  date: string;
  amount: number;
  category: Category;
  note?: string;
  added_by_name?: string;
  receipt_url?: string;
}): Promise<Expense> {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('budget_expenses')
    .insert({ ...expense, added_by: user?.id })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteExpense(id: string): Promise<void> {
  const { error } = await supabase.from('budget_expenses').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Edits an existing expense in place (amount, category, date, note, and/or
 * receipt) instead of the old delete-and-re-add workaround. Only the fields
 * passed in `updates` are changed — omit a field to leave it as-is. Pass
 * `receipt_url: null` to remove an attached receipt without setting a new one.
 */
export async function updateExpense(id: string, updates: {
  date?: string;
  amount?: number;
  category?: Category;
  note?: string;
  receipt_url?: string | null;
}): Promise<Expense> {
  const { data, error } = await supabase
    .from('budget_expenses')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ─── Budgets ─────────────────────────────────────────────────────────────────

export async function getBudgets(month: string): Promise<BudgetLimit[]> {
  const year = month.split('-')[0];
  const { data, error } = await supabase
    .from('budget_limits')
    .select('*')
    .or(`month.eq.${month},month.eq.${year}`);
  if (error) throw error;
  return data ?? [];
}

/** Just the yearly budget rows (one per category) for a given year. */
export async function getYearlyBudgets(year: string): Promise<BudgetLimit[]> {
  const { data, error } = await supabase
    .from('budget_limits')
    .select('*')
    .eq('month', year)
    .eq('frequency', 'yearly');
  if (error) throw error;
  return data ?? [];
}

export async function upsertBudget(
  period: string,
  category: Category,
  amount: number,
  frequency: 'monthly' | 'yearly' = 'monthly',
): Promise<void> {
  const { error } = await supabase.from('budget_limits').upsert(
    { month: period, category, amount, frequency, updated_at: new Date().toISOString() },
    { onConflict: 'month,category' },
  );
  if (error) throw error;
}

export async function deleteBudget(period: string, category: Category): Promise<void> {
  const { error } = await supabase
    .from('budget_limits')
    .delete()
    .eq('month', period)
    .eq('category', category);
  if (error) throw error;
}

/**
 * Which months a yearly budget for `year` should be spread across.
 * Always all 12 months (Jan–Dec) — the monthly amount is simply the yearly
 * total divided by 12.
 */
export function getYearlyDistributionMonths(year: string): string[] {
  const months: string[] = [];
  for (let m = 1; m <= 12; m++) {
    months.push(`${year}-${String(m).padStart(2, '0')}`);
  }
  return months;
}

/**
 * Splits a yearly budget for a category evenly across the applicable months
 * of that year (see getYearlyDistributionMonths) and writes each as its own
 * monthly budget_limits row (upsert, so existing monthly rows for those
 * months/category are overwritten). Any leftover cent remainder from the
 * division is folded into the last month so the amounts always sum exactly
 * to the yearly total.
 */
export async function distributeYearlyBudget(
  year: string,
  category: Category,
  yearlyAmount: number,
): Promise<void> {
  const months = getYearlyDistributionMonths(year);
  if (months.length === 0) return;

  const perMonth = Math.floor((yearlyAmount / months.length) * 100) / 100;
  const remainder = Math.round((yearlyAmount - perMonth * months.length) * 100) / 100;

  const rows = months.map((month, i) => ({
    month,
    category,
    amount: i === months.length - 1 ? Math.round((perMonth + remainder) * 100) / 100 : perMonth,
    frequency: 'monthly' as const,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from('budget_limits')
    .upsert(rows, { onConflict: 'month,category' });
  if (error) throw error;
}

/**
 * Removes the monthly budget_limits rows for a category/year (the same
 * months getYearlyDistributionMonths would target) that were created by
 * distributeYearlyBudget — used when the yearly budget is cleared.
 */
export async function clearYearlyDistribution(year: string, category: Category): Promise<void> {
  const months = getYearlyDistributionMonths(year);
  if (months.length === 0) return;
  const { error } = await supabase
    .from('budget_limits')
    .delete()
    .eq('category', category)
    .eq('frequency', 'monthly')
    .in('month', months);
  if (error) throw error;
}

// ─── Income ──────────────────────────────────────────────────────────────────

export async function getIncome(month: string): Promise<Income[]> {
  const [year, mon] = month.split('-').map(Number);
  const start = `${month}-01`;
  const lastDay = new Date(year, mon, 0).getDate();
  const end = `${month}-${String(lastDay).padStart(2, '0')}`;

  const { data, error } = await supabase
    .from('budget_income')
    .select('*')
    .gte('date', start)
    .lte('date', end)
    .order('date', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getIncomeForYear(year: string): Promise<Income[]> {
  const { data, error } = await supabase
    .from('budget_income')
    .select('*')
    .gte('date', `${year}-01-01`)
    .lte('date', `${year}-12-31`)
    .order('date', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Total income, computed client-side from a fetched list. */
export function sumIncome(income: Income[]): number {
  return income.reduce((s, i) => s + Number(i.amount), 0);
}

export async function addIncome(income: {
  date: string;
  amount: number;
  name?: string;
  source?: string;
  added_by_name?: string;
}): Promise<Income> {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('budget_income')
    .insert({ ...income, added_by: user?.id })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteIncome(id: string): Promise<void> {
  const { error } = await supabase.from('budget_income').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Distinct names ever entered (across all time) — powers the type-ahead
 * suggestions when logging new income, since sources repeat (same employer,
 * same clients). Most-recently-used names come first.
 */
export async function getIncomeNames(): Promise<string[]> {
  const { data, error } = await supabase
    .from('budget_income')
    .select('name')
    .neq('name', '')
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw error;
  const seen = new Set<string>();
  const names: string[] = [];
  for (const row of data ?? []) {
    const n = (row.name ?? '').trim();
    const key = n.toLowerCase();
    if (n && !seen.has(key)) { seen.add(key); names.push(n); }
  }
  return names;
}

// ─── Budget pacing / reporting helpers ────────────────────────────────────
// A category's yearly budget amount is spread evenly across 12 months (see
// distributeYearlyBudget). Expenses aren't necessarily paid evenly though —
// insurance, dues, etc. often land as a single lump sum in one month — so
// "remaining" here is a running/cumulative total: how much you've spent
// so far vs. how much you'd expect to have spent by that point in the year
// if pacing evenly. A lump-sum payment shows as sharply over-budget the
// month it's paid, then the gap closes back toward $0 as later months'
// planned amounts "catch up" to the actual spend.

export const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export interface MonthlyBudgetRow {
  month: number;              // 1-12
  monthLabel: string;
  monthlyPlanned: number;     // yearlyAmount / 12
  monthlyActual: number;      // sum of this month's expenses
  cumulativePlanned: number;  // monthlyPlanned * month
  cumulativeActual: number;   // sum of all expenses Jan through this month
  cumulativeRemaining: number; // cumulativePlanned - cumulativeActual (negative = over budget)
}

/** Builds the 12-month pacing breakdown for one category, from its own expense list. */
export function buildMonthlyBreakdown(yearlyAmount: number, year: string, expenses: Expense[]): MonthlyBudgetRow[] {
  const monthlyPlanned = yearlyAmount / 12;

  const actualByMonth: Record<number, number> = {};
  for (const e of expenses) {
    if (!e.date?.startsWith(year)) continue;
    const m = parseInt(e.date.slice(5, 7), 10);
    if (m >= 1 && m <= 12) actualByMonth[m] = (actualByMonth[m] ?? 0) + Number(e.amount);
  }

  const rows: MonthlyBudgetRow[] = [];
  let cumulativeActual = 0;
  for (let m = 1; m <= 12; m++) {
    const monthlyActual = actualByMonth[m] ?? 0;
    cumulativeActual += monthlyActual;
    const cumulativePlanned = monthlyPlanned * m;
    rows.push({
      month: m,
      monthLabel: MONTH_LABELS[m - 1],
      monthlyPlanned,
      monthlyActual,
      cumulativePlanned,
      cumulativeActual,
      cumulativeRemaining: cumulativePlanned - cumulativeActual,
    });
  }
  return rows;
}

export interface MonthlyComparisonRow {
  month: number;
  monthLabel: string;
  income: number;
  expenses: number;
  net: number;
  budgeted: number;
  cumulativeBudgeted: number;
  cumulativeExpenses: number;
  cumulativeVariance: number;
}

/** Builds a Jan–Dec income-vs-expenses-vs-budget comparison for one year. */
export function buildMonthlyComparison(
  year: string,
  income: Income[],
  expenses: Expense[],
  totalPlanned: number,
): MonthlyComparisonRow[] {
  const incomeByMonth: Record<number, number> = {};
  for (const i of income) {
    if (!i.date?.startsWith(year)) continue;
    const m = parseInt(i.date.slice(5, 7), 10);
    if (m >= 1 && m <= 12) incomeByMonth[m] = (incomeByMonth[m] ?? 0) + Number(i.amount);
  }
  const expensesByMonth: Record<number, number> = {};
  for (const e of expenses) {
    if (!e.date?.startsWith(year)) continue;
    const m = parseInt(e.date.slice(5, 7), 10);
    if (m >= 1 && m <= 12) expensesByMonth[m] = (expensesByMonth[m] ?? 0) + Number(e.amount);
  }
  const monthlyBudgeted = totalPlanned / 12;

  const rows: MonthlyComparisonRow[] = [];
  let cumulativeBudgeted = 0;
  let cumulativeExpenses = 0;
  for (let m = 1; m <= 12; m++) {
    const inc = incomeByMonth[m] ?? 0;
    const exp = expensesByMonth[m] ?? 0;
    cumulativeBudgeted += monthlyBudgeted;
    cumulativeExpenses += exp;
    rows.push({
      month: m,
      monthLabel: MONTH_LABELS[m - 1],
      income: inc,
      expenses: exp,
      net: inc - exp,
      budgeted: monthlyBudgeted,
      cumulativeBudgeted,
      cumulativeExpenses,
      cumulativeVariance: cumulativeBudgeted - cumulativeExpenses,
    });
  }
  return rows;
}

function csvEscape(v: string): string {
  return `"${(v ?? '').replace(/"/g, '""')}"`;
}

/** Builds a CSV string of every expense for the year, for export/sharing. */
export function buildBudgetCsv(expenses: Expense[]): string {
  const headers = ['Category', 'Date', 'Amount', 'Note', 'Receipt URL'];
  const rows = expenses.map(e => [
    e.category,
    e.date,
    String(e.amount),
    e.note ?? '',
    e.receipt_url ?? '',
  ].map(csvEscape).join(','));
  return [headers.map(csvEscape).join(','), ...rows].join('\n');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Builds a printable/shareable HTML budget report for one year: a
 * three-stat summary, a per-category budgeted-vs-actual table, and a
 * month-by-month income/expenses/net table. Feed the HTML string to
 * expo-print's printToFileAsync — on native it writes a real PDF file you
 * can then hand to expo-sharing; on web it opens the browser's print
 * dialog, where "Save as PDF" is one of the destinations (expo-print does
 * not produce a downloadable PDF file directly on web).
 *
 * `generatedAt` is a pre-formatted date string rather than computed here,
 * since some callers (e.g. workflow scripts) can't use `new Date()`.
 */
export function buildBudgetReportHtml(params: {
  yearKey: string;
  categories: AppCategory[];
  plannedByCategory: Record<string, number>;
  spentByCategory: Record<string, number>;
  income: Income[];
  expenses: Expense[];
  generatedAt: string;
}): string {
  const { yearKey, categories, plannedByCategory, spentByCategory, income, expenses, generatedAt } = params;

  const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money = (n: number) => (n < 0 ? `-$${fmt(Math.abs(n))}` : `$${fmt(n)}`);

  const totalPlanned = Object.values(plannedByCategory).reduce((s, v) => s + v, 0);
  const totalSpent = Object.values(spentByCategory).reduce((s, v) => s + v, 0);
  const totalIncome = sumIncome(income);
  const net = totalIncome - totalSpent;

  const categoryRows = categories
    .map(c => ({ c, planned: plannedByCategory[c.name] ?? 0, spent: spentByCategory[c.name] ?? 0 }))
    .filter(r => r.planned > 0 || r.spent > 0)
    .sort((a, b) => b.spent - a.spent)
    .map(r => {
      const remaining = r.planned - r.spent;
      return `<tr>
        <td>${escapeHtml(r.c.emoji)} ${escapeHtml(r.c.name)}</td>
        <td class="num">${r.planned > 0 ? money(r.planned) : '—'}</td>
        <td class="num">${money(r.spent)}</td>
        <td class="num ${r.planned > 0 ? (remaining < 0 ? 'over' : 'under') : ''}">${r.planned > 0 ? money(remaining) : '—'}</td>
      </tr>`;
    })
    .join('');

  const monthRows = buildMonthlyComparison(yearKey, income, expenses, totalPlanned)
    .map(row => `<tr>
      <td>${row.monthLabel}</td>
      <td class="num">${row.income > 0 ? money(row.income) : '—'}</td>
      <td class="num">${row.expenses > 0 ? money(row.expenses) : '—'}</td>
      <td class="num ${row.net < 0 ? 'over' : 'under'}">${money(row.net)}</td>
    </tr>`)
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; color: #1E293B; padding: 32px; margin: 0; }
  h1 { font-size: 22px; margin: 0 0 2px; }
  .subtitle { color: #64748B; font-size: 12.5px; margin-bottom: 22px; }
  .summary { display: flex; gap: 12px; margin-bottom: 26px; }
  .stat { flex: 1; border: 1px solid #E2E8F0; border-radius: 10px; padding: 12px 14px; }
  .stat-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: .6px; color: #64748B; }
  .stat-value { font-size: 19px; font-weight: 700; margin-top: 3px; }
  h2 { font-size: 14px; margin: 22px 0 8px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid #E2E8F0; font-size: 12.5px; }
  th { text-transform: uppercase; font-size: 9.5px; letter-spacing: .5px; color: #64748B; font-weight: 700; }
  td.num, th.num { text-align: right; }
  .over { color: #DC2626; font-weight: 700; }
  .under { color: #059669; font-weight: 700; }
  .footer { margin-top: 26px; font-size: 10.5px; color: #94A3B8; }
  @media print { body { padding: 12px; } }
</style>
</head>
<body>
  <h1>Adeboye Monthly Budget</h1>
  <div class="subtitle">${escapeHtml(yearKey)} Report — generated ${escapeHtml(generatedAt)}</div>

  <div class="summary">
    <div class="stat"><div class="stat-label">Total Income</div><div class="stat-value" style="color:#059669">${money(totalIncome)}</div></div>
    <div class="stat"><div class="stat-label">Total Expenses</div><div class="stat-value" style="color:#F97316">${money(totalSpent)}</div></div>
    <div class="stat"><div class="stat-label">Net</div><div class="stat-value ${net < 0 ? 'over' : 'under'}">${money(net)}</div></div>
  </div>

  <h2>Categories</h2>
  <table>
    <tr><th>Category</th><th class="num">Budgeted</th><th class="num">Spent</th><th class="num">Remaining</th></tr>
    ${categoryRows || '<tr><td colspan="4" style="color:#94A3B8">No category activity this year.</td></tr>'}
  </table>

  <h2>Income vs. Expenses by Month</h2>
  <table>
    <tr><th>Month</th><th class="num">Income</th><th class="num">Expenses</th><th class="num">Net</th></tr>
    ${monthRows}
  </table>

  <div class="footer">Adeboye Monthly Budget · generated ${escapeHtml(generatedAt)}</div>
</body>
</html>`;
}
