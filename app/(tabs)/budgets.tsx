/*
 * Adeboye Monthly Budget — Budgets tab
 * Styled to match Palace Church Boston's Church Budget screen exactly
 * (the-palace-app-v2/app/church-budget.tsx): same layout, same dark-purple
 * theme (scoped to this screen via constants/palaceTheme.ts), same
 * Categories / Income / Overview mode switcher, same monthly pacing table.
 *
 * Data comes from adeboye-budget's own tables (budget_categories,
 * budget_limits, budget_expenses, budget_income) — both household members
 * have full access, so there's no admin gate like Palace's.
 */
import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, TextInput,
  KeyboardAvoidingView, Platform, ActivityIndicator, Image, Share, Alert as RNAlert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import {
  supabase, AppCategory, BudgetLimit, Expense, Income,
  getCategories, addCategory, renameCategory, deleteCategory,
  getYearlyBudgets, upsertBudget, deleteBudget,
  distributeYearlyBudget, clearYearlyDistribution,
  getExpensesForYear, addExpense, deleteExpense, uploadReceipt,
  getIncomeForYear, addIncome, deleteIncome, getIncomeNames, sumIncome,
  buildMonthlyBreakdown, buildMonthlyComparison, buildBudgetCsv,
} from '../../services/supabase';
import {
  PalaceColors as Colors, PalaceSpacing as Spacing, PalaceRadius as Radius,
  PalaceShadow as Shadow, PalaceTypography as Typography,
} from '../../constants/palaceTheme';

type Mode = 'categories' | 'expenses' | 'income' | 'overview';

