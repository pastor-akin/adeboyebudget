import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, Dimensions, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { PieChart, BarChart } from 'react-native-chart-kit';
import {
  Expense, AppCategory, getCategories, getExpenses, toMonthKey, formatMonthLabel,
} from '../../services/supabase';
import { Colors, CategoryColors } from '../../constants/theme';

const SCREEN_WIDTH = Dimensions.get('window').width;

export default function ChartsScreen() {
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
      Alert.alert('Error', e.message);
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
      legendFontSize: 13,
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
    color: (opacity = 1) => `rgba(16, 185, 129, ${opacity})`,
    labelColor: () => Colors.textSecondary,
    strokeWidth: 2,
    barPercentage: 0.7,
    decimalPlaces: 0,
  };

  const total = expenses.reduce((s, e) => s + e.amount, 0);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => changeMonth(-1)} style={styles.navBtn}>
          <Ionicons name="chevron-back" size={22} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.monthLabel}>{formatMonthLabel(monthKey)}</Text>
        <TouchableOpacity onPress={() => changeMonth(1)} style={styles.navBtn}>
          <Ionicons name="chevron-forward" size={22} color={Colors.text} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />
      ) : expenses.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>📊</Text>
          <Text style={styles.emptyText}>No data for this month</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          <Text style={styles.totalText}>Total: ${total.toFixed(2)}</Text>

          <Text style={styles.sectionTitle}>By Category</Text>
          <PieChart
            data={pieData}
            width={SCREEN_WIDTH}
            height={200}
            chartConfig={chartConfig}
            accessor="amount"
            backgroundColor="transparent"
            paddingLeft="16"
            absolute={false}
          />

          <Text style={styles.sectionTitle}>Daily Spending</Text>
          <BarChart
            data={{ labels: barLabels, datasets: [{ data: dailyTotals }] }}
            width={SCREEN_WIDTH - 16}
            height={200}
            chartConfig={chartConfig}
            style={{ marginLeft: 8, borderRadius: 12 }}
            showValuesOnTopOfBars={false}
            withInnerLines={false}
            yAxisLabel="$"
            yAxisSuffix=""
            fromZero
          />

          <Text style={styles.sectionTitle}>Breakdown</Text>
          <View style={styles.breakdown}>
            {pieData.sort((a, b) => b.amount - a.amount).map(d => (
              <View key={d.name} style={styles.breakdownRow}>
                <View style={[styles.dot, { backgroundColor: d.color }]} />
                <Text style={styles.breakdownCat}>{d.name}</Text>
                <Text style={styles.breakdownPct}>{((d.amount / total) * 100).toFixed(0)}%</Text>
                <Text style={styles.breakdownAmt}>${d.amount.toFixed(2)}</Text>
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
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  navBtn: { padding: 8 },
  monthLabel: { fontSize: 17, fontWeight: '700', color: Colors.text },
  totalText: { fontSize: 15, color: Colors.textSecondary, textAlign: 'center', marginTop: 16, marginBottom: 4 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: Colors.text, paddingHorizontal: 16, marginTop: 24, marginBottom: 12 },
  breakdown: { marginHorizontal: 16, backgroundColor: Colors.surface, borderRadius: 16, overflow: 'hidden' },
  breakdownRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
  breakdownCat: { flex: 1, fontSize: 15, color: Colors.text, fontWeight: '500' },
  breakdownPct: { fontSize: 14, color: Colors.textSecondary, marginRight: 12 },
  breakdownAmt: { fontSize: 15, fontWeight: '700', color: Colors.text },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 16, color: Colors.textSecondary },
});
