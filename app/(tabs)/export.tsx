import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import { Ionicons } from '@expo/vector-icons';
import {
  getAllExpenses, getExpenses, toMonthKey, toYearKey, formatMonthLabel,
  getCategories, getYearlyBudgets, getExpensesForYear, getIncomeForYear, buildBudgetReportHtml,
} from '../../services/supabase';
import { useRouter } from 'expo-router';
import { Colors, Radius, Shadow } from '../../constants/theme';
import { ScreenHeader, IconButton } from '../../components/ui';

function toCsv(expenses: { date: string; category: string; amount: number; note?: string; added_by_name?: string }[]): string {
  const header = 'Date,Category,Amount,Note,AddedBy';
  const rows = expenses.map(e =>
    [e.date, e.category, e.amount.toFixed(2), `"${(e.note ?? '').replace(/"/g, '""')}"`, e.added_by_name ?? ''].join(',')
  );
  return [header, ...rows].join('\n');
}

export default function ExportScreen() {
  const router = useRouter();
  // Inline status message — RN's Alert.alert does nothing in a web browser.
  const [notice, setNotice] = useState<{ title: string; message: string } | null>(null);
  const Alert = { alert: (title: string, message?: string) => setNotice({ title, message: message ?? '' }) };
  const [loading, setLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const yearKey = toYearKey();

  async function exportPdf() {
    setPdfLoading(true);
    try {
      const [categories, budgets, expenses, income] = await Promise.all([
        getCategories(), getYearlyBudgets(yearKey), getExpensesForYear(yearKey), getIncomeForYear(yearKey),
      ]);
      if (expenses.length === 0 && income.length === 0) {
        Alert.alert('No data', `There's nothing logged for ${yearKey} yet.`);
        return;
      }
      const plannedByCategory: Record<string, number> = {};
      for (const b of budgets) plannedByCategory[b.category] = Number(b.amount);
      const spentByCategory: Record<string, number> = {};
      for (const e of expenses) spentByCategory[e.category] = (spentByCategory[e.category] ?? 0) + Number(e.amount);
      const html = buildBudgetReportHtml({
        yearKey, categories, plannedByCategory, spentByCategory, income, expenses,
        generatedAt: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
      });
      if (Platform.OS === 'web') {
        // On web this opens the browser print dialog ("Save as PDF").
        await Print.printToFileAsync({ html });
        return;
      }
      const { uri } = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `${yearKey} Budget Report`, UTI: 'com.adobe.pdf' });
      } else {
        Alert.alert('Saved', `PDF saved to: ${uri}`);
      }
    } catch (e: any) {
      Alert.alert('Export failed', e.message ?? 'Could not generate the PDF.');
    } finally {
      setPdfLoading(false);
    }
  }

  async function exportCsv(scope: 'month' | 'all') {
    setLoading(true);
    try {
      const data = scope === 'month' ? await getExpenses(toMonthKey()) : await getAllExpenses();
      if (data.length === 0) { Alert.alert('No data', 'There are no expenses to export.'); return; }
      const csv = toCsv(data);
      const filename = scope === 'month' ? `expenses-${toMonthKey()}.csv` : `expenses-all.csv`;
      if (Platform.OS === 'web') {
        // Browsers have no app file system — hand the CSV straight to the
        // browser as a download instead.
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return;
      }
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

  const Option = ({ icon, title, sub, onPress, busy, tint }: { icon: keyof typeof Ionicons.glyphMap; title: string; sub: string; onPress: () => void; busy?: boolean; tint: string }) => (
    <TouchableOpacity style={styles.option} onPress={onPress} disabled={loading || pdfLoading} activeOpacity={0.8}>
      <View style={[styles.optionIcon, { backgroundColor: tint + '1A' }]}>
        {busy ? <ActivityIndicator color={tint} /> : <Ionicons name={icon} size={24} color={tint} />}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.optionTitle}>{title}</Text>
        <Text style={styles.optionSub}>{sub}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={Colors.textMuted} />
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title="Reports"
        subtitle="Download or share your numbers"
        right={<IconButton icon="close" label="Close" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />}
      />
      <View style={styles.content}>
        <Text style={styles.section}>PDF</Text>
        <Option icon="document-text" tint={Colors.primary} busy={pdfLoading} onPress={exportPdf}
          title={`${yearKey} budget report`} sub="Yearly summary plus every expense, grouped by month" />

        <Text style={styles.section}>Spreadsheet (CSV)</Text>
        <Option icon="calendar" tint={Colors.partnerA} busy={loading} onPress={() => exportCsv('month')}
          title={`${formatMonthLabel(toMonthKey())} expenses`} sub="Opens in Excel, Google Sheets, or Numbers" />
        <Option icon="time" tint={Colors.warning} onPress={() => exportCsv('all')}
          title="All expenses, all time" sub="Every expense you've logged" />
        {notice ? (
          <View style={styles.notice}>
            <View style={{ flex: 1 }}>
              <Text style={styles.noticeTitle}>{notice.title}</Text>
              {notice.message ? <Text style={styles.noticeMsg}>{notice.message}</Text> : null}
            </View>
            <TouchableOpacity onPress={() => setNotice(null)} hitSlop={8}><Ionicons name="close" size={18} color={Colors.textSecondary} /></TouchableOpacity>
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { paddingHorizontal: 16, paddingTop: 8, gap: 10, maxWidth: 640, width: '100%', alignSelf: 'center' },
  section: { fontSize: 13, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 12, marginLeft: 4 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: 16, ...Shadow.card },
  optionIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  optionTitle: { fontSize: 16, fontWeight: '700', color: Colors.text },
  notice: { flexDirection: 'row', gap: 10, backgroundColor: Colors.primaryLight, borderRadius: Radius.md, padding: 14, marginTop: 8 },
  noticeTitle: { fontSize: 14, fontWeight: '700', color: Colors.primaryDark },
  noticeMsg: { fontSize: 13, color: Colors.primaryDark, marginTop: 2 },
  optionSub: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
});