function fmt(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Expense.note doubles as "Vendor | Description" so the UI can show both
// fields (matching Palace's layout) without needing a schema change.
function encodeNote(vendor: string, desc: string): string | undefined {
  const v = vendor.trim(), d = desc.trim();
  if (v && d) return `${v} | ${d}`;
  return v || d || undefined;
}
function decodeNote(note?: string): { vendor: string; desc: string } {
  if (!note) return { vendor: '', desc: '' };
  const idx = note.indexOf(' | ');
  if (idx === -1) return { vendor: '', desc: note };
  return { vendor: note.slice(0, idx), desc: note.slice(idx + 3) };
}

export default function BudgetsScreen() {
  const [year, setYear] = useState(new Date().getFullYear());
  const yearKey = String(year);
  const [mode, setMode] = useState<Mode>('categories');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [userName, setUserName] = useState('');

  const [categories, setCategories] = useState<AppCategory[]>([]);
  const [plannedByCategory, setPlannedByCategory] = useState<Record<string, number>>({});
  const [allExpenses, setAllExpenses] = useState<Expense[]>([]);
  const [spentByCategory, setSpentByCategory] = useState<Record<string, number>>({});

  // add/edit category form
  const [showCatForm, setShowCatForm] = useState(false);
  const [catName, setCatName] = useState('');
  const [catPlanned, setCatPlanned] = useState('');
  const [editingCatOriginalName, setEditingCatOriginalName] = useState<string | null>(null);

  // expenses drill-down
  const [activeCategory, setActiveCategory] = useState<AppCategory | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);

  // add-expense form
  const [showExpForm, setShowExpForm] = useState(false);
  const [expAmount, setExpAmount] = useState('');
  const [expVendor, setExpVendor] = useState('');
  const [expDesc, setExpDesc] = useState('');
  const [expDate, setExpDate] = useState(todayStr());
  const [expReceiptUri, setExpReceiptUri] = useState<string | null>(null);

  // income
  const [income, setIncome] = useState<Income[]>([]);
  const [incomeLoading, setIncomeLoading] = useState(true);
  const [giverNames, setGiverNames] = useState<string[]>([]);
  const [showIncForm, setShowIncForm] = useState(false);
  const [incAmount, setIncAmount] = useState('');
  const [incName, setIncName] = useState('');
  const [incSource, setIncSource] = useState('');
  const [incDate, setIncDate] = useState(todayStr());
  const [showNameSuggestions, setShowNameSuggestions] = useState(false);

  React.useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserName(user?.email?.split('@')[0] ?? 'You');
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cats, bud, exps] = await Promise.all([
        getCategories(),
        getYearlyBudgets(yearKey),
        getExpensesForYear(yearKey),
      ]);
      setCategories(cats);
      const planned: Record<string, number> = {};
      for (const b of bud) planned[b.category] = b.amount;
      setPlannedByCategory(planned);
      setAllExpenses(exps);
      const spent: Record<string, number> = {};
      for (const e of exps) spent[e.category] = (spent[e.category] ?? 0) + Number(e.amount);
      setSpentByCategory(spent);
    } finally {
      setLoading(false);
    }
  }, [yearKey]);

  const loadIncome = useCallback(async () => {
    setIncomeLoading(true);
    try {
      const [rows, names] = await Promise.all([getIncomeForYear(yearKey), getIncomeNames()]);
      setIncome(rows);
      setGiverNames(names);
    } finally {
      setIncomeLoading(false);
    }
  }, [yearKey]);

  React.useEffect(() => { load(); }, [load]);
  React.useEffect(() => { if (mode === 'income' || mode === 'overview') loadIncome(); }, [loadIncome, mode]);

  const nameSuggestions = (() => {
    const q = incName.trim().toLowerCase();
    if (!q) return [];
    return giverNames.filter(n => n.toLowerCase().startsWith(q) && n.toLowerCase() !== q).slice(0, 5);
  })();

  const openNewIncome = () => {
    setIncAmount(''); setIncName(''); setIncSource(''); setIncDate(todayStr());
    setShowNameSuggestions(false);
    setShowIncForm(true);
  };

  const saveIncome = async () => {
    const amount = parseFloat(incAmount || '');
    if (isNaN(amount) || amount <= 0) { Alert('Invalid Amount', 'Enter a valid income amount.'); return; }
    if (!incDate.trim()) { Alert('Date Required', 'Enter the income date (YYYY-MM-DD).'); return; }
    setBusy(true);
    try {
      const created = await addIncome({
        date: incDate.trim(), amount, name: incName.trim(), source: incSource.trim(), added_by_name: userName,
      });
      setIncome(p => [created, ...p]);
      if (incName.trim() && !giverNames.some(n => n.toLowerCase() === incName.trim().toLowerCase())) {
        setGiverNames(p => [incName.trim(), ...p]);
      }
      setShowIncForm(false);
    } catch (e: any) {
      Alert('Error', e.message ?? 'Could not save this income entry.');
    } finally {
      setBusy(false);
    }
  };

  const removeIncome = (i: Income) => {
    AlertConfirm('Delete Income', `Remove this $${fmt(i.amount)} income entry? This can't be undone.`, async () => {
      try { await deleteIncome(i.id); setIncome(p => p.filter(x => x.id !== i.id)); }
      catch (e: any) { Alert('Error', e.message ?? 'Could not delete this income entry.'); }
    });
  };

  // ── Category actions ───────────────────────────────────────────────────
  const openNewCategory = () => { setEditingCatOriginalName(null); setCatName(''); setCatPlanned(''); setShowCatForm(true); };
  const openEditCategory = (c: AppCategory) => {
    setEditingCatOriginalName(c.name);
    setCatName(c.name);
    setCatPlanned(plannedByCategory[c.name] ? String(plannedByCategory[c.name]) : '');
    setShowCatForm(true);
  };

  const saveCategory = async () => {
    if (!catName.trim()) { Alert('Name Required', 'Give the category a name.'); return; }
    const planned = parseFloat(catPlanned || '0');
    if (isNaN(planned) || planned < 0) { Alert('Invalid Amount', 'Enter a valid planned amount.'); return; }
    setBusy(true);
    try {
      const finalName = catName.trim();
      if (editingCatOriginalName) {
        if (finalName !== editingCatOriginalName) await renameCategory(editingCatOriginalName, finalName);
      } else {
        await addCategory(finalName, '📦', '#8B5CF6');
      }
      if (planned > 0) {
        await upsertBudget(yearKey, finalName, planned, 'yearly');
        await distributeYearlyBudget(yearKey, finalName, planned);
      } else {
        await deleteBudget(yearKey, finalName);
        await clearYearlyDistribution(yearKey, finalName);
      }
      setShowCatForm(false);
      load();
    } catch (e: any) {
      Alert('Error', e.message ?? (editingCatOriginalName ? 'Could not update this category.' : 'Could not create this category — it may already exist.'));
    } finally {
      setBusy(false);
    }
  };

  const removeCategory = (c: AppCategory) => {
    const msg = c.is_default
      ? `Clear the ${yearKey} budget for "${c.name}"? It's a built-in category so it'll stay in the list with no limit set. Past expense history stays intact.`
      : `Delete "${c.name}" and its ${yearKey} budget? Past expense history stays intact. This can't be undone.`;
    AlertConfirm('Delete Category', msg, async () => {
      try {
        await deleteBudget(yearKey, c.name);
        await clearYearlyDistribution(yearKey, c.name);
        if (!c.is_default) await deleteCategory(c.name);
        load();
      } catch (e: any) {
        Alert('Error', e.message ?? 'Could not delete this category.');
      }
    });
  };

  // ── Expenses drill-down ────────────────────────────────────────────────
  const openExpenses = (c: AppCategory) => {
    setActiveCategory(c);
    setExpenses(allExpenses.filter(e => e.category === c.name));
    setMode('expenses');
  };

  const pickReceiptPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert('Permission Needed', 'Allow photo access to attach a receipt.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7, allowsEditing: true });
    if (!result.canceled && result.assets?.[0]) setExpReceiptUri(result.assets[0].uri);
  };

  const openNewExpense = () => {
    setExpAmount(''); setExpVendor(''); setExpDesc(''); setExpDate(todayStr()); setExpReceiptUri(null);
    setShowExpForm(true);
  };

  const saveExpense = async () => {
    if (!activeCategory) return;
    const amount = parseFloat(expAmount || '');
    if (isNaN(amount) || amount <= 0) { Alert('Invalid Amount', 'Enter a valid expense amount.'); return; }
    if (!expDate.trim()) { Alert('Date Required', 'Enter the expense date (YYYY-MM-DD).'); return; }
    setBusy(true);
    try {
      let receipt_url: string | undefined;
      if (expReceiptUri) receipt_url = await uploadReceipt(expReceiptUri);
      const created = await addExpense({
        date: expDate.trim(), amount, category: activeCategory.name,
        note: encodeNote(expVendor, expDesc), added_by_name: userName, receipt_url,
      });
      setExpenses(p => [created, ...p]);
      setAllExpenses(p => [created, ...p]);
      setSpentByCategory(p => ({ ...p, [activeCategory.name]: (p[activeCategory.name] ?? 0) + amount }));
      setShowExpForm(false);
    } catch (e: any) {
      Alert('Error', e.message ?? 'Could not save this expense.');
    } finally {
      setBusy(false);
    }
  };

  const removeExpense = (e: Expense) => {
    AlertConfirm('Delete Expense', `Remove this $${fmt(e.amount)} expense? This can't be undone.`, async () => {
      try {
        await deleteExpense(e.id);
        setExpenses(p => p.filter(x => x.id !== e.id));
        setAllExpenses(p => p.filter(x => x.id !== e.id));
        if (activeCategory) setSpentByCategory(p => ({ ...p, [activeCategory.name]: Math.max(0, (p[activeCategory.name] ?? 0) - Number(e.amount)) }));
      } catch (err: any) {
        Alert('Error', err.message ?? 'Could not delete this expense.');
      }
    });
  };

  // ── Export ──────────────────────────────────────────────────────────────
  const exportBudget = async () => {
    if (allExpenses.length === 0) { Alert('Nothing to Export', `No expenses logged for ${yearKey} yet.`); return; }
    const csv = buildBudgetCsv(allExpenses);
    try { await Share.share({ message: csv, title: `${yearKey} Budget` }); }
    catch { Alert('Error', 'Could not open the share sheet.'); }
  };

  // ── EXPENSES DRILL-DOWN ─────────────────────────────────────────────────
  if (mode === 'expenses' && activeCategory) {
    const planned = plannedByCategory[activeCategory.name] ?? 0;
    const spent = spentByCategory[activeCategory.name] ?? 0;
    const remaining = planned - spent;
    return (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <SafeAreaView style={styles.container} edges={['top']}>
          <View style={styles.header}>
            <Pressable style={styles.backBtn} onPress={() => { setMode('categories'); setActiveCategory(null); }} hitSlop={8}>
              <MaterialIcons name="arrow-back" size={22} color={Colors.textPrimary} />
            </Pressable>
            <Text style={styles.headerTitle} numberOfLines={1}>{activeCategory.emoji} {activeCategory.name}</Text>
            <Pressable style={styles.newBtn} onPress={openNewExpense}>
              <MaterialIcons name="add" size={18} color="#fff" /><Text style={styles.newBtnText}>Expense</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ padding: Spacing.md, gap: Spacing.sm, paddingBottom: 40 }}>
            <View style={styles.summaryCard}>
              <View style={styles.summaryRow}>
                <View style={{ flex: 1 }}><Text style={styles.summaryLabel}>Planned</Text><Text style={styles.summaryVal}>${fmt(planned)}</Text></View>
                <View style={{ flex: 1 }}><Text style={styles.summaryLabel}>Spent</Text><Text style={[styles.summaryVal, { color: '#F97316' }]}>${fmt(spent)}</Text></View>
                <View style={{ flex: 1 }}><Text style={styles.summaryLabel}>Remaining</Text><Text style={[styles.summaryVal, { color: remaining < 0 ? '#EF4444' : '#10B981' }]}>${fmt(remaining)}</Text></View>
              </View>
              <View style={styles.progressBarBg}>
                <View style={[styles.progressBarFill, { width: `${Math.min(100, planned > 0 ? (spent / planned) * 100 : 0)}%` as any, backgroundColor: remaining < 0 ? '#EF4444' : Colors.primary }]} />
              </View>
            </View>

            <Text style={styles.sectionLabel}>Monthly Pace ({yearKey})</Text>
            <View style={styles.monthlyCard}>
              <View style={styles.monthlyHeaderRow}>
                <Text style={[styles.monthlyHeaderCell, { flex: 1.1 }]}>Month</Text>
                <Text style={[styles.monthlyHeaderCell, { flex: 1, textAlign: 'right' }]}>Planned</Text>
                <Text style={[styles.monthlyHeaderCell, { flex: 1, textAlign: 'right' }]}>Actual</Text>
                <Text style={[styles.monthlyHeaderCell, { flex: 1.2, textAlign: 'right' }]}>Remaining</Text>
              </View>
              {buildMonthlyBreakdown(planned, yearKey, expenses).map(row => {
                const isCurrentMonth = year === new Date().getFullYear() && row.month === new Date().getMonth() + 1;
                return (
                  <View key={row.month} style={[styles.monthlyRow, isCurrentMonth && styles.monthlyRowActive]}>
                    <Text style={[styles.monthlyCell, { flex: 1.1, fontWeight: isCurrentMonth ? '700' : '600', color: isCurrentMonth ? Colors.primary : Colors.textPrimary }]}>{row.monthLabel}</Text>
                    <Text style={[styles.monthlyCell, { flex: 1, textAlign: 'right' }]}>${fmt(row.monthlyPlanned)}</Text>
                    <Text style={[styles.monthlyCell, { flex: 1, textAlign: 'right', color: row.monthlyActual > 0 ? '#F97316' : Colors.textMuted }]}>{row.monthlyActual > 0 ? `$${fmt(row.monthlyActual)}` : '—'}</Text>
                    <Text style={[styles.monthlyCell, { flex: 1.2, textAlign: 'right', fontWeight: '700', color: row.cumulativeRemaining < 0 ? '#EF4444' : '#10B981' }]}>
                      {row.cumulativeRemaining < 0 ? `-$${fmt(Math.abs(row.cumulativeRemaining))}` : `$${fmt(row.cumulativeRemaining)}`}
                    </Text>
                  </View>
                );
              })}
            </View>
            <Text style={styles.monthlyFootnote}>
              Remaining is a running total — a lump-sum payment shows as over-budget the month it's paid, then later months' planned amounts close the gap back toward $0.
            </Text>

            {expenses.length === 0 ? (
              <Text style={styles.emptyText}>No expenses logged yet for this category.</Text>
            ) : expenses.map(e => {
              const { vendor, desc } = decodeNote(e.note);
              return (
                <View key={e.id} style={styles.expCard}>
                  {e.receipt_url ? (
                    <Image source={{ uri: e.receipt_url }} style={styles.expThumb} />
                  ) : (
                    <View style={[styles.expThumb, styles.expThumbPlaceholder]}><MaterialIcons name="receipt-long" size={20} color={Colors.textMuted} /></View>
                  )}
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={styles.expAmount}>${fmt(Number(e.amount))}</Text>
                      <Text style={styles.expDate}>{e.date}</Text>
                    </View>
                    {!!vendor && <Text style={styles.expVendor}>{vendor}</Text>}
                    {!!desc && <Text style={styles.expDesc} numberOfLines={2}>{desc}</Text>}
                  </View>
                  <Pressable onPress={() => removeExpense(e)} hitSlop={8}><MaterialIcons name="delete-outline" size={18} color="#EF4444" /></Pressable>
                </View>
              );
            })}
          </ScrollView>

          {showExpForm ? (
            <View style={styles.sheetOverlay}>
              <View style={styles.sheet}>
                <Text style={styles.sheetTitle}>New Expense</Text>
                <Text style={styles.blockLabel}>Amount *</Text>
                <TextInput style={styles.input} value={expAmount} onChangeText={setExpAmount} placeholder="0.00" placeholderTextColor={Colors.textMuted} keyboardType="decimal-pad" />
                <Text style={[styles.blockLabel, { marginTop: 10 }]}>Vendor</Text>
                <TextInput style={styles.input} value={expVendor} onChangeText={setExpVendor} placeholder="e.g. Home Depot" placeholderTextColor={Colors.textMuted} />
                <Text style={[styles.blockLabel, { marginTop: 10 }]}>Description</Text>
                <TextInput style={[styles.input, { minHeight: 60 }]} value={expDesc} onChangeText={setExpDesc} placeholder="What was this for?" placeholderTextColor={Colors.textMuted} multiline />
                <Text style={[styles.blockLabel, { marginTop: 10 }]}>Date</Text>
                <TextInput style={styles.input} value={expDate} onChangeText={setExpDate} placeholder="YYYY-MM-DD" placeholderTextColor={Colors.textMuted} />
                <Pressable style={styles.receiptPickRow} onPress={pickReceiptPhoto}>
                  <MaterialIcons name="photo-camera" size={18} color={Colors.primary} />
                  <Text style={styles.receiptPickText}>{expReceiptUri ? 'Change receipt photo' : 'Attach receipt photo'}</Text>
                </Pressable>
                {expReceiptUri ? <Image source={{ uri: expReceiptUri }} style={styles.receiptPreview} /> : null}
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                  <Pressable style={[styles.cancelBtn, { flex: 1 }]} onPress={() => setShowExpForm(false)}><Text style={styles.cancelBtnText}>Cancel</Text></Pressable>
                  <Pressable style={[styles.saveBtn, { flex: 1 }, busy && { opacity: 0.6 }]} onPress={saveExpense} disabled={busy}>
                    {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.submitText}>Save</Text>}
                  </Pressable>
                </View>
              </View>
            </View>
          ) : null}
          {busy && !showExpForm ? <View style={styles.busyOverlay}><ActivityIndicator size="large" color={Colors.primary} /></View> : null}
        </SafeAreaView>
      </KeyboardAvoidingView>
    );
  }

  const ModeSwitcher = (
    <View style={styles.modeSwitchRow}>
      <Pressable style={[styles.modeSwitchBtn, mode === 'categories' && styles.modeSwitchBtnActive]} onPress={() => setMode('categories')}>
        <Text style={[styles.modeSwitchText, mode === 'categories' && styles.modeSwitchTextActive]}>Categories</Text>
      </Pressable>
      <Pressable style={[styles.modeSwitchBtn, mode === 'income' && styles.modeSwitchBtnActive]} onPress={() => setMode('income')}>
        <Text style={[styles.modeSwitchText, mode === 'income' && styles.modeSwitchTextActive]}>Income</Text>
      </Pressable>
      <Pressable style={[styles.modeSwitchBtn, mode === 'overview' && styles.modeSwitchBtnActive]} onPress={() => setMode('overview')}>
        <Text style={[styles.modeSwitchText, mode === 'overview' && styles.modeSwitchTextActive]}>Overview</Text>
      </Pressable>
    </View>
  );

  const YearRow = (showExport: boolean) => (
    <View style={styles.yearRow}>
      <Pressable style={styles.yearBtn} onPress={() => setYear(y => y - 1)} hitSlop={8}><MaterialIcons name="chevron-left" size={22} color={Colors.textSecondary} /></Pressable>
      <Text style={styles.yearText}>{year}</Text>
      <Pressable style={styles.yearBtn} onPress={() => setYear(y => y + 1)} hitSlop={8}><MaterialIcons name="chevron-right" size={22} color={Colors.textSecondary} /></Pressable>
      <View style={{ flex: 1 }} />
      {showExport ? (
        <Pressable style={styles.exportBtn} onPress={exportBudget} hitSlop={4}>
          <MaterialIcons name="ios-share" size={14} color={Colors.primary} />
          <Text style={styles.exportBtnText}>Share CSV</Text>
        </Pressable>
      ) : null}
    </View>
  );

  // ── OVERVIEW ─────────────────────────────────────────────────────────────
  if (mode === 'overview') {
    const totalPlanned = Object.values(plannedByCategory).reduce((s, v) => s + v, 0);
    const rows = buildMonthlyComparison(yearKey, income, allExpenses, totalPlanned);
    const yearIncome = rows.reduce((s, r) => s + r.income, 0);
    const yearExpenses = rows.reduce((s, r) => s + r.expenses, 0);
    const yearNet = yearIncome - yearExpenses;
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Budget</Text>
        </View>
        {ModeSwitcher}
        {YearRow(false)}

        {loading || incomeLoading ? <View style={styles.center}><ActivityIndicator size="large" color={Colors.primary} /></View> : (
          <ScrollView contentContainerStyle={{ padding: Spacing.md, gap: Spacing.sm, paddingBottom: 40 }}>
            <View style={styles.summaryCard}>
              <View style={styles.summaryRow}>
                <View style={{ flex: 1 }}><Text style={styles.summaryLabel}>Income</Text><Text style={[styles.summaryVal, { color: '#10B981' }]}>${fmt(yearIncome)}</Text></View>
                <View style={{ flex: 1 }}><Text style={styles.summaryLabel}>Expenses</Text><Text style={[styles.summaryVal, { color: '#F97316' }]}>${fmt(yearExpenses)}</Text></View>
                <View style={{ flex: 1 }}><Text style={styles.summaryLabel}>Net</Text><Text style={[styles.summaryVal, { color: yearNet < 0 ? '#EF4444' : '#10B981' }]}>{yearNet < 0 ? `-$${fmt(Math.abs(yearNet))}` : `$${fmt(yearNet)}`}</Text></View>
              </View>
            </View>

            <Text style={styles.sectionLabel}>Income vs. Expenses</Text>
            <View style={styles.monthlyCard}>
              <View style={styles.monthlyHeaderRow}>
                <Text style={[styles.monthlyHeaderCell, { flex: 1 }]}>Month</Text>
                <Text style={[styles.monthlyHeaderCell, { flex: 1, textAlign: 'right' }]}>Income</Text>
                <Text style={[styles.monthlyHeaderCell, { flex: 1, textAlign: 'right' }]}>Expenses</Text>
                <Text style={[styles.monthlyHeaderCell, { flex: 1, textAlign: 'right' }]}>Net</Text>
              </View>
              {rows.map(row => {
                const isCurrentMonth = year === new Date().getFullYear() && row.month === new Date().getMonth() + 1;
                return (
                  <View key={row.month} style={[styles.monthlyRow, isCurrentMonth && styles.monthlyRowActive]}>
                    <Text style={[styles.monthlyCell, { flex: 1, fontWeight: isCurrentMonth ? '700' : '600', color: isCurrentMonth ? Colors.primary : Colors.textPrimary }]}>{row.monthLabel}</Text>
                    <Text style={[styles.monthlyCell, { flex: 1, textAlign: 'right', color: row.income > 0 ? '#10B981' : Colors.textMuted }]}>{row.income > 0 ? `$${fmt(row.income)}` : '—'}</Text>
                    <Text style={[styles.monthlyCell, { flex: 1, textAlign: 'right', color: row.expenses > 0 ? '#F97316' : Colors.textMuted }]}>{row.expenses > 0 ? `$${fmt(row.expenses)}` : '—'}</Text>
                    <Text style={[styles.monthlyCell, { flex: 1, textAlign: 'right', fontWeight: '700', color: row.net < 0 ? '#EF4444' : '#10B981' }]}>
                      {row.net < 0 ? `-$${fmt(Math.abs(row.net))}` : `$${fmt(row.net)}`}
                    </Text>
                  </View>
                );
              })}
            </View>

            {categories.length > 0 && totalPlanned > 0 ? (
              <>
                <Text style={[styles.sectionLabel, { marginTop: 10 }]}>Budgeted vs. Actual (all categories combined)</Text>
                <View style={styles.summaryCard}>
                  <View style={styles.summaryRow}>
                    <View style={{ flex: 1 }}><Text style={styles.summaryLabel}>Budgeted</Text><Text style={styles.summaryVal}>${fmt(totalPlanned)}</Text></View>
                    <View style={{ flex: 1 }}><Text style={styles.summaryLabel}>Actual</Text><Text style={[styles.summaryVal, { color: '#F97316' }]}>${fmt(yearExpenses)}</Text></View>
                    <View style={{ flex: 1 }}><Text style={styles.summaryLabel}>Remaining</Text><Text style={[styles.summaryVal, { color: (totalPlanned - yearExpenses) < 0 ? '#EF4444' : '#10B981' }]}>${fmt(totalPlanned - yearExpenses)}</Text></View>
                  </View>
                </View>
                <View style={styles.monthlyCard}>
                  <View style={styles.monthlyHeaderRow}>
                    <Text style={[styles.monthlyHeaderCell, { flex: 1.1 }]}>Month</Text>
                    <Text style={[styles.monthlyHeaderCell, { flex: 1, textAlign: 'right' }]}>Budgeted</Text>
                    <Text style={[styles.monthlyHeaderCell, { flex: 1, textAlign: 'right' }]}>Actual</Text>
                    <Text style={[styles.monthlyHeaderCell, { flex: 1.2, textAlign: 'right' }]}>Remaining</Text>
                  </View>
                  {rows.map(row => {
                    const isCurrentMonth = year === new Date().getFullYear() && row.month === new Date().getMonth() + 1;
                    return (
                      <View key={row.month} style={[styles.monthlyRow, isCurrentMonth && styles.monthlyRowActive]}>
                        <Text style={[styles.monthlyCell, { flex: 1.1, fontWeight: isCurrentMonth ? '700' : '600', color: isCurrentMonth ? Colors.primary : Colors.textPrimary }]}>{row.monthLabel}</Text>
                        <Text style={[styles.monthlyCell, { flex: 1, textAlign: 'right' }]}>${fmt(row.budgeted)}</Text>
                        <Text style={[styles.monthlyCell, { flex: 1, textAlign: 'right', color: row.expenses > 0 ? '#F97316' : Colors.textMuted }]}>{row.expenses > 0 ? `$${fmt(row.expenses)}` : '—'}</Text>
                        <Text style={[styles.monthlyCell, { flex: 1.2, textAlign: 'right', fontWeight: '700', color: row.cumulativeVariance < 0 ? '#EF4444' : '#10B981' }]}>
                          {row.cumulativeVariance < 0 ? `-$${fmt(Math.abs(row.cumulativeVariance))}` : `$${fmt(row.cumulativeVariance)}`}
                        </Text>
                      </View>
                    );
                  })}
                </View>
                <Text style={styles.monthlyFootnote}>
                  Remaining is a running total across all categories combined — same pacing logic as each category's own Monthly Pace breakdown.
                </Text>
              </>
            ) : null}
          </ScrollView>
        )}
      </SafeAreaView>
    );
  }

  // ── INCOME LIST ──────────────────────────────────────────────────────────
  if (mode === 'income') {
    const totalIncome = sumIncome(income);
    return (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <SafeAreaView style={styles.container} edges={['top']}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Budget</Text>
            <Pressable style={styles.newBtn} onPress={openNewIncome}><MaterialIcons name="add" size={18} color="#fff" /><Text style={styles.newBtnText}>Income</Text></Pressable>
          </View>
          {ModeSwitcher}
          {YearRow(false)}

          {incomeLoading ? <View style={styles.center}><ActivityIndicator size="large" color={Colors.primary} /></View> : (
            <ScrollView contentContainerStyle={{ padding: Spacing.md, gap: Spacing.sm, paddingBottom: 40 }}>
              <View style={styles.summaryCard}>
                <View style={styles.summaryRow}>
                  <View style={{ flex: 1 }}><Text style={styles.summaryLabel}>Total Income ({yearKey})</Text><Text style={[styles.summaryVal, { color: '#10B981' }]}>${fmt(totalIncome)}</Text></View>
                </View>
              </View>

              {income.length === 0 ? (
                <View style={styles.empty}>
                  <View style={styles.emptyRing}><MaterialIcons name="payments" size={32} color={Colors.primary} /></View>
                  <Text style={styles.emptyTitle}>No income logged for {yearKey} yet</Text>
                  <Text style={styles.emptyText}>Log paychecks, gifts, and other income as it comes in — the app will remember names to make future entries quicker.</Text>
                  <Pressable style={styles.emptyCta} onPress={openNewIncome}><MaterialIcons name="add" size={18} color="#fff" /><Text style={styles.newBtnText}>Add Income</Text></Pressable>
                </View>
              ) : income.map(i => (
                <View key={i.id} style={styles.expCard}>
                  <View style={[styles.expThumb, styles.expThumbPlaceholder]}><MaterialIcons name="payments" size={20} color="#10B981" /></View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={[styles.expAmount, { color: '#10B981' }]}>${fmt(Number(i.amount))}</Text>
                      <Text style={styles.expDate}>{i.date}</Text>
                    </View>
                    {!!i.name && <Text style={styles.expVendor}>{i.name}</Text>}
                    {!!i.source && <Text style={styles.expDesc}>{i.source}</Text>}
                  </View>
                  <Pressable onPress={() => removeIncome(i)} hitSlop={8}><MaterialIcons name="delete-outline" size={18} color="#EF4444" /></Pressable>
                </View>
              ))}
            </ScrollView>
          )}

          {showIncForm ? (
            <View style={styles.sheetOverlay}>
              <View style={styles.sheet}>
                <Text style={styles.sheetTitle}>New Income</Text>
                <Text style={styles.blockLabel}>Amount *</Text>
                <TextInput style={styles.input} value={incAmount} onChangeText={setIncAmount} placeholder="0.00" placeholderTextColor={Colors.textMuted} keyboardType="decimal-pad" />

                <Text style={[styles.blockLabel, { marginTop: 10 }]}>Name</Text>
                <TextInput
                  style={styles.input}
                  value={incName}
                  onChangeText={(t) => { setIncName(t); setShowNameSuggestions(true); }}
                  onFocus={() => setShowNameSuggestions(true)}
                  placeholder="Start typing a name..."
                  placeholderTextColor={Colors.textMuted}
                  autoCapitalize="words"
                />
                {showNameSuggestions && nameSuggestions.length > 0 ? (
                  <View style={styles.suggestBox}>
                    {nameSuggestions.map((n) => (
                      <Pressable key={n} style={styles.suggestRow} onPress={() => { setIncName(n); setShowNameSuggestions(false); }}>
                        <MaterialIcons name="person" size={14} color={Colors.textMuted} />
                        <Text style={styles.suggestText}>{n}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}

                <Text style={[styles.blockLabel, { marginTop: 10 }]}>Source</Text>
                <TextInput style={styles.input} value={incSource} onChangeText={setIncSource} placeholder="e.g. Paycheck, Gift, Refund" placeholderTextColor={Colors.textMuted} />
                <Text style={[styles.blockLabel, { marginTop: 10 }]}>Date</Text>
                <TextInput style={styles.input} value={incDate} onChangeText={setIncDate} placeholder="YYYY-MM-DD" placeholderTextColor={Colors.textMuted} />
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                  <Pressable style={[styles.cancelBtn, { flex: 1 }]} onPress={() => setShowIncForm(false)}><Text style={styles.cancelBtnText}>Cancel</Text></Pressable>
                  <Pressable style={[styles.saveBtn, { flex: 1 }, busy && { opacity: 0.6 }]} onPress={saveIncome} disabled={busy}>
                    {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.submitText}>Save</Text>}
                  </Pressable>
                </View>
              </View>
            </View>
          ) : null}
          {busy && !showIncForm ? <View style={styles.busyOverlay}><ActivityIndicator size="large" color={Colors.primary} /></View> : null}
        </SafeAreaView>
      </KeyboardAvoidingView>
    );
  }

  // ── CATEGORIES LIST ─────────────────────────────────────────────────────
  const totalPlanned = Object.values(plannedByCategory).reduce((s, v) => s + v, 0);
  const totalSpent = Object.values(spentByCategory).reduce((s, v) => s + v, 0);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Budget</Text>
        <Pressable style={styles.newBtn} onPress={openNewCategory}><MaterialIcons name="add" size={18} color="#fff" /><Text style={styles.newBtnText}>Category</Text></Pressable>
      </View>
      {ModeSwitcher}
      {YearRow(true)}

      {loading ? <View style={styles.center}><ActivityIndicator size="large" color={Colors.primary} /></View> : (
        <ScrollView contentContainerStyle={{ padding: Spacing.md, gap: Spacing.sm, paddingBottom: 40 }}>
          {categories.length > 0 && (
            <View style={styles.summaryCard}>
              <View style={styles.summaryRow}>
                <View style={{ flex: 1 }}><Text style={styles.summaryLabel}>Total Planned</Text><Text style={styles.summaryVal}>${fmt(totalPlanned)}</Text></View>
                <View style={{ flex: 1 }}><Text style={styles.summaryLabel}>Total Spent</Text><Text style={[styles.summaryVal, { color: '#F97316' }]}>${fmt(totalSpent)}</Text></View>
                <View style={{ flex: 1 }}><Text style={styles.summaryLabel}>Remaining</Text><Text style={[styles.summaryVal, { color: (totalPlanned - totalSpent) < 0 ? '#EF4444' : '#10B981' }]}>${fmt(totalPlanned - totalSpent)}</Text></View>
              </View>
            </View>
          )}
          {categories.length === 0 ? (
            <View style={styles.empty}>
              <View style={styles.emptyRing}><MaterialIcons name="account-balance-wallet" size={32} color={Colors.primary} /></View>
              <Text style={styles.emptyTitle}>No budget categories for {yearKey} yet</Text>
              <Text style={styles.emptyText}>Add categories and set how much you plan to spend on each this year.</Text>
              <Pressable style={styles.emptyCta} onPress={openNewCategory}><MaterialIcons name="add" size={18} color="#fff" /><Text style={styles.newBtnText}>Add a Category</Text></Pressable>
            </View>
          ) : categories.map(c => {
            const planned = plannedByCategory[c.name] ?? 0;
            const spent = spentByCategory[c.name] ?? 0;
            const pct = planned > 0 ? Math.min(100, (spent / planned) * 100) : 0;
            const over = planned > 0 && spent > planned;
            return (
              <View key={c.name} style={styles.catCard}>
                <Pressable style={{ flex: 1 }} onPress={() => openExpenses(c)}>
                  <View style={styles.catTitleRow}>
                    <Text style={styles.catTitle} numberOfLines={1}>{c.emoji} {c.name}</Text>
                    <MaterialIcons name="chevron-right" size={18} color={Colors.textMuted} />
                  </View>
                  <Text style={styles.catMeta}>
                    {planned > 0 ? `$${fmt(spent)} of $${fmt(planned)} spent${over ? ' — over budget' : ''}` : `$${fmt(spent)} spent · No budget set`}
                  </Text>
                  {planned > 0 ? (
                    <View style={styles.progressBarBg}>
                      <View style={[styles.progressBarFill, { width: `${pct}%` as any, backgroundColor: over ? '#EF4444' : Colors.primary }]} />
                    </View>
                  ) : null}
                </Pressable>
                <View style={styles.catActions}>
                  <Pressable style={styles.iconBtn} onPress={() => openEditCategory(c)} hitSlop={4}><MaterialIcons name="edit" size={16} color={Colors.primary} /></Pressable>
                  <Pressable style={[styles.iconBtn, { borderColor: '#EF444440' }]} onPress={() => removeCategory(c)} hitSlop={4}><MaterialIcons name="delete-outline" size={16} color="#EF4444" /></Pressable>
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}

      {showCatForm ? (
        <KeyboardAvoidingView style={styles.sheetOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{editingCatOriginalName ? 'Edit Category' : 'New Category'}</Text>
            <Text style={styles.blockLabel}>Name *</Text>
            <TextInput style={styles.input} value={catName} onChangeText={setCatName} placeholder="e.g. Groceries" placeholderTextColor={Colors.textMuted} />
            <Text style={[styles.blockLabel, { marginTop: 10 }]}>Planned amount for {yearKey} *</Text>
            <TextInput style={styles.input} value={catPlanned} onChangeText={setCatPlanned} placeholder="0.00" placeholderTextColor={Colors.textMuted} keyboardType="decimal-pad" />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
              <Pressable style={[styles.cancelBtn, { flex: 1 }]} onPress={() => setShowCatForm(false)}><Text style={styles.cancelBtnText}>Cancel</Text></Pressable>
              <Pressable style={[styles.saveBtn, { flex: 1 }, busy && { opacity: 0.6 }]} onPress={saveCategory} disabled={busy}>
                {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.submitText}>Save</Text>}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      ) : null}
      {busy && !showCatForm ? <View style={styles.busyOverlay}><ActivityIndicator size="large" color={Colors.primary} /></View> : null}
    </SafeAreaView>
  );
}

// Thin wrappers so this file's call sites read like Palace's `showAlert`.
function Alert(title: string, message?: string) {
  RNAlert.alert(title, message);
}
function AlertConfirm(title: string, message: string, onConfirm: () => void) {
  RNAlert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: onConfirm },
  ]);
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
  },
  backBtn: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...Typography.h3, color: Colors.textPrimary, fontWeight: '700', flex: 1 },
  newBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.primary, borderRadius: Radius.full, paddingHorizontal: 14, paddingVertical: 8, ...Shadow.glow },
  newBtnText: { ...Typography.label, color: '#fff', fontWeight: '700', fontSize: 13 },
  busyOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  yearRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: Spacing.md, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  yearBtn: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  yearText: { ...Typography.h3, color: Colors.textPrimary, fontWeight: '700', minWidth: 50, textAlign: 'center' },
  exportBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.primary + '12', borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.primary + '30', paddingHorizontal: 10, paddingVertical: 6, marginLeft: 6 },
  exportBtnText: { ...Typography.label, color: Colors.primary, fontWeight: '700', fontSize: 12 },
  modeSwitchRow: {
    flexDirection: 'row', gap: 8, paddingHorizontal: Spacing.md, paddingTop: 10, paddingBottom: 2,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
  },
  modeSwitchBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 9,
    borderRadius: Radius.full, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder,
    marginBottom: 8,
  },
  modeSwitchBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  modeSwitchText: { ...Typography.label, color: Colors.textSecondary, fontWeight: '700', fontSize: 13 },
  modeSwitchTextActive: { color: '#fff' },
  suggestBox: {
    backgroundColor: Colors.background, borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.surfaceBorder,
    marginTop: 4, overflow: 'hidden',
  },
  suggestRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  suggestText: { ...Typography.body, color: Colors.textPrimary, fontSize: 14 },
  sectionLabel: { fontSize: 12, fontWeight: '700', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 4 },
  // summary
  summaryCard: { backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceBorder, padding: Spacing.md, gap: 10 },
  summaryRow: { flexDirection: 'row' },
  summaryLabel: { ...Typography.label, color: Colors.textMuted, fontSize: 11, textTransform: 'uppercase' },
  summaryVal: { ...Typography.h3, color: Colors.textPrimary, fontWeight: '700', marginTop: 2 },
  progressBarBg: { height: 6, backgroundColor: Colors.background, borderRadius: 3, overflow: 'hidden' },
  progressBarFill: { height: 6, borderRadius: 3 },
  // categories
  empty: { alignItems: 'center', paddingTop: 50, paddingHorizontal: Spacing.xl, gap: 10 },
  emptyRing: { width: 74, height: 74, borderRadius: 37, backgroundColor: Colors.primary + '14', borderWidth: 1, borderColor: Colors.primary + '30', alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { ...Typography.h3, color: Colors.textPrimary, textAlign: 'center' },
  emptyText: { ...Typography.body, color: Colors.textSecondary, textAlign: 'center', lineHeight: 22 },
  emptyCta: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.primary, borderRadius: Radius.full, paddingHorizontal: 18, paddingVertical: 12, marginTop: 8, ...Shadow.glow },
  catCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceBorder, padding: Spacing.md, ...Shadow.card },
  catTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  catTitle: { ...Typography.bodyMedium, color: Colors.textPrimary, fontWeight: '700', flexShrink: 1 },
  catMeta: { ...Typography.caption, color: Colors.textMuted, marginTop: 3, marginBottom: 6 },
  catActions: { flexDirection: 'column', gap: 6 },
  iconBtn: { width: 30, height: 30, borderRadius: Radius.md, backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.surfaceBorder, alignItems: 'center', justifyContent: 'center' },
  // monthly pacing / comparison
  monthlyCard: { backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceBorder, paddingVertical: 4, paddingHorizontal: Spacing.sm },
  monthlyHeaderRow: { flexDirection: 'row', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  monthlyHeaderCell: { ...Typography.caption, color: Colors.textMuted, fontWeight: '700', textTransform: 'uppercase', fontSize: 10 },
  monthlyRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  monthlyRowActive: { backgroundColor: Colors.primary + '0C' },
  monthlyCell: { ...Typography.caption, color: Colors.textSecondary, fontSize: 12.5 },
  monthlyFootnote: { ...Typography.caption, color: Colors.textMuted, fontSize: 11, lineHeight: 15, paddingHorizontal: 2 },
  // expenses / income rows
  expCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceBorder, padding: Spacing.md },
  expThumb: { width: 44, height: 44, borderRadius: Radius.md },
  expThumbPlaceholder: { backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.surfaceBorder, alignItems: 'center', justifyContent: 'center' },
  expAmount: { ...Typography.bodyMedium, color: Colors.textPrimary, fontWeight: '700' },
  expDate: { ...Typography.caption, color: Colors.textMuted },
  expVendor: { ...Typography.body, color: Colors.textSecondary, fontWeight: '600', marginTop: 1 },
  expDesc: { ...Typography.caption, color: Colors.textMuted, marginTop: 1 },
  // forms
  blockLabel: { ...Typography.bodyMedium, color: Colors.textPrimary, fontWeight: '700', marginBottom: 6 },
  input: { backgroundColor: Colors.background, borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.surfaceBorder, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#F4F4F5' },
  sheetOverlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'flex-end' },
  sheet: { width: '100%', backgroundColor: Colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderColor: Colors.surfaceBorder, padding: Spacing.lg, gap: 2 },
  sheetTitle: { ...Typography.h3, color: Colors.textPrimary, fontWeight: '700', marginBottom: 10 },
  cancelBtn: { alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.surfaceBorder },
  cancelBtnText: { ...Typography.button, color: Colors.textSecondary },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, borderRadius: Radius.full, paddingVertical: 14, ...Shadow.glow },
  submitText: { ...Typography.button, color: '#fff' },
  receiptPickRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14 },
  receiptPickText: { ...Typography.label, color: Colors.primary, fontWeight: '700' },
  receiptPreview: { width: '100%', height: 140, borderRadius: Radius.md, marginTop: 10 },
});
