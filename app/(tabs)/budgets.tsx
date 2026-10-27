/*
 * Adeboye Monthly Budget — Budgets tab
 * Categories / Income / Overview mode switcher with a monthly pacing table.
 * Uses the app-wide light theme (via the token names in
 * constants/palaceTheme.ts, which now point at constants/theme.ts).
 *
 * Data comes from adeboye-budget's own tables (budget_categories,
 * budget_limits, budget_expenses, budget_income) — both household members
 * have full access, so there's no admin gate like Palace's.
 */
import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, TextInput,
  KeyboardAvoidingView, Platform, UIManager, LayoutAnimation, ActivityIndicator, Image, Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import {
  supabase, AppCategory, BudgetLimit, Expense, Income,
  getCategories, addCategory, renameCategory, deleteCategory, mergeCategory, demoteCategory, setCategorySection,
  getYearlyBudgets, upsertBudget, deleteBudget,
  distributeYearlyBudget, clearYearlyDistribution,
  getExpensesForYear, addExpense, deleteExpense, updateExpense, uploadReceipt,
  getIncomeForYear, addIncome, deleteIncome, getIncomeNames, sumIncome,
  buildMonthlyBreakdown, buildMonthlyComparison, buildBudgetCsv, buildBudgetReportHtml,
} from '../../services/supabase';
import { CategoryColors, SECTIONS, BudgetSection, sectionFor } from '../../constants/theme';
import {
  PalaceColors as Colors, PalaceSpacing as Spacing, PalaceRadius as Radius,
  PalaceShadow as Shadow, PalaceTypography as Typography,
} from '../../constants/palaceTheme';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimentalAndroid) {
  UIManager.setLayoutAnimationEnabledExperimentalAndroid(true);
}

type Mode = 'categories' | 'expenses' | 'income' | 'overview';

