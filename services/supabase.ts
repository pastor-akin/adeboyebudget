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
