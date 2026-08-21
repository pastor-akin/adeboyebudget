import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Modal,
  TextInput, ScrollView, Alert, ActivityIndicator, KeyboardAvoidingView,
  Platform, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  supabase, Income,
  addIncome, deleteIncome, getIncome, getIncomeNames, toMonthKey, formatMonthLabel,
} from '../../services/supabase';
import { Colors } from '../../constants/theme';

export default function IncomeScreen() {
  const [monthKey, setMonthKey] = useState(toMonthKey());
  const [income, setIncome] = useState<Income[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [userName, setUserName] = useState('');

  const [knownNames, setKnownNames] = useState<string[]>([]);

  const [amount, setAmount] = useState('');
  const [name, setName] = useState('');
  const [source, setSource] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [saving, setSaving] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserName(user?.email?.split('@')[0] ?? 'You');
    });
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await getIncome(monthKey);
      setIncome(data);
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
    getIncomeNames().then(setKnownNames).catch(() => {});
  }, [showAdd]);

  // Prefix match against everyone/everything ever entered — since income
  // repeats (same paycheck, same clients), typing a letter or two narrows it
  // down instead of retyping the full name every time.
  const nameSuggestions = (() => {
    const q = name.trim().toLowerCase();
    if (!q) return [];
    return knownNames.filter(n => n.toLowerCase().startsWith(q) && n.toLowerCase() !== q).slice(0, 5);
  })();

  function changeMonth(delta: number) {
    const [year, mon] = monthKey.split('-').map(Number);
    setMonthKey(toMonthKey(new Date(year, mon - 1 + delta, 1)));
  }

  function openAdd() {
    setAmount(''); setName(''); setSource('');
    setDate(new Date().toISOString().split('T')[0]);
    setShowSuggestions(false);
    setShowAdd(true);
  }

  async function handleAdd() {
    const num = parseFloat(amount);
    if (!amount || isNaN(num) || num <= 0) { Alert.alert('Invalid amount', 'Enter a valid dollar amount.'); return; }
    setSaving(true);
    try {
      await addIncome({ date, amount: num, name: name.trim(), source: source.trim(), added_by_name: userName });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowAdd(false);
      load();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(item: Income) {
    Alert.alert('Delete income?', `$${item.amount.toFixed(2)}${item.name ? ` · ${item.name}` : ''}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await deleteIncome(item.id); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); load(); }
        catch (e: any) { Alert.alert('Error', e.message); }
      }},
    ]);
  }

  const total = income.reduce((sum, i) => sum + i.amount, 0);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => changeMonth(-1)} style={styles.navBtn}>
          <Ionicons name="chevron-back" size={22} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.monthLabel}>{formatMonthLabel(monthKey)}</Text>
          <Text style={styles.totalLabel}>${total.toFixed(2)} received</Text>
        </View>
        <TouchableOpacity onPress={() => changeMonth(1)} style={styles.navBtn}>
          <Ionicons name="chevron-forward" size={22} color={Colors.text} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={income}
          keyExtractor={i => i.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={Colors.primary} />}
          contentContainerStyle={income.length === 0 ? styles.empty : { paddingBottom: 100 }}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyEmoji}>💰</Text>
              <Text style={styles.emptyText}>No income logged this month</Text>
              <Text style={styles.emptySubtext}>Tap + to add one</Text>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.row} onLongPress={() => handleDelete(item)} activeOpacity={0.7}>
              <View style={styles.catDot}>
                <Text style={styles.catEmoji}>💵</Text>
              </View>
              <View style={styles.rowInfo}>
                <Text style={styles.rowCategory}>{item.name || 'Income'}</Text>
                <Text style={styles.rowMeta}>
                  {item.date}{item.source ? ` · ${item.source}` : ''}{item.added_by_name ? ` · ${item.added_by_name}` : ''}
                </Text>
              </View>
              <Text style={styles.rowAmount}>${item.amount.toFixed(2)}</Text>
            </TouchableOpacity>
          )}
        />
      )}

      <TouchableOpacity style={styles.fab} onPress={openAdd}>
        <Ionicons name="add" size={28} color="#fff" />
      </TouchableOpacity>

      {/* Add Income Modal */}
      <Modal visible={showAdd} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowAdd(false)}>
        <KeyboardAvoidingView style={styles.modal} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Add Income</Text>

            <Text style={styles.label}>Amount</Text>
            <TextInput
              style={styles.amountInput}
              placeholder="$0.00"
              placeholderTextColor={Colors.textSecondary}
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              autoFocus
            />

            <Text style={styles.label}>Name</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={(t) => { setName(t); setShowSuggestions(true); }}
              onFocus={() => setShowSuggestions(true)}
              placeholder="Start typing a name..."
              placeholderTextColor={Colors.textSecondary}
              autoCapitalize="words"
            />
            {showSuggestions && nameSuggestions.length > 0 && (
              <View style={styles.suggestBox}>
                {nameSuggestions.map((n) => (
                  <TouchableOpacity
                    key={n}
                    style={styles.suggestRow}
                    onPress={() => { setName(n); setShowSuggestions(false); }}
                  >
                    <Ionicons name="person-outline" size={14} color={Colors.textSecondary} />
                    <Text style={styles.suggestText}>{n}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <Text style={styles.label}>Source</Text>
            <TextInput style={styles.input} value={source} onChangeText={setSource} placeholder="e.g. Paycheck, Freelance, Gift" placeholderTextColor={Colors.textSecondary} />

            <Text style={styles.label}>Date</Text>
            <TextInput style={styles.input} value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" placeholderTextColor={Colors.textSecondary} />

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
  catDot: { width: 42, height: 42, borderRadius: 21, justifyContent: 'center', alignItems: 'center', marginRight: 12, backgroundColor: Colors.primary + '22' },
  catEmoji: { fontSize: 20 },
  rowInfo: { flex: 1 },
  rowCategory: { fontSize: 15, fontWeight: '600', color: Colors.text },
  rowMeta: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  rowAmount: { fontSize: 16, fontWeight: '700', color: Colors.primary },
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
  amountInput: { fontSize: 36, fontWeight: '700', color: Colors.text, backgroundColor: Colors.surface, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 16, marginBottom: 20, borderWidth: 2, borderColor: 'transparent' },
  input: { backgroundColor: Colors.surface, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: Colors.text, marginBottom: 20, borderWidth: 1, borderColor: Colors.border },
  suggestBox: { backgroundColor: Colors.surface, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, marginTop: -12, marginBottom: 20, overflow: 'hidden' },
  suggestRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.border },
  suggestText: { fontSize: 15, color: Colors.text },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 8, marginBottom: 32 },
  cancelBtn: { flex: 1, backgroundColor: Colors.surface, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  cancelText: { color: Colors.textSecondary, fontSize: 16, fontWeight: '600' },
  saveBtn: { flex: 2, backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  saveText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
