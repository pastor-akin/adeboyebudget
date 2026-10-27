/*
 * Home — the household dashboard the app opens to: who's here, how much is
 * left to spend this month, who spent what, which budgets need watching,
 * and the latest activity from both partners.
 */
import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  supabase, Expense, Income, AppCategory, BudgetLimit,
  getExpenses, getIncome, getBudgets, getCategories, toMonthKey, formatMonthLabel,
} from '../../services/supabase';
import { Colors, Radius, Shadow, CategoryColors } from '../../constants/theme';
import { Avatar, AvatarStack, MonthSwitcher, IconButton, displayName, dayLabel, money, ui } from '../../components/ui';

type FeedItem =
  | { kind: 'expense'; id: string; date: string; created_at: string; amount: number; who?: string; title: string; sub: string; emoji: string; color: string }
  | { kind: 'income'; id: string; date: string; created_at: string; amount: number; who?: string; title: string; sub: string };

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function HomeScreen() {
  const router = useRouter();
  const [monthKey, setMonthKey] = useState(toMonthKey());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userName, setUserName] = useState('');
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [income, setIncome] = useState<Income[]>([]);
  const [budgets, setBudgets] = useState<BudgetLimit[]>([]);
  const [categories, setCategories] = useState<AppCategory[]>([]);
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  const load = useCallback(async () => {
    try {
      const [{ data: { user } }, exps, inc, buds, cats] = await Promise.all([
        supabase.auth.getUser(), getExpenses(monthKey), getIncome(monthKey), getBudgets(monthKey), getCategories(),
      ]);
      setUserName(user?.email?.split('@')[0] ?? '');
      setExpenses(exps); setIncome(inc); setBudgets(buds); setCategories(cats);
    } catch {
      // keep whatever was shown before; pull to refresh retries
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, [monthKey]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function changeMonth(delta: number) {
    const [y, m] = monthKey.split('-').map(Number);
    setLoading(true);
    setMonthKey(toMonthKey(new Date(y, m - 1 + delta, 1)));
  }

  // ── numbers ──────────────────────────────────────────────────────────────
  const spent = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const received = income.reduce((s, i) => s + Number(i.amount), 0);
  const monthlyRows = budgets.filter(b => b.frequency === 'monthly' && b.month === monthKey);
  const yearlyRows = budgets.filter(b => b.frequency === 'yearly');
  const budgetByCat: Record<string, number> = {};
  if (monthlyRows.length > 0) for (const b of monthlyRows) budgetByCat[b.category] = Number(b.amount);
  else for (const b of yearlyRows) budgetByCat[b.category] = Number(b.amount) / 12;
  const monthBudget = Object.values(budgetByCat).reduce((s, v) => s + v, 0);
  const left = monthBudget - spent;
  const pct = monthBudget > 0 ? Math.min(1, spent / monthBudget) : 0;

  const [y, m] = monthKey.split('-').map(Number);
  const isCurrentMonth = monthKey === toMonthKey();
  const daysInMonth = new Date(y, m, 0).getDate();
  const daysLeft = isCurrentMonth ? daysInMonth - new Date().getDate() + 1 : 0;

  // who's in the household (from this month's activity + the signed-in user)
  const people: string[] = [];
  const addPerson = (n?: string) => { const k = (n ?? '').trim(); if (k && !people.some(p => p.toLowerCase() === k.toLowerCase())) people.push(k); };
  addPerson(userName);
  for (const e of expenses) addPerson(e.added_by_name);
  for (const i of income) addPerson(i.added_by_name);
  const spentBy = people.map(p => ({
    name: p,
    amount: expenses.filter(e => (e.added_by_name ?? '').toLowerCase() === p.toLowerCase()).reduce((s, e) => s + Number(e.amount), 0),
  }));

  // categories to watch: the ones with a budget, most used first
  const catInfo = (name: string) => {
    const c = categories.find(x => x.name === name);
    return { emoji: c?.emoji ?? '📦', color: c?.color ?? CategoryColors[name] ?? '#64748B' };
  };
  const spentByCat: Record<string, number> = {};
  for (const e of expenses) spentByCat[e.category] = (spentByCat[e.category] ?? 0) + Number(e.amount);
  const watch = Object.keys({ ...budgetByCat, ...spentByCat })
    .map(name => ({ name, budget: budgetByCat[name] ?? 0, spent: spentByCat[name] ?? 0 }))
    .filter(r => r.spent > 0)
    .sort((a, b) => {
      const ra = a.budget > 0 ? a.spent / a.budget : 0, rb = b.budget > 0 ? b.spent / b.budget : 0;
      return rb - ra || b.spent - a.spent;
    })
    .slice(0, 4);

  const feed: FeedItem[] = [
    ...expenses.map(e => {
      const ci = catInfo(e.category);
      const note = (e.note ?? '').split(' | ')[0];
      return { kind: 'expense' as const, id: e.id, date: e.date, created_at: e.created_at, amount: Number(e.amount), who: e.added_by_name, title: note || e.category, sub: note ? e.category : '', emoji: ci.emoji, color: ci.color };
    }),
    ...income.map(i => ({ kind: 'income' as const, id: i.id, date: i.date, created_at: i.created_at, amount: Number(i.amount), who: i.added_by_name, title: i.name || 'Income', sub: i.source || '' })),
  ].sort((a, b) => (a.date === b.date ? (a.created_at < b.created_at ? 1 : -1) : a.date < b.date ? 1 : -1)).slice(0, 6);

  const firstName = userName ? displayName(userName) : '';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={Colors.primary} />}
      >
        {/* Greeting */}
        <View style={styles.topRow}>
          <AvatarStack names={people.length ? people : [userName || '?']} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.hello}>{greeting()}{firstName ? `, ${firstName}` : ''}</Text>
            <Text style={styles.household}>
              {people.length > 1 ? `${people.map(displayName).join(' & ')}'s budget` : 'Your household budget'}
            </Text>
          </View>
          <IconButton icon="log-out-outline" label="Sign out" onPress={() => setConfirmSignOut(true)} />
        </View>

        <MonthSwitcher label={formatMonthLabel(monthKey)} onPrev={() => changeMonth(-1)} onNext={() => changeMonth(1)} style={{ marginTop: 6, marginBottom: 16 }} />

        {loading ? <ActivityIndicator color={Colors.primary} style={{ marginTop: 60 }} /> : (
          <>
            {/* Hero */}
            <View style={styles.hero}>
              <Text style={styles.heroLabel}>{monthBudget > 0 ? (left >= 0 ? 'Left to spend' : 'Over budget by') : 'Spent this month'}</Text>
              <Text style={styles.heroValue}>{money(monthBudget > 0 ? Math.abs(left) : spent, { cents: false })}</Text>
              {monthBudget > 0 ? (
                <>
                  <View style={styles.heroTrack}>
                    <View style={[styles.heroFill, { width: `${pct * 100}%` as any, backgroundColor: left < 0 ? '#FFB4A6' : '#FFFFFF' }]} />
                  </View>
                  <Text style={styles.heroSub}>
                    {money(spent, { cents: false })} of {money(monthBudget, { cents: false })} spent
                    {isCurrentMonth && daysLeft > 0 ? ` · ${daysLeft} day${daysLeft === 1 ? '' : 's'} left` : ''}
                  </Text>
                </>
              ) : (
                <Text style={styles.heroSub}>Set budgets to see what's left each month.</Text>
              )}
              <View style={styles.heroStats}>
                <View style={styles.heroStat}>
                  <Text style={styles.heroStatLabel}>Income</Text>
                  <Text style={styles.heroStatValue}>{money(received, { cents: false })}</Text>
                </View>
                <View style={styles.heroDivider} />
                <View style={styles.heroStat}>
                  <Text style={styles.heroStatLabel}>Spent</Text>
                  <Text style={styles.heroStatValue}>{money(spent, { cents: false })}</Text>
                </View>
                <View style={styles.heroDivider} />
                <View style={styles.heroStat}>
                  <Text style={styles.heroStatLabel}>Net</Text>
                  <Text style={styles.heroStatValue}>{money(received - spent, { cents: false })}</Text>
                </View>
              </View>
            </View>

            {/* Quick actions */}
            <View style={styles.actions}>
              {([
                { icon: 'remove-circle', label: 'Expense', color: Colors.expense, go: () => router.push({ pathname: '/expenses', params: { add: '1' } }) },
                { icon: 'add-circle', label: 'Income', color: Colors.income, go: () => router.push({ pathname: '/income', params: { add: '1' } }) },
                { icon: 'pie-chart', label: 'Budgets', color: Colors.partnerA, go: () => router.push('/budgets') },
                { icon: 'document-text', label: 'Report', color: Colors.warning, go: () => router.push('/export') },
              ] as const).map(a => (
                <Pressable key={a.label} style={styles.action} onPress={a.go}>
                  <View style={[styles.actionIcon, { backgroundColor: a.color + '1A' }]}>
                    <Ionicons name={a.icon} size={24} color={a.color} />
                  </View>
                  <Text style={styles.actionLabel}>{a.label}</Text>
                </Pressable>
              ))}
            </View>

            {/* Who spent what */}
            {spent > 0 && spentBy.length > 0 ? (
              <View style={styles.section}>
                <Text style={ui.sectionTitle}>Who spent what</Text>
                <View style={[ui.card, styles.cardPad, { gap: 14 }]}>
                  {spentBy.map(p => (
                    <View key={p.name} style={styles.personRow}>
                      <Avatar name={p.name} size={36} />
                      <View style={{ flex: 1, gap: 6 }}>
                        <View style={styles.rowBetween}>
                          <Text style={styles.personName}>{displayName(p.name)}</Text>
                          <Text style={styles.personAmt}>{money(p.amount)}</Text>
                        </View>
                        <View style={styles.track}>
                          <View style={[styles.fill, { width: `${spent > 0 ? (p.amount / spent) * 100 : 0}%` as any, backgroundColor: Colors.primary }]} />
                        </View>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {/* Budgets to watch */}
            {watch.length > 0 ? (
              <View style={styles.section}>
                <View style={styles.rowBetween}>
                  <Text style={ui.sectionTitle}>Budgets to watch</Text>
                  <Pressable onPress={() => router.push('/budgets')} hitSlop={8}><Text style={styles.link}>See all</Text></Pressable>
                </View>
                <View style={[ui.card, styles.cardPad, { gap: 16 }]}>
                  {watch.map(w => {
                    const ci = catInfo(w.name);
                    const over = w.budget > 0 && w.spent > w.budget;
                    const ratio = w.budget > 0 ? Math.min(1, w.spent / w.budget) : 0;
                    return (
                      <View key={w.name} style={styles.personRow}>
                        <View style={[styles.catCircle, { backgroundColor: ci.color + '22' }]}><Text style={{ fontSize: 18 }}>{ci.emoji}</Text></View>
                        <View style={{ flex: 1, gap: 6 }}>
                          <View style={styles.rowBetween}>
                            <Text style={styles.personName} numberOfLines={1}>{w.name}</Text>
                            <Text style={[styles.watchAmt, over && { color: Colors.error }]}>
                              {money(w.spent, { cents: false })}{w.budget > 0 ? <Text style={styles.watchOf}> / {money(w.budget, { cents: false })}</Text> : null}
                            </Text>
                          </View>
                          {w.budget > 0 ? (
                            <View style={styles.track}>
                              <View style={[styles.fill, { width: `${ratio * 100}%` as any, backgroundColor: over ? Colors.error : ratio > 0.85 ? Colors.warning : ci.color }]} />
                            </View>
                          ) : <Text style={styles.noBudget}>No budget set</Text>}
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            ) : null}

            {/* Recent activity */}
            <View style={styles.section}>
              <View style={styles.rowBetween}>
                <Text style={ui.sectionTitle}>Recent activity</Text>
                <Pressable onPress={() => router.push('/expenses')} hitSlop={8}><Text style={styles.link}>See all</Text></Pressable>
              </View>
              <View style={[ui.card, { paddingVertical: 4 }]}>
                {feed.length === 0 ? (
                  <View style={{ alignItems: 'center', padding: 28, gap: 6 }}>
                    <Text style={{ fontSize: 34 }}>🌱</Text>
                    <Text style={styles.personName}>Nothing logged yet</Text>
                    <Text style={styles.noBudget}>Add an expense or income to get started.</Text>
                  </View>
                ) : feed.map((f, idx) => (
                  <View key={f.kind + f.id} style={[styles.feedRow, idx > 0 && styles.feedDivider]}>
                    <View>
                      {f.kind === 'expense' ? (
                        <View style={[styles.catCircle, { backgroundColor: f.color + '22' }]}><Text style={{ fontSize: 18 }}>{f.emoji}</Text></View>
                      ) : (
                        <View style={[styles.catCircle, { backgroundColor: Colors.income + '1F' }]}><Ionicons name="arrow-down" size={18} color={Colors.income} /></View>
                      )}
                      {f.who ? <View style={styles.feedAvatar}><Avatar name={f.who} size={18} ring /></View> : null}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.feedTitle} numberOfLines={1}>{f.title}</Text>
                      <Text style={styles.feedSub} numberOfLines={1}>{[dayLabel(f.date), f.sub, f.who ? displayName(f.who) : ''].filter(Boolean).join(' · ')}</Text>
                    </View>
                    <Text style={[styles.feedAmt, { color: f.kind === 'income' ? Colors.income : Colors.text }]}>
                      {f.kind === 'income' ? '+' : '−'}{money(f.amount)}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          </>
        )}
      </ScrollView>

      {confirmSignOut ? (
        <View style={styles.overlay}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>Sign out?</Text>
            <Text style={styles.dialogMsg}>You'll need your email and password to sign back in.</Text>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
              <Pressable style={[styles.dialogBtn, { backgroundColor: Colors.surfaceHigh }]} onPress={() => setConfirmSignOut(false)}>
                <Text style={[styles.dialogBtnText, { color: Colors.text }]}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.dialogBtn, { backgroundColor: Colors.primary }]} onPress={() => { setConfirmSignOut(false); supabase.auth.signOut(); }}>
                <Text style={styles.dialogBtnText}>Sign out</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  topRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 14, paddingBottom: 12 },
  hello: { fontSize: 20, fontWeight: '800', color: Colors.text, letterSpacing: -0.3 },
  household: { fontSize: 13.5, color: Colors.textSecondary, marginTop: 1 },
  hero: { marginHorizontal: 16, borderRadius: Radius.xl, backgroundColor: Colors.primary, padding: 22, ...Shadow.raised },
  heroLabel: { color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: '600' },
  heroValue: { color: '#fff', fontSize: 44, fontWeight: '800', letterSpacing: -1, marginTop: 2 },
  heroTrack: { height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.25)', marginTop: 14, overflow: 'hidden' },
  heroFill: { height: 8, borderRadius: 4 },
  heroSub: { color: 'rgba(255,255,255,0.9)', fontSize: 13, marginTop: 8 },
  heroStats: { flexDirection: 'row', marginTop: 18, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: Radius.md, paddingVertical: 12 },
  heroStat: { flex: 1, alignItems: 'center' },
  heroStatLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '600' },
  heroStatValue: { color: '#fff', fontSize: 16, fontWeight: '800', marginTop: 2 },
  heroDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.22)' },
  actions: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, marginTop: 20 },
  action: { alignItems: 'center', gap: 6, flex: 1 },
  actionIcon: { width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { fontSize: 12.5, fontWeight: '600', color: Colors.text },
  section: { paddingHorizontal: 16, marginTop: 24, gap: 10 },
  cardPad: { padding: 16 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 4 },
  link: { color: Colors.primary, fontWeight: '700', fontSize: 13.5 },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  personName: { fontSize: 15, fontWeight: '700', color: Colors.text, flexShrink: 1 },
  personAmt: { fontSize: 15, fontWeight: '700', color: Colors.text },
  track: { height: 6, borderRadius: 3, backgroundColor: Colors.surfaceHigh, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  catCircle: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  watchAmt: { fontSize: 14.5, fontWeight: '700', color: Colors.text },
  watchOf: { fontWeight: '500', color: Colors.textMuted },
  noBudget: { fontSize: 12.5, color: Colors.textMuted },
  feedRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  feedDivider: { borderTopWidth: 1, borderTopColor: Colors.border },
  feedAvatar: { position: 'absolute', right: -4, bottom: -4 },
  feedTitle: { fontSize: 15, fontWeight: '600', color: Colors.text },
  feedSub: { fontSize: 12.5, color: Colors.textSecondary, marginTop: 2 },
  feedAmt: { fontSize: 15, fontWeight: '700' },
  overlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(24,32,47,0.4)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  dialog: { width: '100%', maxWidth: 380, backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: 22 },
  dialogTitle: { fontSize: 18, fontWeight: '800', color: Colors.text },
  dialogMsg: { fontSize: 14, color: Colors.textSecondary, marginTop: 6, lineHeight: 20 },
  dialogBtn: { flex: 1, borderRadius: Radius.full, paddingVertical: 13, alignItems: 'center' },
  dialogBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
