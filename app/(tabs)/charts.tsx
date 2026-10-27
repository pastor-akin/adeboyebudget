import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  Dimensions, ActivityIndicator, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { PieChart, BarChart } from 'react-native-chart-kit';
import {
  Expense, AppCategory, getCategories, getExpenses, toMonthKey, formatMonthLabel,
} from '../../services/supabase';
import { Colors, CategoryColors, Radius, Shadow } from '../../constants/theme';
import { ScreenHeader, MonthSwitcher, IconButton, money } from '../../components/ui';

const SCREEN_WIDTH = Dimensions.get('window').width;

export default function ChartsScreen() {
  const router = useRouter();
  const [monthKey, setMonthKey] = useState(toMonthKey());
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [categories, setCategories] = useState<AppCategory[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [data, cats] = await Promise.all([getExpenses(monthKey), getCategories()]);
      setExpenses(data);
      setCategories(cats);
    } catch (e: any) {
      // leave the previous data on screen
    } finally {
      setLoading(false);
    }
  }, [monthKey]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  function changeMonth(delta: number) {
    const [year, mon] = monthKey.split('-').map(Number);
    setMonthKey(toMonthKey(new Date(year, mon - 1 + delta, 1)));
  }

  const pieData = categories
    .map(cat => ({
      name: cat.name,
      amount: expenses.filter(e => e.category === cat.name).reduce((s, e) => s + e.amount, 0),
      color: cat.color ?? CategoryColors[cat.name] ?? '#64748B',
      legendFontColor: Colors.textSecondary,
      legendFontSize: 12,
      legendFontFamily: Platform.OS === 'web' ? 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' : undefined,
    }))
    .filter(d => d.amount > 0);

  const [year, mon] = monthKey.split('-').map(Number);
  const daysInMonth = new Date(year, mon, 0).getDate();
  const dailyTotals = Array.from({ length: daysInMonth }, (_, i) => {
    const day = String(i + 1).padStart(2, '0');
    const dateStr = `${monthKey}-${day}`;
    return expenses.filter(e => e.date === dateStr).reduce((s, e) => s + e.amount, 0);
  });

  const barLabels = Array.from({ length: daysInMonth }, (_, i) =>
    (i + 1) % 5 === 1 ? String(i + 1) : '',
  );

  const chartConfig = {
    backgroundGradientFrom: Colors.surface,
    backgroundGradientTo: Colors.surface,
    fillShadowGradientFrom: Colors.primary,
    fillShadowGradientTo: Colors.primary,
    fillShadowGradientOpacity: 0.9,
    fillShadowGradientToOpacity: 0.9,
    color: (opacity = 1) => `rgba(14, 140, 125, ${opacity})`,
    labelColor: () => Colors.textSecondary,
    strokeWidth: 2,
    barPercentage: 0.5,
    // chart-kit's SVG text defaults to a serif font in browsers
    propsForLabels: Platform.OS === 'web' ? { fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' } : {},
    decimalPlaces: 0,
  };

  const total = expenses.reduce((s, e) => s + e.amount, 0);

  const cardWidth = Math.min(SCREEN_WIDTH, 720) - 32;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title="Insights"
        subtitle="Where the money went"
        right={<IconButton icon="document-text-outline" label="Reports" onPress={() => router.push('/export')} />}
      />
      <MonthSwitcher label={formatMonthLabel(monthKey)} onPrev={() => changeMonth(-1)} onNext={() => changeMonth(1)} style={{ marginBottom: 14 }} />

      {loading ? (
        <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />
      ) : expenses.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>📊</Text>
          <Text style={styles.emptyText}>No spending to chart this month</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 16 }}>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Total spent</Text>
            <Text style={styles.total}>{money(total)}</Text>
            <PieChart
              data={pieData}
              width={cardWidth - 8}
              height={190}
              chartConfig={chartConfig}
              accessor="amount"
              backgroundColor="transparent"
              paddingLeft="0"
              absolute={false}
            />
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Daily spending</Text>
            <BarChart
              data={{ labels: barLabels, datasets: [{ data: dailyTotals }] }}
              width={cardWidth - 16}
              height={190}
              chartConfig={chartConfig}
              style={{ marginLeft: -8 }}
              showValuesOnTopOfBars={false}
              withInnerLines={false}
              yAxisLabel="$"
              yAxisSuffix=""
              fromZero
            />
          </View>

          <View style={[styles.card, { paddingHorizontal: 0, paddingBottom: 4 }]}>
            <Text style={[styles.cardTitle, { paddingHorizontal: 18 }]}>By category</Text>
            {pieData.sort((a, b) => b.amount - a.amount).map((d, idx) => (
              <View key={d.name} style={[styles.breakdownRow, idx > 0 && styles.breakdownDivider]}>
                <View style={[styles.dot, { backgroundColor: d.color }]} />
                <View style={{ flex: 1, gap: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={styles.breakdownCat}>{d.name}</Text>
                    <Text style={styles.breakdownPct}>{((d.amount / total) * 100).toFixed(0)}%</Text>
                    <Text style={styles.breakdownAmt}>{money(d.amount)}</Text>
                  </View>
                  <View style={styles.track}><View style={[styles.fill, { width: `${(d.amount / total) * 100}%` as any, backgroundColor: d.color }]} /></View>
                </View>
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  card: { backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: 18, ...Shadow.card, overflow: 'hidden' },
  cardLabel: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  total: { fontSize: 30, fontWeight: '800', color: Colors.text, letterSpacing: -0.6, marginTop: 2, marginBottom: 4 },
  cardTitle: { fontSize: 16, fontWeight: '800', color: Colors.text, marginBottom: 12 },
  breakdownRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 12 },
  breakdownDivider: { borderTopWidth: 1, borderTopColor: Colors.border },
  dot: { width: 12, height: 12, borderRadius: 6, marginRight: 12 },
  breakdownCat: { flex: 1, fontSize: 15, color: Colors.text, fontWeight: '600' },
  breakdownPct: { fontSize: 13, color: Colors.textMuted, marginRight: 12, fontWeight: '600' },
  breakdownAmt: { fontSize: 15, fontWeight: '700', color: Colors.text },
  track: { height: 5, borderRadius: 3, backgroundColor: Colors.surfaceHigh, overflow: 'hidden' },
  fill: { height: 5, borderRadius: 3 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 16, color: Colors.textSecondary, fontWeight: '600' },
});
