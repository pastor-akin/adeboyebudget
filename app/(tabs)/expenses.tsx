import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, ScrollView, ActivityIndicator, KeyboardAvoidingView,
  Platform, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import {
  supabase, Expense, BudgetLimit, AppCategory, Category,
  addExpense, deleteExpense, updateExpense, getExpenses, getBudgets,
  getCategories, addCategory, uploadReceipt, getStoreMemory, storeKey, StoreMemory, toMonthKey, formatMonthLabel,
} from '../../services/supabase';
import { Colors, Radius, Shadow, COLOR_OPTIONS, EMOJI_OPTIONS, CategoryColors } from '../../constants/theme';
import { Avatar, ScreenHeader, MonthSwitcher, groupByDay, displayName, money, ui } from '../../components/ui';

export default function ExpensesScreen() {
  const params = useLocalSearchParams<{ add?: string }>();
  const router = useRouter();
  const [monthKey, setMonthKey] = useState(toMonthKey());
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [userName, setUserName] = useState('');

  const [modalBudgets, setModalBudgets] = useState<BudgetLimit[]>([]);
  const [modalExpenses, setModalExpenses] = useState<Expense[]>([]);
  const [categories, setCategories] = useState<AppCategory[]>([]);
  const [modalLoading, setModalLoading] = useState(false);

  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<Category>('Gas');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [receiptUri, setReceiptUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // "Remember category": store name → the category it's usually filed under.
  const [storeMemory, setStoreMemory] = useState<Record<string, StoreMemory>>({});
  const [categoryTouched, setCategoryTouched] = useState(false); // user picked a chip themselves
  const [rememberedFrom, setRememberedFrom] = useState<string | null>(null); // store that set the category
  const [showStoreSuggestions, setShowStoreSuggestions] = useState(false);
  // Set when the Add-Expense form is opened for an existing expense instead
  // of a brand-new one — same form, but handleSave updates this row in
  // place rather than inserting a new one.
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);

  const [showNewCat, setShowNewCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatEmoji, setNewCatEmoji] = useState('📦');
  const [newCatColor, setNewCatColor] = useState(COLOR_OPTIONS[0]);
  const [savingCat, setSavingCat] = useState(false);

  // In-app confirm/info dialog. React Native's Alert.alert silently does
  // nothing on web (react-native-web doesn't implement it), so every confirm
  // step here — deleting an expense, choosing a receipt source, error
  // messages — used to just fail quietly when this screen was opened in a
  // browser. This dialog works identically on native and web.
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; confirmLabel: string; onConfirm: () => void } | null>(null);
  const [infoDialog, setInfoDialog] = useState<{ title: string; message?: string } | null>(null);
  const showAlert = (title: string, message?: string) => setInfoDialog({ title, message });
  const showConfirm = (title: string, message: string, onConfirm: () => void, confirmLabel: string = 'Delete') =>
    setConfirmDialog({ title, message, confirmLabel, onConfirm });

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserName(user?.email?.split('@')[0] ?? 'You');
    });
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await getExpenses(monthKey);
      setExpenses(data);
    } catch (e: any) {
      showAlert('Error', e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [monthKey]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  // Home's "Expense" quick action links here with ?add=1.
  useEffect(() => {
    if (params.add === '1') {
      openNewExpense();
      router.setParams({ add: undefined });
    }
  }, [params.add]);

  // Categories are needed for the feed's icons, not just the add form.
  useEffect(() => { getCategories().then(setCategories).catch(() => {}); }, []);

  useEffect(() => {
    if (!showAdd) return;
    setModalLoading(true);
    Promise.all([
      getCategories(),
      getBudgets(toMonthKey()),
      getExpenses(toMonthKey()),
      getStoreMemory().catch(() => ({} as Record<string, StoreMemory>)),
    ])
      .then(([cats, budgets, exps, memory]) => {
        setStoreMemory(memory);
        setCategories(cats);
        setModalBudgets(budgets);
        setModalExpenses(exps);
        if (cats.length > 0 && !cats.find(c => c.name === category)) {
          setCategory(cats[0].name);
        }
      })
      .catch(() => {})
      .finally(() => setModalLoading(false));
  }, [showAdd]);

  function budgetFor(cat: Category): number {
    return modalBudgets.find(b => b.category === cat && b.frequency === 'monthly')?.amount ?? 0;
  }
  function spentFor(cat: Category): number {
    return modalExpenses.filter(e => e.category === cat).reduce((s, e) => s + e.amount, 0);
  }
  function remainingFor(cat: Category): number | null {
    const limit = budgetFor(cat);
    if (limit <= 0) return null;
    return limit - spentFor(cat);
  }

  const enteredAmount = parseFloat(amount) || 0;
  const remaining = remainingFor(category);
  const isOverBudget = remaining !== null && enteredAmount > remaining;
  const selectedCat = categories.find(c => c.name === category);

  function changeMonth(delta: number) {
    const [year, mon] = monthKey.split('-').map(Number);
    setMonthKey(toMonthKey(new Date(year, mon - 1 + delta, 1)));
  }

  async function pickReceipt() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { showAlert('Permission needed', 'Allow photo access.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7, allowsEditing: true });
    if (!result.canceled) setReceiptUri(result.assets[0].uri);
  }

  async function takeReceiptPhoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') { showAlert('Permission needed', 'Allow camera access.'); return; }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7, allowsEditing: true });
    if (!result.canceled) setReceiptUri(result.assets[0].uri);
  }

  // Typing (or picking) a store you've used before selects its usual
  // category — unless you've already chosen a category yourself.
  function applyStore(text: string, opts: { fromSuggestion?: boolean } = {}) {
    setNote(text);
    const hit = storeMemory[storeKey(text)];
    const known = hit && categories.some(c => c.name === hit.category);
    if (known && (!categoryTouched || opts.fromSuggestion)) {
      setCategory(hit.category);
      setRememberedFrom(hit.name);
      if (opts.fromSuggestion) setCategoryTouched(false);
    } else if (!known && rememberedFrom && !categoryTouched) {
      setRememberedFrom(null);
    }
  }

  const storeSuggestions = (() => {
    const q = storeKey(note);
    if (!q || editingExpense) return [];
    return Object.entries(storeMemory)
      .filter(([k]) => k.startsWith(q) && k !== q)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 4)
      .map(([, m]) => m);
  })();

  function closeExpenseForm() {
    setCategoryTouched(false); setRememberedFrom(null); setShowStoreSuggestions(false);
    setShowAdd(false);
    setEditingExpense(null);
    setAmount(''); setNote(''); setReceiptUri(null);
    setDate(new Date().toISOString().split('T')[0]);
  }

  function openNewExpense() {
    setCategoryTouched(false); setRememberedFrom(null); setShowStoreSuggestions(false);
    setEditingExpense(null);
    setAmount(''); setNote(''); setReceiptUri(null);
    setDate(new Date().toISOString().split('T')[0]);
    setShowAdd(true);
  }

  function openEditExpense(item: Expense) {
    setCategoryTouched(true); setRememberedFrom(null); setShowStoreSuggestions(false); // never auto-change an existing expense
    setEditingExpense(item);
    setAmount(String(item.amount));
    setCategory(item.category);
    setNote(item.note ?? '');
    setDate(item.date);
    setReceiptUri(item.receipt_url ?? null);
    setShowAdd(true);
  }

  async function handleSave() {
    const num = parseFloat(amount);
    if (!amount || isNaN(num) || num <= 0) { showAlert('Invalid amount', 'Enter a valid dollar amount.'); return; }
    setSaving(true);
    try {
      // receiptUri holds either the existing remote receipt_url (unchanged),
      // a freshly-picked local file:// uri (needs uploading), or null
      // (removed). Only upload when it's actually a new local file.
      let receipt_url: string | null | undefined = receiptUri;
      if (receiptUri && receiptUri !== editingExpense?.receipt_url) {
        receipt_url = await uploadReceipt(receiptUri);
      }
      if (editingExpense) {
        const updated = await updateExpense(editingExpense.id, {
          date, amount: num, category, note: note.trim() || undefined, receipt_url,
        });
        setExpenses(prev => prev.map(e => (e.id === updated.id ? updated : e)));
      } else {
        await addExpense({ date, amount: num, category, note: note.trim() || undefined, added_by_name: userName, receipt_url: receipt_url ?? undefined });
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      closeExpenseForm();
      load();
    } catch (e: any) {
      showAlert('Error', e.message);
    } finally {
      setSaving(false);
    }
  }

  function handleDelete(expense: Expense) {
    showConfirm(
      'Delete expense?',
      `$${expense.amount.toFixed(2)} · ${expense.category}${expense.note ? ` · ${expense.note}` : ''}`,
      async () => {
        try {
          await deleteExpense(expense.id);
          closeExpenseForm();
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
          load();
        } catch (e: any) {
          showAlert('Error', e.message);
        }
      },
    );
  }

  async function handleAddCategory() {
    if (!newCatName.trim()) { showAlert('Name required', 'Enter a category name.'); return; }
    const trimmed = newCatName.trim();
    const duplicate = categories.find(c => c.name.trim().toLowerCase() === trimmed.toLowerCase());
    if (duplicate) {
      showAlert('Category already exists', `"${duplicate.name}" is already in your list — pick it below instead of adding a duplicate.`);
      return;
    }
    setSavingCat(true);
    try {
      await addCategory(trimmed, newCatEmoji, newCatColor);
      const cats = await getCategories();
      setCategories(cats);
      setCategory(trimmed);
      setShowNewCat(false);
      setNewCatName(''); setNewCatEmoji('📦'); setNewCatColor(COLOR_OPTIONS[0]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e: any) {
      showAlert('Error', e.message);
    } finally {
      setSavingCat(false);
    }
  }

  const total = expenses.reduce((sum, e) => sum + Number(e.amount), 0);
  const groups = groupByDay(expenses);
  const people: string[] = [];
  for (const e of expenses) {
    const n = (e.added_by_name ?? '').trim();
    if (n && !people.some(p => p.toLowerCase() === n.toLowerCase())) people.push(n);
  }
  const catFor = (name: string) => {
    const c = categories.find(x => x.name === name);
    return { emoji: c?.emoji ?? '📦', color: c?.color ?? CategoryColors[name] ?? '#64748B' };
  };

  const DialogOverlay = confirmDialog || infoDialog ? (
    <View style={styles.dialogOverlay}>
      <View style={styles.dialogBox}>
        <Text style={styles.modalTitle}>{(confirmDialog ?? infoDialog)!.title}</Text>
        {(confirmDialog ?? infoDialog)!.message ? (
          <Text style={styles.dialogMessage}>{(confirmDialog ?? infoDialog)!.message}</Text>
        ) : null}
        {confirmDialog ? (
          <View style={[styles.modalActions, { marginBottom: 0 }]}>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setConfirmDialog(null)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.saveBtn, confirmDialog.confirmLabel === 'Delete' && styles.dangerBtn]}
              onPress={() => { const fn = confirmDialog.onConfirm; setConfirmDialog(null); fn(); }}
            >
              <Text style={styles.saveText}>{confirmDialog.confirmLabel}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={[styles.saveBtn, { marginTop: 4 }]} onPress={() => setInfoDialog(null)}>
            <Text style={styles.saveText}>OK</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  ) : null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Spending" subtitle="Everything you've both spent" />
      <MonthSwitcher label={formatMonthLabel(monthKey)} onPrev={() => changeMonth(-1)} onNext={() => changeMonth(1)} style={{ marginBottom: 14 }} />

      {loading ? (
        <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={groups}
          keyExtractor={g => g.date}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={Colors.primary} />}
          contentContainerStyle={{ paddingBottom: 110 }}
          ListHeaderComponent={
            <View style={styles.summary}>
              <View style={{ flex: 1 }}>
                <Text style={styles.summaryLabel}>Total spent</Text>
                <Text style={styles.summaryValue}>{money(total)}</Text>
                <Text style={styles.summaryMeta}>{expenses.length} expense{expenses.length === 1 ? '' : 's'}</Text>
              </View>
              <View style={{ gap: 8 }}>
                {people.map(p => {
                  const amt = expenses.filter(e => (e.added_by_name ?? '').toLowerCase() === p.toLowerCase()).reduce((s, e) => s + Number(e.amount), 0);
                  return (
                    <View key={p} style={styles.personChip}>
                      <Avatar name={p} size={22} />
                      <Text style={styles.personChipText}>{displayName(p)} · {money(amt, { cents: false })}</Text>
                    </View>
                  );
                })}
              </View>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyEmoji}>🧾</Text>
              <Text style={styles.emptyText}>No spending this month</Text>
              <Text style={styles.emptySubtext}>Tap “Add expense” to log one.</Text>
            </View>
          }
          renderItem={({ item: group }) => (
            <View>
              <Text style={ui.dayHeader}>{group.day}</Text>
              <View style={styles.groupCard}>
                {group.items.map((item, idx) => {
                  const cat = catFor(item.category);
                  const note = (item.note ?? '').trim();
                  return (
                    <TouchableOpacity key={item.id} style={[styles.row, idx > 0 && styles.rowDivider]} onPress={() => openEditExpense(item)} activeOpacity={0.7}>
                      <View>
                        <View style={[styles.catDot, { backgroundColor: cat.color + '22' }]}>
                          <Text style={styles.catEmoji}>{cat.emoji}</Text>
                        </View>
                        {item.added_by_name ? <View style={styles.rowAvatar}><Avatar name={item.added_by_name} size={18} ring /></View> : null}
                      </View>
                      <View style={styles.rowInfo}>
                        <Text style={styles.rowCategory} numberOfLines={1}>{note || item.category}</Text>
                        <Text style={styles.rowMeta} numberOfLines={1}>
                          {[note ? item.category : '', item.added_by_name ? displayName(item.added_by_name) : ''].filter(Boolean).join(' · ') || ' '}
                        </Text>
                      </View>
                      {item.receipt_url ? <Image source={{ uri: item.receipt_url }} style={styles.receiptThumb} contentFit="cover" /> : null}
                      <Text style={styles.rowAmount}>−{money(Number(item.amount))}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}
        />
      )}

      <TouchableOpacity style={ui.fab} onPress={openNewExpense} activeOpacity={0.85}>
        <Ionicons name="add" size={22} color="#fff" />
        <Text style={ui.fabText}>Add expense</Text>
      </TouchableOpacity>

      {/* Add Expense — a plain full-screen overlay instead of RN's <Modal>.
          <Modal> renders in its own top-level layer on web, which sat above
          the in-app dialog below and made warnings (like the duplicate-name
          check) render invisibly behind it. A regular sibling view keeps
          everything in one predictable stacking order. */}
      {showAdd ? (
      <View style={styles.modalRoot}>
        <KeyboardAvoidingView style={styles.modal} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>{editingExpense ? 'Edit Expense' : 'Add Expense'}</Text>

            <Text style={styles.label}>Amount</Text>
            <TextInput
              style={[styles.amountInput, isOverBudget && styles.amountInputOver]}
              placeholder="$0.00"
              placeholderTextColor={Colors.textSecondary}
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              autoFocus
            />

            <Text style={styles.label}>Store or note</Text>
            <TextInput
              style={[styles.input, storeSuggestions.length > 0 && showStoreSuggestions && { marginBottom: 6 }]}
              value={note}
              onChangeText={(t) => { applyStore(t); setShowStoreSuggestions(true); }}
              onFocus={() => setShowStoreSuggestions(true)}
              placeholder="e.g. Market Basket"
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="words"
            />
            {showStoreSuggestions && storeSuggestions.length > 0 ? (
              <View style={styles.suggestBox}>
                {storeSuggestions.map(m => {
                  const c = categories.find(x => x.name === m.category);
                  return (
                    <TouchableOpacity key={m.name} style={styles.suggestRow} onPress={() => { applyStore(m.name, { fromSuggestion: true }); setShowStoreSuggestions(false); }}>
                      <Ionicons name="storefront-outline" size={15} color={Colors.textSecondary} />
                      <Text style={styles.suggestText} numberOfLines={1}>{m.name}</Text>
                      <Text style={styles.suggestCat} numberOfLines={1}>{c?.emoji ?? '📦'} {m.category}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : null}

            <Text style={styles.label}>Category</Text>
            {rememberedFrom && !categoryTouched ? (
              <View style={styles.rememberHint}>
                <Ionicons name="sparkles" size={14} color={Colors.primary} />
                <Text style={styles.rememberText}>You usually file {rememberedFrom} under {category}</Text>
              </View>
            ) : null}
            {modalLoading ? (
              <ActivityIndicator color={Colors.primary} style={{ marginBottom: 16 }} />
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow} contentContainerStyle={{ gap: 8, paddingRight: 8 }}>
                {(rememberedFrom && !categoryTouched
                  // keep the remembered category visible at the front of the row
                  ? [...categories].sort((a, b) => (a.name === category ? -1 : b.name === category ? 1 : 0))
                  : categories
                ).map(cat => {
                  const isSelected = category === cat.name;
                  return (
                    <TouchableOpacity
                      key={cat.name}
                      style={[styles.chip, isSelected && { borderColor: cat.color, backgroundColor: cat.color + '22' }]}
                      onPress={() => { setCategory(cat.name); setCategoryTouched(true); }}
                      activeOpacity={0.75}
                    >
                      <Text style={styles.chipEmoji}>{cat.emoji}</Text>
                      <Text style={[styles.chipName, isSelected && { color: cat.color }]} numberOfLines={1}>{cat.name}</Text>
                    </TouchableOpacity>
                  );
                })}
                <TouchableOpacity style={[styles.chip, styles.chipAdd]} onPress={() => setShowNewCat(true)}>
                  <Ionicons name="add" size={16} color={Colors.textSecondary} />
                  <Text style={styles.chipAddText}>New</Text>
                </TouchableOpacity>
              </ScrollView>
            )}

            {/* One place for budget status — instead of showing spent/remaining
                on every category chip (the old grid), only the selected
                category's balance is shown here, right below the amount
                you're about to log against it. */}
            {selectedCat && remaining !== null ? (
              <View style={[styles.balanceCallout, remaining < 0 && styles.balanceCalloutOver]}>
                <Ionicons name={remaining < 0 ? 'warning-outline' : 'wallet-outline'} size={16} color={remaining < 0 ? Colors.error : Colors.primary} style={{ marginRight: 6 }} />
                <Text style={[styles.balanceCalloutText, remaining < 0 && { color: Colors.error }]}>
                  {selectedCat.emoji} {category}: ${spentFor(category).toFixed(2)} of ${budgetFor(category).toFixed(2)} this month
                  {remaining < 0 ? ` · Over by $${Math.abs(remaining).toFixed(2)}` : ` · $${remaining.toFixed(2)} left`}
                </Text>
              </View>
            ) : null}
            {isOverBudget && remaining !== null && (
              <Text style={styles.overBudgetWarning}>
                ⚠️ This ${enteredAmount.toFixed(2)} would put you ${(enteredAmount - remaining).toFixed(2)} over budget in {category}
              </Text>
            )}

            <Text style={styles.label}>Date</Text>
            <TextInput style={styles.input} value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" placeholderTextColor={Colors.textSecondary} />

            <Text style={styles.label}>Receipt (optional)</Text>
            {receiptUri ? (
              <View style={styles.receiptPreviewWrap}>
                <Image source={{ uri: receiptUri }} style={styles.receiptPreview} contentFit="cover" />
                <TouchableOpacity style={styles.removeReceipt} onPress={() => setReceiptUri(null)}>
                  <Ionicons name="close-circle" size={22} color={Colors.error} />
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.receiptBtnRow}>
                <TouchableOpacity style={styles.receiptBtn} onPress={takeReceiptPhoto}>
                  <Ionicons name="camera-outline" size={18} color={Colors.textSecondary} style={{ marginRight: 6 }} />
                  <Text style={styles.receiptBtnText}>Camera</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.receiptBtn} onPress={pickReceipt}>
                  <Ionicons name="image-outline" size={18} color={Colors.textSecondary} style={{ marginRight: 6 }} />
                  <Text style={styles.receiptBtnText}>Library</Text>
                </TouchableOpacity>
              </View>
            )}

            {editingExpense ? (
              <TouchableOpacity style={styles.deleteRow} onPress={() => handleDelete(editingExpense)}>
                <Ionicons name="trash-outline" size={18} color={Colors.error} />
                <Text style={styles.deleteRowText}>Delete this expense</Text>
              </TouchableOpacity>
            ) : null}
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={closeExpenseForm}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>{editingExpense ? 'Save' : 'Add'}</Text>}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
      ) : null}

      {/* New Category — same reasoning as above: plain overlay, not <Modal>. */}
      {showNewCat ? (
      <View style={styles.modalRoot}>
        <KeyboardAvoidingView style={styles.modal} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>New Category</Text>
          <View style={[styles.catPreview, { backgroundColor: newCatColor + '22', borderColor: newCatColor }]}>
            <Text style={styles.catPreviewEmoji}>{newCatEmoji}</Text>
            <Text style={[styles.catPreviewName, { color: newCatColor }]}>{newCatName || 'Category Name'}</Text>
          </View>
          <Text style={styles.label}>Name</Text>
          <TextInput style={styles.input} value={newCatName} onChangeText={setNewCatName} placeholder="e.g. Gym, Pet Food..." placeholderTextColor={Colors.textSecondary} autoFocus />
          <Text style={styles.label}>Emoji</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
            {EMOJI_OPTIONS.map(e => (
              <TouchableOpacity key={e} style={[styles.emojiOption, newCatEmoji === e && { backgroundColor: Colors.primary + '33', borderColor: Colors.primary }]} onPress={() => setNewCatEmoji(e)}>
                <Text style={{ fontSize: 22 }}>{e}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <Text style={styles.label}>Color</Text>
          <View style={styles.colorGrid}>
            {COLOR_OPTIONS.map(c => (
              <TouchableOpacity key={c} style={[styles.colorDot, { backgroundColor: c }, newCatColor === c && styles.colorDotSelected]} onPress={() => setNewCatColor(c)} />
            ))}
          </View>
          <View style={[styles.modalActions, { marginTop: 24 }]}>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowNewCat(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveBtn} onPress={handleAddCategory} disabled={savingCat}>
              {savingCat ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Add Category</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
      ) : null}

      {DialogOverlay}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  summary: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: 18, ...Shadow.card },
  summaryLabel: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  summaryValue: { fontSize: 30, fontWeight: '800', color: Colors.text, letterSpacing: -0.6, marginTop: 2 },
  summaryMeta: { fontSize: 12.5, color: Colors.textMuted, marginTop: 2 },
  personChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.background, borderRadius: Radius.full, paddingLeft: 3, paddingRight: 10, paddingVertical: 3 },
  personChipText: { fontSize: 12.5, fontWeight: '600', color: Colors.text },
  groupCard: { marginHorizontal: 16, backgroundColor: Colors.surface, borderRadius: Radius.lg, ...Shadow.card },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 13, gap: 12 },
  rowDivider: { borderTopWidth: 1, borderTopColor: Colors.border },
  rowAvatar: { position: 'absolute', right: -4, bottom: -4 },
  catDot: { width: 42, height: 42, borderRadius: 21, justifyContent: 'center', alignItems: 'center' },
  catEmoji: { fontSize: 19 },
  rowInfo: { flex: 1 },
  rowCategory: { fontSize: 15, fontWeight: '600', color: Colors.text },
  rowMeta: { fontSize: 12.5, color: Colors.textSecondary, marginTop: 2 },
  rowAmount: { fontSize: 15, fontWeight: '700', color: Colors.text },
  receiptThumb: { width: 30, height: 30, borderRadius: 8 },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingTop: 70 },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 17, fontWeight: '700', color: Colors.text },
  emptySubtext: { fontSize: 14, color: Colors.textSecondary, marginTop: 6 },
  modalRoot: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  modal: { flex: 1, backgroundColor: Colors.background, paddingHorizontal: 20, paddingTop: 12 },
  modalHandle: { width: 40, height: 5, borderRadius: 3, backgroundColor: Colors.border, alignSelf: 'center', marginBottom: 18 },
  modalTitle: { fontSize: 22, fontWeight: '800', color: Colors.text, marginBottom: 18, textAlign: 'center' },
  label: { fontSize: 13, fontWeight: '700', color: Colors.textSecondary, marginBottom: 8 },
  amountInput: { fontSize: 44, fontWeight: '800', color: Colors.text, textAlign: 'center', backgroundColor: Colors.surface, borderRadius: Radius.lg, paddingHorizontal: 16, paddingVertical: 18, marginBottom: 20, borderWidth: 2, borderColor: 'transparent', ...Shadow.card, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}) },
  amountInputOver: { borderColor: Colors.error, color: Colors.error },
  overBudgetWarning: { fontSize: 13, color: Colors.error, fontWeight: '600', marginTop: -8, marginBottom: 16, paddingHorizontal: 4 },
  chipRow: { marginBottom: 12 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.surface, borderRadius: Radius.full, borderWidth: 2, borderColor: Colors.border, paddingHorizontal: 14, paddingVertical: 9 },
  chipAdd: { borderColor: Colors.border, borderStyle: 'dashed' },
  chipEmoji: { fontSize: 16 },
  chipName: { fontSize: 13.5, fontWeight: '700', color: Colors.text },
  chipAddText: { fontSize: 13.5, fontWeight: '600', color: Colors.textSecondary },
  balanceCallout: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.primaryLight, borderRadius: Radius.md, padding: 12, marginBottom: 16 },
  balanceCalloutOver: { backgroundColor: Colors.error + '14' },
  balanceCalloutText: { flex: 1, fontSize: 13, color: Colors.primaryDark, fontWeight: '600', lineHeight: 18 },
  input: { backgroundColor: Colors.surface, borderRadius: Radius.md, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: Colors.text, marginBottom: 20, borderWidth: 1, borderColor: Colors.border },
  receiptBtnRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  receiptBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, borderStyle: 'dashed', paddingHorizontal: 12, paddingVertical: 14 },
  receiptBtnText: { fontSize: 14, color: Colors.textSecondary, fontWeight: '600' },
  receiptPreviewWrap: { position: 'relative', marginBottom: 20, alignSelf: 'flex-start' },
  receiptPreview: { width: 120, height: 120, borderRadius: Radius.md },
  removeReceipt: { position: 'absolute', top: -8, right: -8 },
  deleteRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, marginBottom: 8 },
  deleteRowText: { color: Colors.error, fontWeight: '700', fontSize: 15 },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 8, marginBottom: 32 },
  cancelBtn: { flex: 1, backgroundColor: Colors.surfaceHigh, borderRadius: Radius.full, paddingVertical: 16, alignItems: 'center' },
  cancelText: { color: Colors.text, fontSize: 16, fontWeight: '700' },
  saveBtn: { flex: 2, backgroundColor: Colors.primary, borderRadius: Radius.full, paddingVertical: 16, alignItems: 'center' },
  dangerBtn: { backgroundColor: Colors.error },
  saveText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  catPreview: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: Radius.md, borderWidth: 2, marginBottom: 20 },
  catPreviewEmoji: { fontSize: 28 },
  catPreviewName: { fontSize: 17, fontWeight: '700' },
  emojiOption: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 8, borderWidth: 2, borderColor: 'transparent', backgroundColor: Colors.surface },
  colorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  colorDot: { width: 36, height: 36, borderRadius: 18 },
  colorDotSelected: { borderWidth: 3, borderColor: Colors.text },
  suggestBox: { backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, marginBottom: 20, overflow: 'hidden' },
  suggestRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: Colors.border },
  suggestText: { flex: 1, fontSize: 15, color: Colors.text, fontWeight: '600' },
  suggestCat: { fontSize: 13, color: Colors.textSecondary, maxWidth: '45%' },
  rememberHint: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: -2, marginBottom: 10 },
  rememberText: { fontSize: 13, color: Colors.primaryDark, fontWeight: '600', flexShrink: 1 },
  dialogOverlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(24,32,47,0.4)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  dialogBox: { width: '100%', maxWidth: 400, backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: 22 },
  dialogMessage: { fontSize: 14, color: Colors.textSecondary, lineHeight: 20, marginTop: -8, marginBottom: 16 },
});
