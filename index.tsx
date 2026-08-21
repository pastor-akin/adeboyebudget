import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Modal,
  TextInput, ScrollView, Alert, ActivityIndicator, KeyboardAvoidingView,
  Platform, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import {
  supabase, Expense, BudgetLimit, AppCategory, Category,
  addExpense, deleteExpense, getExpenses, getBudgets,
  getCategories, addCategory, uploadReceipt, toMonthKey, formatMonthLabel,
} from '../../services/supabase';
import { Colors, COLOR_OPTIONS, EMOJI_OPTIONS } from '../../constants/theme';

export default function ExpensesScreen() {
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

  const [showNewCat, setShowNewCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatEmoji, setNewCatEmoji] = useState('📦');
  const [newCatColor, setNewCatColor] = useState(COLOR_OPTIONS[0]);
  const [savingCat, setSavingCat] = useState(false);

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
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [monthKey]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  useEffect(() => {
    if (!showAdd) return;
    setModalLoading(true);
    Promise.all([
      getCategories(),
      getBudgets(toMonthKey()),
      getExpenses(toMonthKey()),
    ])
      .then(([cats, budgets, exps]) => {
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

  function changeMonth(delta: number) {
    const [year, mon] = monthKey.split('-').map(Number);
    setMonthKey(toMonthKey(new Date(year, mon - 1 + delta, 1)));
  }

  async function pickReceipt() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission needed', 'Allow photo access.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7, allowsEditing: true });
    if (!result.canceled) setReceiptUri(result.assets[0].uri);
  }

  async function takeReceiptPhoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission needed', 'Allow camera access.'); return; }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7, allowsEditing: true });
    if (!result.canceled) setReceiptUri(result.assets[0].uri);
  }

  function promptReceiptSource() {
    Alert.alert('Add Receipt', undefined, [
      { text: 'Camera', onPress: takeReceiptPhoto },
      { text: 'Photo Library', onPress: pickReceipt },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function handleAdd() {
    const num = parseFloat(amount);
    if (!amount || isNaN(num) || num <= 0) { Alert.alert('Invalid amount', 'Enter a valid dollar amount.'); return; }
    setSaving(true);
    try {
      let receipt_url: string | undefined;
      if (receiptUri) receipt_url = await uploadReceipt(receiptUri);
      await addExpense({ date, amount: num, category, note: note.trim() || undefined, added_by_name: userName, receipt_url });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowAdd(false);
      setAmount(''); setNote(''); setReceiptUri(null);
      setDate(new Date().toISOString().split('T')[0]);
      load();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(expense: Expense) {
    Alert.alert('Delete expense?', `$${expense.amount.toFixed(2)} · ${expense.category}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await deleteExpense(expense.id); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); load(); }
        catch (e: any) { Alert.alert('Error', e.message); }
      }},
    ]);
  }

  async function handleAddCategory() {
    if (!newCatName.trim()) { Alert.alert('Name required', 'Enter a category name.'); return; }
    setSavingCat(true);
    try {
      await addCategory(newCatName.trim(), newCatEmoji, newCatColor);
      const cats = await getCategories();
      setCategories(cats);
      setCategory(newCatName.trim());
      setShowNewCat(false);
      setNewCatName(''); setNewCatEmoji('📦'); setNewCatColor(COLOR_OPTIONS[0]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSavingCat(false);
    }
  }

  const total = expenses.reduce((sum, e) => sum + e.amount, 0);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => changeMonth(-1)} style={styles.navBtn}>
          <Ionicons name="chevron-back" size={22} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.monthLabel}>{formatMonthLabel(monthKey)}</Text>
          <Text style={styles.totalLabel}>${total.toFixed(2)} spent</Text>
        </View>
        <TouchableOpacity onPress={() => changeMonth(1)} style={styles.navBtn}>
          <Ionicons name="chevron-forward" size={22} color={Colors.text} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={expenses}
          keyExtractor={e => e.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={Colors.primary} />}
          contentContainerStyle={expenses.length === 0 ? styles.empty : { paddingBottom: 100 }}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyEmoji}>📭</Text>
              <Text style={styles.emptyText}>No expenses this month</Text>
              <Text style={styles.emptySubtext}>Tap + to add one</Text>
            </View>
          }
          renderItem={({ item }) => {
            const cat = categories.find(c => c.name === item.category);
            return (
              <TouchableOpacity style={styles.row} onLongPress={() => handleDelete(item)} activeOpacity={0.7}>
                <View style={[styles.catDot, { backgroundColor: cat?.color ?? Colors.surfaceHigh }]}>
                  <Text style={styles.catEmoji}>{cat?.emoji ?? '📦'}</Text>
                </View>
                <View style={styles.rowInfo}>
                  <Text style={styles.rowCategory}>{item.category}</Text>
                  <Text style={styles.rowMeta}>
                    {item.date}{item.added_by_name ? ` · ${item.added_by_name}` : ''}{item.note ? ` · ${item.note}` : ''}
                  </Text>
                </View>
                <View style={styles.rowRight}>
                  <Text style={styles.rowAmount}>${item.amount.toFixed(2)}</Text>
                  {item.receipt_url && <Image source={{ uri: item.receipt_url }} style={styles.receiptThumb} contentFit="cover" />}
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}

      <TouchableOpacity style={styles.fab} onPress={() => setShowAdd(true)}>
        <Ionicons name="add" size={28} color="#fff" />
      </TouchableOpacity>

      {/* Add Expense Modal */}
      <Modal visible={showAdd} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowAdd(false)}>
        <KeyboardAvoidingView style={styles.modal} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Add Expense</Text>

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
            {isOverBudget && remaining !== null && (
              <Text style={styles.overBudgetWarning}>
                ⚠️ Over budget by ${(enteredAmount - remaining).toFixed(2)} — only ${remaining.toFixed(2)} left in {category}
              </Text>
            )}

            <Text style={styles.label}>Category</Text>
            {modalLoading ? (
              <ActivityIndicator color={Colors.primary} style={{ marginBottom: 20 }} />
            ) : (
              <View style={styles.catGrid}>
                {categories.map(cat => {
                  const rem = remainingFor(cat.name);
                  const spent = spentFor(cat.name);
                  const limit = budgetFor(cat.name);
                  const isOver = rem !== null && rem < 0;
                  const isSelected = category === cat.name;
                  return (
                    <TouchableOpacity
                      key={cat.name}
                      style={[
                        styles.catCard,
                        isSelected && { borderColor: cat.color, borderWidth: 2, backgroundColor: cat.color + '22' },
                      ]}
                      onPress={() => setCategory(cat.name)}
                      activeOpacity={0.75}
                    >
                      <Text style={styles.catCardEmoji}>{cat.emoji}</Text>
                      <Text style={[styles.catCardName, isSelected && { color: cat.color }]} numberOfLines={1}>{cat.name}</Text>
                      {limit > 0 ? (
                        <Text style={[styles.catCardBalance, isOver && styles.catCardBalanceOver]}>
                          {isOver ? `Over $${Math.abs(rem!).toFixed(0)}` : `$${rem!.toFixed(0)} left`}
                        </Text>
                      ) : (
                        <Text style={styles.catCardNoLimit}>${spent.toFixed(0)} spent</Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
                <TouchableOpacity style={[styles.catCard, styles.catCardAdd]} onPress={() => setShowNewCat(true)}>
                  <Ionicons name="add-circle-outline" size={24} color={Colors.textSecondary} />
                  <Text style={styles.catCardAddText}>New{'\n'}Category</Text>
                </TouchableOpacity>
              </View>
            )}

            {(() => {
              const rem = remainingFor(category);
              const limit = budgetFor(category);
              const spent = spentFor(category);
              const cat = categories.find(c => c.name === category);
              if (limit <= 0 || !cat) return null;
              const isOver = rem! < 0;
              return (
                <View style={[styles.balanceCallout, isOver && styles.balanceCalloutOver]}>
                  <Ionicons name={isOver ? 'warning-outline' : 'wallet-outline'} size={16} color={isOver ? Colors.error : Colors.primary} style={{ marginRight: 6 }} />
                  <Text style={[styles.balanceCalloutText, isOver && { color: Colors.error }]}>
                    {cat.emoji} {category}: ${spent.toFixed(2)} of ${limit.toFixed(2)}
                    {isOver ? ` · Over by $${Math.abs(rem!).toFixed(2)}` : ` · $${rem!.toFixed(2)} remaining`}
                  </Text>
                </View>
              );
            })()}

            <Text style={[styles.label, { marginTop: 8 }]}>Date</Text>
            <TextInput style={styles.input} value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" placeholderTextColor={Colors.textSecondary} />

            <Text style={styles.label}>Note (optional)</Text>
            <TextInput style={styles.input} value={note} onChangeText={setNote} placeholder="What was it for?" placeholderTextColor={Colors.textSecondary} />

            <Text style={styles.label}>Receipt (optional)</Text>
            {receiptUri ? (
              <View style={styles.receiptPreviewWrap}>
                <Image source={{ uri: receiptUri }} style={styles.receiptPreview} contentFit="cover" />
                <TouchableOpacity style={styles.removeReceipt} onPress={() => setReceiptUri(null)}>
                  <Ionicons name="close-circle" size={22} color={Colors.error} />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={styles.receiptBtn} onPress={promptReceiptSource}>
                <Ionicons name="camera-outline" size={20} color={Colors.textSecondary} style={{ marginRight: 8 }} />
                <Text style={styles.receiptBtnText}>Attach receipt photo</Text>
              </TouchableOpacity>
            )}

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowAdd(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleAdd} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Add</Text>}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* New Category Modal */}
      <Modal visible={showNewCat} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setShowNewCat(false)}>
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
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  navBtn: { padding: 8 },
  headerCenter: { alignItems: 'center' },
  monthLabel: { fontSize: 17, fontWeight: '700', color: Colors.text },
  totalLabel: { fontSize: 13, color: Colors.primary, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.border },
  catDot: { width: 42, height: 42, borderRadius: 21, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  catEmoji: { fontSize: 20 },
  rowInfo: { flex: 1 },
  rowCategory: { fontSize: 15, fontWeight: '600', color: Colors.text },
  rowMeta: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  rowRight: { alignItems: 'flex-end', gap: 4 },
  rowAmount: { fontSize: 16, fontWeight: '700', color: Colors.text },
  receiptThumb: { width: 32, height: 32, borderRadius: 6 },
  empty: { flex: 1 },
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 100 },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 17, fontWeight: '600', color: Colors.text },
  emptySubtext: { fontSize: 14, color: Colors.textSecondary, marginTop: 6 },
  fab: { position: 'absolute', bottom: 24, right: 24, width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.primary, justifyContent: 'center', alignItems: 'center', shadowColor: Colors.primary, shadowOpacity: 0.5, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 8 },
  modal: { flex: 1, backgroundColor: Colors.background, paddingHorizontal: 20, paddingTop: 12 },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 22, fontWeight: '700', color: Colors.text, marginBottom: 20 },
  label: { fontSize: 12, fontWeight: '700', color: Colors.textSecondary, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.8 },
  amountInput: { fontSize: 36, fontWeight: '700', color: Colors.text, backgroundColor: Colors.surface, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 16, marginBottom: 8, borderWidth: 2, borderColor: 'transparent' },
  amountInputOver: { borderColor: Colors.error, color: Colors.error },
  overBudgetWarning: { fontSize: 13, color: Colors.error, fontWeight: '600', marginBottom: 16, paddingHorizontal: 4 },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  catCard: { width: '47%', backgroundColor: Colors.surface, borderRadius: 14, padding: 14, borderWidth: 2, borderColor: 'transparent', alignItems: 'flex-start' },
  catCardAdd: { justifyContent: 'center', alignItems: 'center', borderColor: Colors.border, borderStyle: 'dashed' },
  catCardAddText: { fontSize: 12, color: Colors.textSecondary, marginTop: 6, textAlign: 'center' },
  catCardEmoji: { fontSize: 22, marginBottom: 6 },
  catCardName: { fontSize: 13, fontWeight: '700', color: Colors.text, marginBottom: 4 },
  catCardBalance: { fontSize: 12, fontWeight: '600', color: Colors.primary },
  catCardBalanceOver: { color: Colors.error },
  catCardNoLimit: { fontSize: 12, color: Colors.textSecondary },
  balanceCallout: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.primary + '1A', borderRadius: 10, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: Colors.primary + '44' },
  balanceCalloutOver: { backgroundColor: Colors.error + '1A', borderColor: Colors.error + '44' },
  balanceCalloutText: { flex: 1, fontSize: 13, color: Colors.primary, fontWeight: '500', lineHeight: 18 },
  input: { backgroundColor: Colors.surface, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: Colors.text, marginBottom: 20, borderWidth: 1, borderColor: Colors.border },
  receiptBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, borderStyle: 'dashed', paddingHorizontal: 16, paddingVertical: 14, marginBottom: 20 },
  receiptBtnText: { fontSize: 15, color: Colors.textSecondary },
  receiptPreviewWrap: { position: 'relative', marginBottom: 20, alignSelf: 'flex-start' },
  receiptPreview: { width: 120, height: 120, borderRadius: 12 },
  removeReceipt: { position: 'absolute', top: -8, right: -8 },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 8, marginBottom: 32 },
  cancelBtn: { flex: 1, backgroundColor: Colors.surface, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  cancelText: { color: Colors.textSecondary, fontSize: 16, fontWeight: '600' },
  saveBtn: { flex: 2, backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  saveText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  catPreview: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 14, borderWidth: 2, marginBottom: 20 },
  catPreviewEmoji: { fontSize: 28 },
  catPreviewName: { fontSize: 17, fontWeight: '700' },
  emojiOption: { width: 44, height: 44, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginRight: 8, borderWidth: 2, borderColor: 'transparent', backgroundColor: Colors.surface },
  colorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  colorDot: { width: 36, height: 36, borderRadius: 18 },
  colorDotSelected: { borderWidth: 3, borderColor: Colors.text },
});
