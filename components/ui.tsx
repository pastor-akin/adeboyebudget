// Small shared building blocks for the light "household" look: partner
// avatars, a screen header, a pill-shaped month switcher, and helpers for
// grouping a feed by day.
import { ReactNode } from 'react';
import { View, Text, StyleSheet, Pressable, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Radius, Shadow, colorForName } from '../constants/theme';

export function initialsFor(name?: string): string {
  const parts = (name ?? '').trim().split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function displayName(name?: string): string {
  const n = (name ?? '').trim();
  if (!n) return 'Someone';
  const first = n.split(/[\s._-]+/)[0];
  return first.charAt(0).toUpperCase() + first.slice(1);
}

export function Avatar({ name, size = 32, ring = false }: { name?: string; size?: number; ring?: boolean }) {
  const bg = colorForName(name);
  return (
    <View
      style={[
        { width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' },
        ring && { borderWidth: 2, borderColor: Colors.surface },
      ]}
    >
      <Text style={{ color: '#fff', fontWeight: '700', fontSize: Math.round(size * 0.4) }}>{initialsFor(name)}</Text>
    </View>
  );
}

/** Two (or more) overlapping avatars — the household at a glance. */
export function AvatarStack({ names, size = 34 }: { names: string[]; size?: number }) {
  return (
    <View style={{ flexDirection: 'row' }}>
      {names.slice(0, 3).map((n, i) => (
        <View key={n + i} style={{ marginLeft: i === 0 ? 0 : -size * 0.32, zIndex: 10 - i }}>
          <Avatar name={n} size={size} ring />
        </View>
      ))}
    </View>
  );
}

export function ScreenHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <View style={ui.header}>
      <View style={{ flex: 1 }}>
        <Text style={ui.headerTitle}>{title}</Text>
        {subtitle ? <Text style={ui.headerSubtitle}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function MonthSwitcher({ label, onPrev, onNext, style }: { label: string; onPrev: () => void; onNext: () => void; style?: ViewStyle }) {
  return (
    <View style={[ui.monthPill, style]}>
      <Pressable onPress={onPrev} hitSlop={10} style={ui.monthArrow}>
        <Ionicons name="chevron-back" size={18} color={Colors.textSecondary} />
      </Pressable>
      <Text style={ui.monthText}>{label}</Text>
      <Pressable onPress={onNext} hitSlop={10} style={ui.monthArrow}>
        <Ionicons name="chevron-forward" size={18} color={Colors.textSecondary} />
      </Pressable>
    </View>
  );
}

export function IconButton({ icon, onPress, label }: { icon: keyof typeof Ionicons.glyphMap; onPress: () => void; label?: string }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} style={ui.iconBtn} accessibilityLabel={label}>
      <Ionicons name={icon} size={20} color={Colors.text} />
    </Pressable>
  );
}

/** "Today", "Yesterday", or e.g. "Mon, Oct 26" for a YYYY-MM-DD date. */
export function dayLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(today) - startOf(date)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Groups items (already sorted newest first) into day sections. */
export function groupByDay<T extends { date: string }>(items: T[]): { day: string; date: string; items: T[] }[] {
  const out: { day: string; date: string; items: T[] }[] = [];
  for (const it of items) {
    const last = out[out.length - 1];
    if (last && last.date === it.date) last.items.push(it);
    else out.push({ day: dayLabel(it.date), date: it.date, items: [it] });
  }
  return out;
}

export function money(n: number, opts: { cents?: boolean } = {}): string {
  const cents = opts.cents ?? true;
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
  return `${n < 0 ? '-' : ''}$${s}`;
}

export const ui = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 10 },
  headerTitle: { fontSize: 28, fontWeight: '800', color: Colors.text, letterSpacing: -0.5 },
  headerSubtitle: { fontSize: 14, color: Colors.textSecondary, marginTop: 2 },
  monthPill: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'center', backgroundColor: Colors.surface,
    borderRadius: Radius.full, paddingHorizontal: 6, paddingVertical: 4, ...Shadow.card,
  },
  monthArrow: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  monthText: { fontSize: 15, fontWeight: '700', color: Colors.text, minWidth: 130, textAlign: 'center' },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', ...Shadow.card },
  card: { backgroundColor: Colors.surface, borderRadius: Radius.lg, ...Shadow.card },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.6 },
  dayHeader: { fontSize: 13, fontWeight: '700', color: Colors.textSecondary, paddingHorizontal: 24, marginTop: 18, marginBottom: 8 },
  fab: {
    position: 'absolute', bottom: 24, right: 20, height: 56, borderRadius: 28, paddingHorizontal: 22,
    backgroundColor: Colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, ...Shadow.raised,
  },
  fabText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
