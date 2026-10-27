// Light, friendly "household" look — white cards on a soft gray canvas,
// one teal brand color, coral for money going out, green for money coming in,
// and a color per partner so it's always clear who logged what.
export const Colors = {
  primary: '#0E8C7D',
  primaryLight: '#E3F4F1',
  primaryDark: '#0A6B60',
  background: '#F5F6FA',
  surface: '#FFFFFF',
  surfaceHigh: '#EEF0F5',
  text: '#18202F',
  textSecondary: '#5F6878',
  textMuted: '#98A0AE',
  border: '#E5E8EF',
  error: '#E5484D',
  warning: '#F2A93B',
  success: '#17A35B',
  income: '#17A35B',
  expense: '#F26B4F',
  partnerA: '#5B7CFA',
  partnerB: '#E7609E',
};

export const Radius = { sm: 10, md: 14, lg: 20, xl: 28, full: 999 };

export const Shadow = {
  card: {
    shadowColor: '#1B2440',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 14,
    elevation: 2,
  },
  raised: {
    shadowColor: '#0E8C7D',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 18,
    elevation: 6,
  },
};

const AVATAR_COLORS = ['#5B7CFA', '#E7609E', '#F2A93B', '#17A35B', '#8B5CF6', '#0EA5E9'];

/** Stable color for a person's avatar, based on their name. */
export function colorForName(name?: string): string {
  const n = (name ?? '').trim().toLowerCase();
  if (!n) return Colors.textMuted;
  let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export const DEFAULT_CATEGORIES = [
  'Gas',
  'Electric',
  'Water',
  'Sewer',
  'Heating Oil',
  'Propane',
  'Food',
  'Snacks',
  'Coffee',
  'Eating Out',
  'Home Supplies',
  'Internet',
  'Car Insurance',
  'House Insurance',
  'Car Repairs',
  'Home Repairs',
  'Taxes',
];

export const CategoryEmoji: Record<string, string> = {
  'Gas':            '⛽',
  'Electric':       '⚡',
  'Water':          '💧',
  'Sewer':          '🚰',
  'Heating Oil':    '🛢️',
  'Propane':        '🔥',
  'Food':           '🛒',
  'Snacks':         '🍿',
  'Coffee':         '☕',
  'Eating Out':     '🍴',
  'Home Supplies':  '🏠',
  'Internet':       '🌐',
  'Car Insurance':  '🚗',
  'House Insurance':'🏡',
  'Car Repairs':    '🔧',
  'Home Repairs':   '🪛',
  'Taxes':          '🧾',
};

export const CategoryColors: Record<string, string> = {
  'Gas':            '#F97316',
  'Electric':       '#EAB308',
  'Water':          '#06B6D4',
  'Sewer':          '#64748B',
  'Heating Oil':    '#EA580C',
  'Propane':        '#DC2626',
  'Food':           '#22C55E',
  'Snacks':         '#F59E0B',
  'Coffee':         '#A16207',
  'Eating Out':     '#EC4899',
  'Home Supplies':  '#10B981',
  'Internet':       '#3B82F6',
  'Car Insurance':  '#6366F1',
  'House Insurance':'#8B5CF6',
  'Car Repairs':    '#F97316',
  'Home Repairs':   '#84CC16',
  'Taxes':          '#EF4444',
};

export const COLOR_OPTIONS = [
  '#F97316', '#EAB308', '#06B6D4', '#64748B', '#EA580C',
  '#DC2626', '#22C55E', '#F59E0B', '#A16207', '#EC4899',
  '#10B981', '#3B82F6', '#6366F1', '#8B5CF6', '#84CC16',
  '#EF4444', '#14B8A6', '#F43F5E', '#A855F7', '#0EA5E9',
];

export const EMOJI_OPTIONS = [
  '📦','💰','🎯','🏋️','✈️','🎓','💻','📱','🎮','🎵',
  '🐾','🌱','💊','🧴','👕','👟','🔑','📚','🛠️','🎁',
];
