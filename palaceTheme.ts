// Design tokens copied 1:1 from the Palace Church Boston app's budget screen
// (the-palace-app-v2/constants/theme.ts), scoped to this file only so the
// Budgets tab can look exactly like Palace's without re-theming the rest of
// adeboye-budget (Expenses, Charts, Export, Income all keep their own look).
export const PalaceColors = {
  primary: '#7C3AED',
  primaryLight: '#A78BFA',
  primaryDark: '#5B21B6',

  background: '#0D0F14',
  surface: '#161A23',
  surfaceElevated: '#1E2330',
  surfaceBorder: '#2A2F3D',

  textPrimary: '#F4F4F5',
  textSecondary: '#9AA3B5',
  textMuted: '#5C6478',
  textOnPrimary: '#0D0F14',

  success: '#4CAF80',
  error: '#E05A5A',
  warning: '#E8A94C',
};

export const PalaceTypography = {
  hero: { fontSize: 34, fontWeight: '700' as const, lineHeight: 42 },
  h1: { fontSize: 26, fontWeight: '700' as const, lineHeight: 34 },
  h2: { fontSize: 22, fontWeight: '600' as const, lineHeight: 30 },
  h3: { fontSize: 18, fontWeight: '600' as const, lineHeight: 26 },
  body: { fontSize: 16, fontWeight: '400' as const, lineHeight: 26 },
  bodyMedium: { fontSize: 16, fontWeight: '500' as const, lineHeight: 24 },
  caption: { fontSize: 13, fontWeight: '400' as const, lineHeight: 20 },
  label: { fontSize: 12, fontWeight: '600' as const, lineHeight: 18 },
  button: { fontSize: 16, fontWeight: '600' as const },
};

export const PalaceSpacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const PalaceRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 999,
};

export const PalaceShadow = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  glow: {
    shadowColor: '#7C3AED',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 8,
  },
};