function fmt(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Whole dollars, e.g. "$1,032" — used where space is tight. */
function whole(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
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
  const [catSection, setCatSection] = useState<BudgetSection>('flexible');
  // Fixed / Variable / Flexible groups the user has collapsed.
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [editingCatOriginalName, setEditingCatOriginalName] = useState<string | null>(null);

  // expenses drill-down
  const [activeCategory, setActiveCategory] = useState<AppCategory | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);

  // accordion expand + merge-duplicate picker
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [mergeSource, setMergeSource] = useState<AppCategory | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);

  // add-expense form
  const [showExpForm, setShowExpForm] = useState(false);
  const [expAmount, setExpAmount] = useState('');
  const [expVendor, setExpVendor] = useState('');
  const [expDesc, setExpDesc] = useState('');
  const [expDate, setExpDate] = useState(todayStr());
  const [expReceiptUri, setExpReceiptUri] = useState<string | null>(null);
  // Set when the expense form is opened to edit an existing row instead of
  // creating a new one — saveExpense updates it in place when this is set.
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);

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

  // In-app confirm/info dialog — replaces RN's Alert.alert, which silently
  // no-ops on web (react-native-web doesn't implement it), so anything that
  // relied on Alert.alert for a confirm step (like Merge or Delete) looked
  // like it did nothing when used from a browser.
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; confirmLabel: string; onConfirm: () => void } | null>(null);
  const [infoDialog, setInfoDialog] = useState<{ title: string; message: string } | null>(null);
  const Alert = (title: string, message?: string) => setInfoDialog({ title, message: message ?? '' });
  const AlertConfirm = (title: string, message: string, onConfirm: () => void, confirmLabel: string = 'Delete') =>
    setConfirmDialog({ title, message, confirmLabel, onConfirm });

  const DialogOverlay = confirmDialog || infoDialog ? (
    <View style={styles.sheetOverlay}>
      <View style={styles.sheet}>
        <Text style={styles.sheetTitle}>{(confirmDialog ?? infoDialog)!.title}</Text>
        <Text style={styles.dialogMessage}>{(confirmDialog ?? infoDialog)!.message}</Text>
        {confirmDialog ? (
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
            <Pressable style={[styles.cancelBtn, { flex: 1 }]} onPress={() => setConfirmDialog(null)}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.saveBtn, { flex: 1 }, confirmDialog.confirmLabel === 'Delete' && styles.deleteBtn]}
              onPress={() => { const fn = confirmDialog.onConfirm; setConfirmDialog(null); fn(); }}
            >
              <Text style={styles.submitText}>{confirmDialog.confirmLabel}</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable style={[styles.saveBtn, { marginTop: 16 }]} onPress={() => setInfoDialog(null)}>
            <Text style={styles.submitText}>OK</Text>
          </Pressable>
        )}
      </View>
    </View>
  ) : null;

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
  const openNewCategory = (section: BudgetSection = 'flexible') => { setEditingCatOriginalName(null); setCatName(''); setCatPlanned(''); setCatSection(section); setShowCatForm(true); };
  const openEditCategory = (c: AppCategory) => {
    setEditingCatOriginalName(c.name);
    setCatSection(sectionFor(c) ?? 'flexible');
    setCatName(c.name);
    setCatPlanned(plannedByCategory[c.name] ? String(plannedByCategory[c.name]) : '');
    setShowCatForm(true);
  };

  const saveCategory = async () => {
    if (!catName.trim()) { Alert('Name Required', 'Give the category a name.'); return; }
    const planned = parseFloat(catPlanned || '0');
    if (isNaN(planned) || planned < 0) { Alert('Invalid Amount', 'Enter a valid planned amount.'); return; }

    const finalName = catName.trim();
    // Warn on a near-duplicate (same name, different case/spacing) instead of
    // silently creating a second category — this is what let "Eating Out"
    // and "eating out" both get created before.
    const duplicate = categories.find(
      c => c.name.trim().toLowerCase() === finalName.toLowerCase() && c.name !== editingCatOriginalName,
    );
    if (duplicate) {
      Alert(
        'Category Already Exists',
        `"${duplicate.name}" is already a category. Tap it in the list instead of adding another one — or if you've already created a duplicate by mistake, expand it and use Merge to combine them.`,
      );
      return;
    }

    setBusy(true);
    try {
      if (editingCatOriginalName) {
        if (finalName !== editingCatOriginalName) await renameCategory(editingCatOriginalName, finalName);
      } else {
        await addCategory(finalName, '📦', '#8B5CF6');
      }
      // Save the section separately so a missing database column (sections
      // SQL not run yet) doesn't block saving the name and budget.
      let sectionError: string | null = null;
      const prev = editingCatOriginalName ? categories.find(c => c.name === editingCatOriginalName) : undefined;
      const prevSection = prev ? (prev.section ?? null) : null;
      if (prevSection !== catSection) {
        try { await setCategorySection(finalName, catSection); }
        catch (e: any) { sectionError = e.message ?? 'Could not save the section.'; }
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
      if (sectionError) Alert('Saved, but not the section', sectionError);
    } catch (e: any) {
      Alert('Error', e.message ?? (editingCatOriginalName ? 'Could not update this category.' : 'Could not create this category — it may already exist.'));
    } finally {
      setBusy(false);
    }
  };

  const toggleExpand = (name: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedCategory(prev => (prev === name ? null : name));
  };

  const openMergePicker = (c: AppCategory) => setMergeSource(c);

  const performMerge = (target: AppCategory) => {
    if (!mergeSource) return;
    const from = mergeSource;
    setMergeSource(null); // close the picker sheet first so it doesn't stack under the confirm dialog
    AlertConfirm(
      'Merge Categories',
      `Move every expense and budget from "${from.name}" into "${target.name}"? "${from.name}" will be removed and its history will live under "${target.name}" instead. This can't be undone.`,
      async () => {
        setBusy(true);
        try {
          const result = await mergeCategory(from.name, target.name);
          setExpandedCategory(null);
          load();
          if (result.expensesMoved === 0 && !result.categoryRemoved) {
            Alert(
              'Nothing Merged',
              `No expenses or budget were found under "${from.name}", and it wasn't removed. It looks like this category genuinely has no history yet — if you believe it should, try again in a moment or check the Expenses tab.`,
            );
          } else {
            Alert(
              'Merged',
              `Moved ${result.expensesMoved} expense${result.expensesMoved === 1 ? '' : 's'} from "${from.name}" into "${target.name}"${result.categoryRemoved ? `, and removed "${from.name}"` : ` (kept "${from.name}" in the list since it's a default category — just cleared out)`}.`,
            );
          }
        } catch (e: any) {
          Alert('Error', e.message ?? 'Could not merge these categories.');
        } finally {
          setBusy(false);
        }
      },
      'Merge',
    );
  };

  const removeCategory = (c: AppCategory) => {
    const msg = c.is_default
      ? `Clear the ${yearKey} budget for "${c.name}"? It's a built-in category so it'll stay in the list with no limit set. Past expense history stays intact. (Want it gone from the list entirely instead? Tap "Remove as Default" first, then Delete.)`
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

  // Strips a built-in category's "default" status so it becomes a normal,
  // fully-deletable/mergeable custom category. Works for any of the 17
  // seeded defaults (Coffee, Eating Out, etc.), not just one — after this,
  // the regular Delete/Merge actions on this category behave exactly like
  // they do for any category you created yourself.
  const removeDefaultStatus = (c: AppCategory) => {
    AlertConfirm(
      'Remove as Default',
      `"${c.name}" is one of the app's built-in categories, which is why it can't be fully deleted or merged away. Removing its default status turns it into a regular category — after that you can delete or merge it like any other. Its budget and expense history are untouched either way.`,
      async () => {
        try {
          await demoteCategory(c.name);
          load();
          Alert('Done', `"${c.name}" is no longer a default category — you can now delete or merge it normally.`);
        } catch (e: any) {
          Alert('Error', e.message ?? 'Could not update this category.');
        }
      },
      'Remove as Default',
    );
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
    setEditingExpense(null);
    setExpAmount(''); setExpVendor(''); setExpDesc(''); setExpDate(todayStr()); setExpReceiptUri(null);
    setShowExpForm(true);
  };

  const openEditExpense = (e: Expense) => {
    const { vendor, desc } = decodeNote(e.note);
    setEditingExpense(e);
    setExpAmount(String(e.amount));
    setExpVendor(vendor);
    setExpDesc(desc);
    setExpDate(e.date);
    setExpReceiptUri(e.receipt_url ?? null);
    setShowExpForm(true);
  };

  const saveExpense = async () => {
    if (!activeCategory) return;
    const amount = parseFloat(expAmount || '');
    if (isNaN(amount) || amount <= 0) { Alert('Invalid Amount', 'Enter a valid expense amount.'); return; }
    if (!expDate.trim()) { Alert('Date Required', 'Enter the expense date (YYYY-MM-DD).'); return; }
    setBusy(true);
    try {
      // expReceiptUri holds either the unchanged remote receipt_url, a
      // freshly-picked local file:// uri (needs uploading), or null
      // (removed) — only upload when it's genuinely a new local file.
      let receipt_url: string | null | undefined = expReceiptUri;
      if (expReceiptUri && expReceiptUri !== editingExpense?.receipt_url) {
        receipt_url = await uploadReceipt(expReceiptUri);
      }
      const note = encodeNote(expVendor, expDesc);

      if (editingExpense) {
        const prevAmount = Number(editingExpense.amount);
        const updated = await updateExpense(editingExpense.id, {
          date: expDate.trim(), amount, category: activeCategory.name, note, receipt_url,
        });
        setExpenses(p => p.map(x => (x.id === updated.id ? updated : x)));
        setAllExpenses(p => p.map(x => (x.id === updated.id ? updated : x)));
        setSpentByCategory(p => ({ ...p, [activeCategory.name]: Math.max(0, (p[activeCategory.name] ?? 0) - prevAmount + amount) }));
      } else {
        const created = await addExpense({
          date: expDate.trim(), amount, category: activeCategory.name,
          note, added_by_name: userName, receipt_url: receipt_url ?? undefined,
        });
        setExpenses(p => [created, ...p]);
        setAllExpenses(p => [created, ...p]);
        setSpentByCategory(p => ({ ...p, [activeCategory.name]: (p[activeCategory.name] ?? 0) + amount }));
      }
      setShowExpForm(false);
      setEditingExpense(null);
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

  const exportPdf = async () => {
    if (allExpenses.length === 0) { Alert('Nothing to Export', `No expenses logged for ${yearKey} yet.`); return; }
    setExportingPdf(true);
    try {
      // Fetch fresh regardless of which mode is currently active — the
      // `income` state only loads when the Income/Overview tab has been
      // opened, so relying on it here could silently omit income from the
      // report if the PDF is generated straight from Categories.
      const yearIncome = await getIncomeForYear(yearKey);
      const html = buildBudgetReportHtml({
        yearKey,
        categories,
        plannedByCategory,
        spentByCategory,
        income: yearIncome,
        expenses: allExpenses,
        generatedAt: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
      });
      if (Platform.OS === 'web') {
        // expo-print doesn't produce a downloadable PDF file on web — on
        // this platform printToFileAsync opens the browser's native print
        // dialog instead, where "Save as PDF" is one of the destinations.
        // That's the closest web equivalent to "share as PDF" available
        // without standing up a server-side PDF renderer.
        await Print.printToFileAsync({ html });
      } else {
        const { uri } = await Print.printToFileAsync({ html });
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `${yearKey} Budget Report`, UTI: 'com.adobe.pdf' });
        } else {
          Alert('Saved', `PDF saved to: ${uri}`);
        }
      }
    } catch (e: any) {
      Alert('Error', e.message ?? 'Could not generate the PDF report.');
    } finally {
      setExportingPdf(false);
    }
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
                  <Pressable style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }} onPress={() => openEditExpense(e)}>
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
                  </Pressable>
                  <Pressable onPress={() => removeExpense(e)} hitSlop={8}><MaterialIcons name="delete-outline" size={18} color="#EF4444" /></Pressable>
                </View>
              );
            })}
          </ScrollView>

          {showExpForm ? (
            <View style={styles.sheetOverlay}>
              <View style={styles.sheet}>
                <Text style={styles.sheetTitle}>{editingExpense ? 'Edit Expense' : 'New Expense'}</Text>
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
                  <Pressable style={[styles.cancelBtn, { flex: 1 }]} onPress={() => { setShowExpForm(false); setEditingExpense(null); }}><Text style={styles.cancelBtnText}>Cancel</Text></Pressable>
                  <Pressable style={[styles.saveBtn, { flex: 1 }, busy && { opacity: 0.6 }]} onPress={saveExpense} disabled={busy}>
                    {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.submitText}>Save</Text>}
                  </Pressable>
                </View>
              </View>
            </View>
          ) : null}
          {busy && !showExpForm ? <View style={styles.busyOverlay}><ActivityIndicator size="large" color={Colors.primary} /></View> : null}
          {DialogOverlay}
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
        <>
          <Pressable style={styles.exportBtn} onPress={exportPdf} hitSlop={4} disabled={exportingPdf}>
            {exportingPdf ? <ActivityIndicator size="small" color={Colors.primary} /> : (
              <>
                <MaterialIcons name="picture-as-pdf" size={14} color={Colors.primary} />
                <Text style={styles.exportBtnText}>PDF</Text>
              </>
            )}
          </Pressable>
          <Pressable style={[styles.exportBtn, { marginLeft: 6 }]} onPress={exportBudget} hitSlop={4}>
            <MaterialIcons name="ios-share" size={14} color={Colors.primary} />
            <Text style={styles.exportBtnText}>CSV</Text>
          </Pressable>
        </>
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
          <Text style={styles.headerTitle}>Budgets</Text>
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
        {DialogOverlay}
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
            <Text style={styles.headerTitle}>Budgets</Text>
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
          {DialogOverlay}
        </SafeAreaView>
      </KeyboardAvoidingView>
    );
  }

  // ── CATEGORIES LIST ─────────────────────────────────────────────────────
  const totalPlanned = Object.values(plannedByCategory).reduce((s, v) => s + v, 0);
  const totalSpent = Object.values(spentByCategory).reduce((s, v) => s + v, 0);

  // "This Month" summary — a plain-language snapshot instead of the 12-row
  // yearly tables, so it's easy to see at a glance how the current month is
  // going. Only meaningful when viewing the current calendar year.
  const now = new Date();
  const isCurrentYear = year === now.getFullYear();
  const currentMonthNum = now.getMonth() + 1;
  const currentMonthLabel = now.toLocaleDateString('en-US', { month: 'long' });
  const thisMonthExpenses = isCurrentYear
    ? allExpenses.filter(e => e.date && parseInt(e.date.slice(5, 7), 10) === currentMonthNum)
    : [];
  const thisMonthSpent = thisMonthExpenses.reduce((s, e) => s + Number(e.amount), 0);
  const monthlyPace = totalPlanned / 12;
  const thisMonthRemaining = monthlyPace - thisMonthSpent;
  const thisMonthByCat: Record<string, number> = {};
  for (const e of thisMonthExpenses) thisMonthByCat[e.category] = (thisMonthByCat[e.category] ?? 0) + Number(e.amount);
  const topThisMonth = Object.entries(thisMonthByCat).sort((a, b) => b[1] - a[1]).slice(0, 3);

  // Fixed / Variable / Flexible groups. Within each, the categories needing
  // attention come first: over budget, then nearly there, then the rest by
  // how much of the budget is used; unused categories (no budget, nothing
  // spent) sink to the bottom.
  const attentionRank = (c: AppCategory) => {
    const planned = plannedByCategory[c.name] ?? 0, spent = spentByCategory[c.name] ?? 0;
    if (planned > 0 && spent > planned) return 0;
    if (planned > 0 && spent / planned > 0.85) return 1;
    if (planned > 0 || spent > 0) return 2;
    return 3;
  };
  const usage = (c: AppCategory) => {
    const planned = plannedByCategory[c.name] ?? 0, spent = spentByCategory[c.name] ?? 0;
    return planned > 0 ? spent / planned : spent > 0 ? 1 : 0;
  };
  const byAttention = (a: AppCategory, b: AppCategory) =>
    attentionRank(a) - attentionRank(b) || usage(b) - usage(a)
    || (spentByCategory[b.name] ?? 0) - (spentByCategory[a.name] ?? 0) || a.name.localeCompare(b.name);
  const groups: { key: string; title: string; blurb: string; icon: 'lock-outline' | 'trending-up' | 'shopping-bag' | 'help-outline'; color: string; cats: AppCategory[] }[] = [
    ...SECTIONS.map(sec => ({ ...sec, cats: categories.filter(c => sectionFor(c) === sec.key).sort(byAttention) })),
    { key: 'unsorted', title: 'Not sorted yet', blurb: 'Tap a category → Edit to choose its group', icon: 'help-outline' as const, color: Colors.textMuted, cats: categories.filter(c => !sectionFor(c)).sort(byAttention) },
  ].filter(g => g.cats.length > 0);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Budgets</Text>
        <Pressable style={styles.newBtn} onPress={() => openNewCategory()}><MaterialIcons name="add" size={18} color="#fff" /><Text style={styles.newBtnText}>Category</Text></Pressable>
      </View>
      {ModeSwitcher}
      {YearRow(true)}

      {loading ? <View style={styles.center}><ActivityIndicator size="large" color={Colors.primary} /></View> : (
        <ScrollView contentContainerStyle={{ padding: Spacing.md, gap: Spacing.sm, paddingBottom: 40 }}>
          {isCurrentYear && (thisMonthSpent > 0 || monthlyPace > 0) ? (
            <View style={styles.thisMonthCard}>
              <Text style={styles.thisMonthTitle}>{currentMonthLabel} at a Glance</Text>
              {monthlyPace > 0 ? (
                <>
                  <View style={styles.progressBarBg}>
                    <View style={[styles.progressBarFill, { width: `${Math.min(100, (thisMonthSpent / monthlyPace) * 100)}%` as any, backgroundColor: thisMonthRemaining < 0 ? '#EF4444' : Colors.primary }]} />
                  </View>
                  <Text style={styles.thisMonthStatus}>
                    {thisMonthRemaining < 0
                      ? `🔴 $${fmt(Math.abs(thisMonthRemaining))} over your ~$${fmt(monthlyPace)}/mo pace`
                      : `🟢 $${fmt(thisMonthRemaining)} left of your ~$${fmt(monthlyPace)}/mo pace`}
                  </Text>
                </>
              ) : (
                <Text style={styles.thisMonthStatus}>Set yearly budgets below to see how this month is pacing.</Text>
              )}
              <View style={styles.summaryRow}>
                <View style={{ flex: 1 }}><Text style={styles.summaryLabel}>Spent</Text><Text style={[styles.summaryVal, { color: '#F97316' }]}>${fmt(thisMonthSpent)}</Text></View>
                {monthlyPace > 0 ? <View style={{ flex: 1 }}><Text style={styles.summaryLabel}>Monthly Pace</Text><Text style={styles.summaryVal}>${fmt(monthlyPace)}</Text></View> : null}
              </View>
              {topThisMonth.length > 0 ? (
                <View style={{ gap: 4 }}>
                  <Text style={styles.thisMonthTopLabel}>Top categories this month</Text>
                  {topThisMonth.map(([name, amt]) => {
                    const cat = categories.find(c => c.name === name);
                    return (
                      <View key={name} style={styles.thisMonthTopRow}>
                        <Text style={styles.thisMonthTopName} numberOfLines={1}>{cat?.emoji ?? '📦'} {name}</Text>
                        <Text style={styles.thisMonthTopAmt}>${fmt(amt)}</Text>
                      </View>
                    );
                  })}
                </View>
              ) : null}
            </View>
          ) : null}

          {categories.length > 0 && (
            <View style={styles.summaryCard}>
              <Text style={styles.sectionLabel}>{yearKey} Totals</Text>
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
              <Pressable style={styles.emptyCta} onPress={() => openNewCategory()}><MaterialIcons name="add" size={18} color="#fff" /><Text style={styles.newBtnText}>Add a Category</Text></Pressable>
            </View>
          ) : groups.map(g => {
            const collapsed = !!collapsedSections[g.key];
            const gPlanned = g.cats.reduce((t, c) => t + (plannedByCategory[c.name] ?? 0), 0);
            const gSpent = g.cats.reduce((t, c) => t + (spentByCategory[c.name] ?? 0), 0);
            const gPct = gPlanned > 0 ? Math.min(100, (gSpent / gPlanned) * 100) : 0;
            const gOver = g.cats.filter(c => (plannedByCategory[c.name] ?? 0) > 0 && (spentByCategory[c.name] ?? 0) > (plannedByCategory[c.name] ?? 0)).length;
            return (
              <View key={g.key} style={{ gap: Spacing.sm }}>
                <Pressable style={styles.sectionHeader} onPress={() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setCollapsedSections(p => ({ ...p, [g.key]: !p[g.key] })); }}>
                  <View style={[styles.sectionIcon, { backgroundColor: g.color + '1F' }]}>
                    <MaterialIcons name={g.icon} size={20} color={g.color} />
                  </View>
                  <View style={{ flex: 1, gap: 5 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={styles.sectionTitle} numberOfLines={1}>{g.title}</Text>
                      {gOver > 0 ? <View style={styles.overBadge}><Text style={styles.overBadgeText}>{gOver} over</Text></View> : null}
                    </View>
                    <Text style={styles.sectionAmt}>
                      {whole(gSpent)}{gPlanned > 0 ? <Text style={styles.catHeaderOf}> of {whole(gPlanned)} spent</Text> : <Text style={styles.catHeaderOf}> spent</Text>}
                    </Text>
                    <Text style={styles.sectionBlurb} numberOfLines={1}>{g.blurb} · {g.cats.length} {g.cats.length === 1 ? 'category' : 'categories'}</Text>
                    {gPlanned > 0 ? (
                      <View style={styles.progressBarBg}>
                        <View style={[styles.progressBarFill, { width: `${gPct}%` as any, backgroundColor: gSpent > gPlanned ? Colors.error : g.color }]} />
                      </View>
                    ) : null}
                  </View>
                  <MaterialIcons name={collapsed ? 'expand-more' : 'expand-less'} size={24} color={Colors.textMuted} />
                </Pressable>
                {collapsed ? null : g.cats.map(c => {
                  const planned = plannedByCategory[c.name] ?? 0;
                  const spent = spentByCategory[c.name] ?? 0;
                  const pct = planned > 0 ? Math.min(100, (spent / planned) * 100) : 0;
                  const over = planned > 0 && spent > planned;
                  const isExpanded = expandedCategory === c.name;
                  const dim = planned === 0 && spent === 0;
                  return (
                <View key={c.name} style={[styles.catCard, dim && styles.catCardDim]}>
                  <Pressable style={styles.catHeaderRow} onPress={() => toggleExpand(c.name)}>
                    <View style={[styles.catIcon, { backgroundColor: (c.color ?? CategoryColors[c.name] ?? '#64748B') + '22' }]}>
                      <Text style={{ fontSize: 19 }}>{c.emoji}</Text>
                    </View>
                    <View style={{ flex: 1, gap: 6 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <Text style={styles.catTitle} numberOfLines={1}>{c.name}</Text>
                        <Text style={[styles.catHeaderAmt, over && { color: Colors.error }]}>
                          {whole(spent)}{planned > 0 ? <Text style={styles.catHeaderOf}> / {whole(planned)}</Text> : null}
                        </Text>
                      </View>
                      {planned > 0 ? (
                        <View style={styles.progressBarBg}>
                          <View style={[styles.progressBarFill, { width: `${pct}%` as any, backgroundColor: over ? Colors.error : pct > 85 ? Colors.warning : (c.color ?? Colors.primary) }]} />
                        </View>
                      ) : <Text style={styles.catNoBudget}>No budget set</Text>}
                    </View>
                    <MaterialIcons name={isExpanded ? 'expand-less' : 'expand-more'} size={22} color={Colors.textMuted} />
                  </Pressable>

                  {isExpanded ? (
                    <View style={styles.catExpanded}>
                      <Text style={styles.catMeta}>
                        {planned > 0 ? `$${fmt(spent)} of $${fmt(planned)} spent${over ? ' — over budget' : ''}` : `$${fmt(spent)} spent this year · No budget set`}
                      </Text>
                      <View style={styles.catExpandedActions}>
                        <Pressable style={styles.expandedActionBtn} onPress={() => openExpenses(c)}>
                          <MaterialIcons name="receipt-long" size={15} color={Colors.primary} />
                          <Text style={styles.expandedActionText}>Expenses</Text>
                        </Pressable>
                        <Pressable style={styles.expandedActionBtn} onPress={() => openEditCategory(c)}>
                          <MaterialIcons name="edit" size={15} color={Colors.primary} />
                          <Text style={styles.expandedActionText}>Edit</Text>
                        </Pressable>
                        <Pressable style={styles.expandedActionBtn} onPress={() => openMergePicker(c)}>
                          <MaterialIcons name="call-merge" size={15} color={Colors.primary} />
                          <Text style={styles.expandedActionText}>Merge</Text>
                        </Pressable>
                        {c.is_default ? (
                          <Pressable style={styles.expandedActionBtn} onPress={() => removeDefaultStatus(c)}>
                            <MaterialIcons name="remove-circle-outline" size={15} color={Colors.primary} />
                            <Text style={styles.expandedActionText}>Remove as Default</Text>
                          </Pressable>
                        ) : null}
                        <Pressable style={[styles.expandedActionBtn, { borderColor: '#EF444440' }]} onPress={() => removeCategory(c)}>
                          <MaterialIcons name="delete-outline" size={15} color="#EF4444" />
                          <Text style={[styles.expandedActionText, { color: '#EF4444' }]}>Delete</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : null}
                </View>
                  );
                })}
              </View>
            );
          })}
        </ScrollView>
      )}

      {mergeSource ? (
        <View style={styles.sheetOverlay}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Merge "{mergeSource.name}" into…</Text>
            <Text style={styles.mergeHint}>Pick the category to keep. All of "{mergeSource.name}"'s expenses and budget move over, and the duplicate disappears.</Text>
            <ScrollView style={{ maxHeight: 300 }}>
              {categories.filter(c => c.name !== mergeSource.name).map(c => (
                <Pressable key={c.name} style={styles.mergeOptionRow} onPress={() => performMerge(c)}>
                  <Text style={styles.mergeOptionText} numberOfLines={1}>{c.emoji} {c.name}</Text>
                  <MaterialIcons name="chevron-right" size={18} color={Colors.textMuted} />
                </Pressable>
              ))}
            </ScrollView>
            <Pressable style={[styles.cancelBtn, { marginTop: 12 }]} onPress={() => setMergeSource(null)}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {showCatForm ? (
        <KeyboardAvoidingView style={styles.sheetOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{editingCatOriginalName ? 'Edit Category' : 'New Category'}</Text>
            <Text style={styles.blockLabel}>Name *</Text>
            <TextInput style={styles.input} value={catName} onChangeText={setCatName} placeholder="e.g. Groceries" placeholderTextColor={Colors.textMuted} />
            <Text style={[styles.blockLabel, { marginTop: 10 }]}>Group</Text>
            <View style={styles.sectionPickRow}>
              {SECTIONS.map(sec => {
                const on = catSection === sec.key;
                return (
                  <Pressable key={sec.key} style={[styles.sectionPick, on && { borderColor: sec.color, backgroundColor: sec.color + '14' }]} onPress={() => setCatSection(sec.key)}>
                    <MaterialIcons name={sec.icon} size={18} color={on ? sec.color : Colors.textMuted} />
                    <Text style={[styles.sectionPickText, on && { color: Colors.textPrimary }]} numberOfLines={1}>{sec.title.split(' ')[0]}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.sectionPickHint}>{SECTIONS.find(x => x.key === catSection)?.blurb}</Text>
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
      {DialogOverlay}
    </SafeAreaView>
  );
}

// Note: Alert/AlertConfirm are now defined inside BudgetsScreen (driving the
// in-app DialogOverlay) instead of here, since RNAlert.alert doesn't render
// anything on web. RNAlert is kept imported only where still genuinely
// native-only (there is currently no remaining use in this file).

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: 20, paddingTop: 14, paddingBottom: 10,
  },
  backBtn: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', ...Shadow.card },
  headerTitle: { fontSize: 28, lineHeight: 34, color: Colors.textPrimary, fontWeight: '800', letterSpacing: -0.5, flex: 1 },
  newBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.primary, borderRadius: Radius.full, paddingHorizontal: 14, paddingVertical: 8, ...Shadow.glow },
  newBtnText: { ...Typography.label, color: '#fff', fontWeight: '700', fontSize: 13 },
  busyOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(255,255,255,0.6)', alignItems: 'center', justifyContent: 'center' },
  yearRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: Spacing.md, paddingVertical: 8 },
  yearBtn: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  yearText: { ...Typography.h3, color: Colors.textPrimary, fontWeight: '700', minWidth: 50, textAlign: 'center' },
  exportBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.primary + '12', borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.primary + '30', paddingHorizontal: 10, paddingVertical: 6, marginLeft: 6 },
  exportBtnText: { ...Typography.label, color: Colors.primary, fontWeight: '700', fontSize: 12 },
  modeSwitchRow: {
    flexDirection: 'row', gap: 4, marginHorizontal: Spacing.md, marginTop: 4, padding: 4,
    backgroundColor: Colors.surfaceElevated, borderRadius: Radius.full,
  },
  modeSwitchBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 9, borderRadius: Radius.full,
  },
  modeSwitchBtnActive: { backgroundColor: Colors.surface, ...Shadow.card },
  modeSwitchText: { ...Typography.label, color: Colors.textSecondary, fontWeight: '700', fontSize: 13.5 },
  modeSwitchTextActive: { color: Colors.textPrimary },
  suggestBox: {
    backgroundColor: Colors.background, borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.surfaceBorder,
    marginTop: 4, overflow: 'hidden',
  },
  suggestRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  suggestText: { ...Typography.body, color: Colors.textPrimary, fontSize: 14 },
  sectionLabel: { fontSize: 12, fontWeight: '700', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 4 },
  // summary
  summaryCard: { backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.md, gap: 10, ...Shadow.card },
  summaryRow: { flexDirection: 'row' },
  summaryLabel: { ...Typography.label, color: Colors.textMuted, fontSize: 11, textTransform: 'uppercase' },
  summaryVal: { ...Typography.h3, color: Colors.textPrimary, fontWeight: '700', marginTop: 2 },
  progressBarBg: { height: 6, backgroundColor: Colors.surfaceElevated, borderRadius: 3, overflow: 'hidden' },
  progressBarFill: { height: 6, borderRadius: 3 },
  // categories
  empty: { alignItems: 'center', paddingTop: 50, paddingHorizontal: Spacing.xl, gap: 10 },
  emptyRing: { width: 74, height: 74, borderRadius: 37, backgroundColor: Colors.primary + '14', borderWidth: 1, borderColor: Colors.primary + '30', alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { ...Typography.h3, color: Colors.textPrimary, textAlign: 'center' },
  emptyText: { ...Typography.body, color: Colors.textSecondary, textAlign: 'center', lineHeight: 22 },
  emptyCta: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.primary, borderRadius: Radius.full, paddingHorizontal: 18, paddingVertical: 12, marginTop: 8, ...Shadow.glow },
  catCard: { backgroundColor: Colors.surface, borderRadius: Radius.lg, ...Shadow.card },
  catHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  catCardDim: { opacity: 0.6 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4, paddingTop: 12, paddingBottom: 2 },
  sectionIcon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: Colors.textPrimary, flexShrink: 1 },
  sectionBlurb: { fontSize: 12.5, color: Colors.textMuted },
  sectionAmt: { fontSize: 14, fontWeight: '800', color: Colors.textPrimary },
  overBadge: { backgroundColor: Colors.error + '18', borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  overBadgeText: { color: Colors.error, fontSize: 11.5, fontWeight: '800' },
  sectionPickRow: { flexDirection: 'row', gap: 8 },
  sectionPick: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 10, borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.surfaceBorder, backgroundColor: Colors.background },
  sectionPickText: { fontSize: 13, fontWeight: '700', color: Colors.textSecondary },
  sectionPickHint: { fontSize: 12.5, color: Colors.textMuted, marginTop: 6 },
  catIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  catHeaderOf: { fontWeight: '500', color: Colors.textMuted },
  catNoBudget: { fontSize: 12.5, color: Colors.textMuted },
  catTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  catTitle: { ...Typography.bodyMedium, color: Colors.textPrimary, fontWeight: '700', flexShrink: 1, fontSize: 15 },
  catHeaderAmt: { fontSize: 14, color: Colors.textPrimary, fontWeight: '700' },
  catMeta: { ...Typography.caption, color: Colors.textMuted, marginTop: 3, marginBottom: 6 },
  catExpanded: { paddingHorizontal: Spacing.md, paddingBottom: Spacing.md, gap: 6, borderTopWidth: 1, borderTopColor: Colors.surfaceBorder, paddingTop: 10 },
  catExpandedActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  expandedActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Colors.background, borderRadius: Radius.full, paddingHorizontal: 12, paddingVertical: 8 },
  expandedActionText: { ...Typography.label, color: Colors.primary, fontWeight: '700', fontSize: 12.5 },
  catActions: { flexDirection: 'column', gap: 6 },
  iconBtn: { width: 30, height: 30, borderRadius: Radius.md, backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.surfaceBorder, alignItems: 'center', justifyContent: 'center' },
  // "this month" summary
  thisMonthCard: { backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.md, gap: 10, ...Shadow.card },
  thisMonthTitle: { ...Typography.h3, color: Colors.textPrimary, fontWeight: '700', fontSize: 16 },
  thisMonthStatus: { ...Typography.body, color: Colors.textSecondary, fontSize: 13.5, fontWeight: '600' },
  thisMonthTopLabel: { ...Typography.caption, color: Colors.textMuted, fontWeight: '700', textTransform: 'uppercase', fontSize: 10, letterSpacing: 0.6, marginTop: 2 },
  thisMonthTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 3 },
  thisMonthTopName: { ...Typography.body, color: Colors.textPrimary, fontSize: 13.5, flexShrink: 1, marginRight: 8 },
  thisMonthTopAmt: { ...Typography.body, color: Colors.textSecondary, fontSize: 13.5, fontWeight: '700' },
  // merge picker
  mergeHint: { ...Typography.caption, color: Colors.textMuted, fontSize: 12.5, lineHeight: 17, marginBottom: 10 },
  mergeOptionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  mergeOptionText: { ...Typography.body, color: Colors.textPrimary, fontSize: 15, flexShrink: 1, marginRight: 8 },
  // monthly pacing / comparison
  monthlyCard: { backgroundColor: Colors.surface, borderRadius: Radius.lg, paddingVertical: 4, paddingHorizontal: Spacing.sm, ...Shadow.card },
  monthlyHeaderRow: { flexDirection: 'row', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  monthlyHeaderCell: { ...Typography.caption, color: Colors.textMuted, fontWeight: '700', textTransform: 'uppercase', fontSize: 10 },
  monthlyRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  monthlyRowActive: { backgroundColor: Colors.primary + '0C' },
  monthlyCell: { ...Typography.caption, color: Colors.textSecondary, fontSize: 12.5 },
  monthlyFootnote: { ...Typography.caption, color: Colors.textMuted, fontSize: 11, lineHeight: 15, paddingHorizontal: 2 },
  // expenses / income rows
  expCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.md, ...Shadow.card },
  expThumb: { width: 44, height: 44, borderRadius: Radius.md },
  expThumbPlaceholder: { backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.surfaceBorder, alignItems: 'center', justifyContent: 'center' },
  expAmount: { ...Typography.bodyMedium, color: Colors.textPrimary, fontWeight: '700' },
  expDate: { ...Typography.caption, color: Colors.textMuted },
  expVendor: { ...Typography.body, color: Colors.textSecondary, fontWeight: '600', marginTop: 1 },
  expDesc: { ...Typography.caption, color: Colors.textMuted, marginTop: 1 },
  // forms
  blockLabel: { ...Typography.bodyMedium, color: Colors.textPrimary, fontWeight: '700', marginBottom: 6 },
  input: { backgroundColor: Colors.background, borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.surfaceBorder, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: Colors.textPrimary },
  sheetOverlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(24,32,47,0.4)', alignItems: 'center', justifyContent: 'flex-end' },
  sheet: { width: '100%', backgroundColor: Colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: Spacing.lg, gap: 2 },
  sheetTitle: { ...Typography.h3, color: Colors.textPrimary, fontWeight: '700', marginBottom: 10 },
  cancelBtn: { alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: Radius.full, backgroundColor: Colors.surfaceElevated },
  cancelBtnText: { ...Typography.button, color: Colors.textPrimary },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, borderRadius: Radius.full, paddingVertical: 14, ...Shadow.glow },
  submitText: { ...Typography.button, color: '#fff' },
  deleteBtn: { backgroundColor: '#EF4444', shadowColor: '#EF4444' },
  dialogMessage: { ...Typography.body, color: Colors.textSecondary, fontSize: 13.5, lineHeight: 19, marginTop: 4 },
  receiptPickRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14 },
  receiptPickText: { ...Typography.label, color: Colors.primary, fontWeight: '700' },
  receiptPreview: { width: '100%', height: 140, borderRadius: Radius.md, marginTop: 10 },
});
