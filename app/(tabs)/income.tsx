import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, ScrollView, ActivityIndicator, KeyboardAvoidingView,
  Platform, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  supabase, Income,
  addIncome, deleteIncome, getIncome, getIncomeNames, toMonthKey, formatMonthLabel,
} from '../../services/supabase';
import { Colors, Radius, Shadow } from '../../constants/theme';
import { Avatar, ScreenHeader, MonthSwitcher, groupByDay, displayName, money, ui } from '../../components/ui';

export default function IncomeScreen() {
  const params = useLocalSearchParams<{ add?: string }>();
  const router = useRouter();
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

  // In-app dialogs (RN's Alert.alert does nothing in a web browser).
  const [infoDialog, setInfoDialog] = useState<{ title: string; message?: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Income | null>(null);
  const showAlert = (title: string, message?: string) => setInfoDialog({ title, message });

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
      showAlert('Error', e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [monthKey]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  // Home's "Income" quick action links here with ?add=1.
  useEffect(() => {
    if (params.add === '1') {
      openAdd();
      router.setParams({ add: undefined });
    }
  }, [params.add]);

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
    if (!amount || isNaN(num) || num <= 0) { showAlert('Invalid amount', 'Enter a valid dollar amount.'); return; }
    setSaving(true);
    try {
      await addIncome({ date, amount: num, name: name.trim(), source: source.trim(), added_by_name: userName });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setShowAdd(false);
      load();
    } catch (e: any) {
      showAlert('Error', e.message);
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    const item = deleteTarget;
    setDeleteTarget(null);
    if (!item) return;
    try {
      await deleteIncome(item.id);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      load();
    } catch (e: any) {
      showAlert('Error', e.message);
    }
  }

  const total = income.reduce((sum, i) => sum + Number(i.amount), 0);
  const groups = groupByDay(income);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Income" subtitle="Money coming into the household" />
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
              <View style={styles.summaryIcon}><Ionicons name="arrow-down" size={22} color={Colors.income} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.summaryLabel}>Received this month</Text>
                <Text style={styles.summaryValue}>{money(total)}</Text>
              </View>
              <Text style={styles.summaryMeta}>{income.length} deposit{income.length === 1 ? '' : 's'}</Text>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyEmoji}>💰</Text>
              <Text style={styles.emptyText}>No income logged this month</Text>
              <Text style={styles.emptySubtext}>Tap “Add income” to log a paycheck or gift.</Text>
            </View>
          }
          renderItem={({ item: group }) => (
            <View>
              <Text style={ui.dayHeader}>{group.day}</Text>
              <View style={styles.groupCard}>
                {group.items.map((item, idx) => (
                  <TouchableOpacity key={item.id} style={[styles.row, idx > 0 && styles.rowDivider]} onPress={() => setDeleteTarget(item)} activeOpacity={0.7}>
                    <View>
                      <View style={styles.catDot}><Ionicons name="cash-outline" size={20} color={Colors.income} /></View>
                      {item.added_by_name ? <View style={styles.rowAvatar}><Avatar name={item.added_by_name} size={18} ring /></View> : null}
                    </View>
                    <View style={styles.rowInfo}>
                      <Text style={styles.rowTitle} numberOfLines={1}>{item.name || 'Income'}</Text>
                      <Text style={styles.rowMeta} numberOfLines={1}>
                        {[item.source, item.added_by_name ? displayName(item.added_by_name) : ''].filter(Boolean).join(' · ') || ' '}
                      </Text>
                    </View>
                    <Text style={styles.rowAmount}>+{money(Number(item.amount))}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}
        />
      )}

      <TouchableOpacity style={[ui.fab, { backgroundColor: Colors.income, shadowColor: Colors.income }]} onPress={openAdd} activeOpacity={0.85}>
        <Ionicons name="add" size={22} color="#fff" />
        <Text style={ui.fabText}>Add income</Text>
      </TouchableOpacity>

      {/* Add Income — a plain overlay rather than <Modal>, so dialogs stack predictably on web. */}
      {showAdd ? (
        <View style={styles.modalRoot}>
          <KeyboardAvoidingView style={styles.modal} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <View style={styles.modalHandle} />
              <Text style={styles.modalTitle}>Add Income</Text>

              <TextInput
                style={styles.amountInput}
                placeholder="$0.00"
                placeholderTextColor={Colors.textMuted}
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
                autoFocus
              />

              <Text style={styles.label}>From</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={(t) => { setName(t); setShowSuggestions(true); }}
                onFocus={() => setShowSuggestions(true)}
                placeholder="Employer, client, or person"
                placeholderTextColor={Colors.textMuted}
                autoCapitalize="words"
              />
              {showSuggestions && nameSuggestions.length > 0 && (
                <View style={styles.suggestBox}>
                  {nameSuggestions.map((n) => (
                    <TouchableOpacity key={n} style={styles.suggestRow} onPress={() => { setName(n); setShowSuggestions(false); }}>
                      <Ionicons name="person-outline" size={14} color={Colors.textSecondary} />
                      <Text style={styles.suggestText}>{n}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <Text style={styles.label}>Type</Text>
              <TextInput style={styles.input} value={source} onChangeText={setSource} placeholder="e.g. Paycheck, Freelance, Gift" placeholderTextColor={Colors.textMuted} />

              <Text style={styles.label}>Date</Text>
              <TextInput style={styles.input} value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" placeholderTextColor={Colors.textMuted} />

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
        </View>
      ) : null}

      {deleteTarget || infoDialog ? (
        <View style={styles.dialogOverlay}>
          <View style={styles.dialogBox}>
            <Text style={styles.dialogTitle}>{deleteTarget ? 'Delete this income?' : infoDialog!.title}</Text>
            <Text style={styles.dialogMessage}>
              {deleteTarget
                ? `${money(Number(deleteTarget.amount))}${deleteTarget.name ? ` from ${deleteTarget.name}` : ''} on ${deleteTarget.date}. This can't be undone.`
                : infoDialog!.message ?? ''}
            </Text>
            {deleteTarget ? (
              <View style={styles.modalActionsDialog}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setDeleteTarget(null)}><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.saveBtn, { backgroundColor: Colors.error }]} onPress={confirmDelete}><Text style={styles.saveText}>Delete</Text></TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={[styles.saveBtn, { flex: 0 }]} onPress={() => setInfoDialog(null)}><Text style={styles.saveText}>OK</Text></TouchableOpacity>
            )}
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 14, marginHorizontal: 16, backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: 18, ...Shadow.card },
  summaryIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: Colors.income + '1A', alignItems: 'center', justifyContent: 'center' },
  summaryLabel: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  summaryValue: { fontSize: 28, fontWeight: '800', color: Colors.income, letterSpacing: -0.5, marginTop: 2 },
  summaryMeta: { fontSize: 12.5, color: Colors.textMuted, fontWeight: '600' },
  groupCard: { marginHorizontal: 16, backgroundColor: Colors.surface, borderRadius: Radius.lg, ...Shadow.card },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 13, gap: 12 },
  rowDivider: { borderTopWidth: 1, borderTopColor: Colors.border },
  rowAvatar: { position: 'absolute', right: -4, bottom: -4 },
  catDot: { width: 42, height: 42, borderRadius: 21, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.income + '1A' },
  rowInfo: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '600', color: Colors.text },
  rowMeta: { fontSize: 12.5, color: Colors.textSecondary, marginTop: 2 },
  rowAmount: { fontSize: 15, fontWeight: '700', color: Colors.income },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingTop: 70, paddingHorizontal: 30 },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 17, fontWeight: '700', color: Colors.text },
  emptySubtext: { fontSize: 14, color: Colors.textSecondary, marginTop: 6, textAlign: 'center' },
  modalRoot: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  modal: { flex: 1, backgroundColor: Colors.background, paddingHorizontal: 20, paddingTop: 12 },
  modalHandle: { width: 40, height: 5, borderRadius: 3, backgroundColor: Colors.border, alignSelf: 'center', marginBottom: 18 },
  modalTitle: { fontSize: 22, fontWeight: '800', color: Colors.text, marginBottom: 18, textAlign: 'center' },
  label: { fontSize: 13, fontWeight: '700', color: Colors.textSecondary, marginBottom: 8 },
  amountInput: { fontSize: 44, fontWeight: '800', color: Colors.income, textAlign: 'center', backgroundColor: Colors.surface, borderRadius: Radius.lg, paddingHorizontal: 16, paddingVertical: 18, marginBottom: 20, ...Shadow.card, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}) },
  input: { backgroundColor: Colors.surface, borderRadius: Radius.md, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: Colors.text, marginBottom: 20, borderWidth: 1, borderColor: Colors.border },
  suggestBox: { backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, marginTop: -12, marginBottom: 20, overflow: 'hidden' },
  suggestRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.border },
  suggestText: { fontSize: 15, color: Colors.text },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 8, marginBottom: 32 },
  modalActionsDialog: { flexDirection: 'row', gap: 12 },
  cancelBtn: { flex: 1, backgroundColor: Colors.surfaceHigh, borderRadius: Radius.full, paddingVertical: 15, alignItems: 'center' },
  cancelText: { color: Colors.text, fontSize: 16, fontWeight: '700' },
  saveBtn: { flex: 2, backgroundColor: Colors.income, borderRadius: Radius.full, paddingVertical: 15, alignItems: 'center' },
  saveText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  dialogOverlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(24,32,47,0.4)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  dialogBox: { width: '100%', maxWidth: 400, backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: 22 },
  dialogTitle: { fontSize: 18, fontWeight: '800', color: Colors.text },
  dialogMessage: { fontSize: 14, color: Colors.textSecondary, lineHeight: 20, marginTop: 6, marginBottom: 18 },
});
