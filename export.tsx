import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Ionicons } from '@expo/vector-icons';
import { getAllExpenses, getExpenses, toMonthKey, formatMonthLabel } from '../../services/supabase';
import { Colors } from '../../constants/theme';

function toCsv(expenses: { date: string; category: string; amount: number; note?: string; added_by_name?: string }[]): string {
  const header = 'Date,Category,Amount,Note,AddedBy';
  const rows = expenses.map(e =>
    [e.date, e.category, e.amount.toFixed(2), `"${(e.note ?? '').replace(/"/g, '""')}"`, e.added_by_name ?? ''].join(',')
  );
  return [header, ...rows].join('\n');
}

export default function ExportScreen() {
  const [loading, setLoading] = useState(false);

  async function exportCsv(scope: 'month' | 'all') {
    setLoading(true);
    try {
      const data = scope === 'month' ? await getExpenses(toMonthKey()) : await getAllExpenses();
      if (data.length === 0) { Alert.alert('No data', 'There are no expenses to export.'); return; }
      const csv = toCsv(data);
      const filename = scope === 'month' ? `expenses-${toMonthKey()}.csv` : `expenses-all.csv`;
      const path = `${FileSystem.documentDirectory}${filename}`;
      await FileSystem.writeAsStringAsync(path, csv, { encoding: FileSystem.EncodingType.UTF8 });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(path, { mimeType: 'text/csv', dialogTitle: 'Export Expenses' });
      } else {
        Alert.alert('Saved', `File saved to: ${path}`);
      }
    } catch (e: any) {
      Alert.alert('Export failed', e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Export</Text>
      </View>
      <View style={styles.content}>
        <View style={styles.iconWrap}>
          <Ionicons name="document-text-outline" size={64} color={Colors.primary} />
        </View>
        <Text style={styles.desc}>
          Export your expenses as a CSV file you can open in Excel, Google Sheets, or Numbers.
        </Text>
        <TouchableOpacity style={styles.btn} onPress={() => exportCsv('month')} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : (
            <>
              <Ionicons name="calendar-outline" size={20} color="#fff" style={styles.btnIcon} />
              <Text style={styles.btnText}>Export This Month ({formatMonthLabel(toMonthKey())})</Text>
            </>
          )}
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, styles.btnSecondary]} onPress={() => exportCsv('all')} disabled={loading}>
          <Ionicons name="time-outline" size={20} color={Colors.primary} style={styles.btnIcon} />
          <Text style={[styles.btnText, { color: Colors.primary }]}>Export All Time</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { paddingHorizontal: 16, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: Colors.border },
  title: { fontSize: 22, fontWeight: '700', color: Colors.text },
  content: { flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center' },
  iconWrap: { width: 100, height: 100, borderRadius: 24, backgroundColor: Colors.surface, justifyContent: 'center', alignItems: 'center', marginBottom: 24 },
  desc: { fontSize: 15, color: Colors.textSecondary, textAlign: 'center', lineHeight: 22, marginBottom: 40, paddingHorizontal: 16 },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 24, marginBottom: 12, width: '100%' },
  btnSecondary: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: Colors.primary },
  btnIcon: { marginRight: 10 },
  btnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
