// The Budgets tab was originally styled after the Palace Church budget screen
// and reads its tokens from here. These names are kept so that screen keeps
// working, but they now point at the app-wide light theme in ./theme.
import { Colors, Radius, Shadow } from './theme';

export const PalaceColors = {
  primary: Colors.primary,
  primaryLight: Colors.primaryLight,
  primaryDark: Colors.primaryDark,

  background: Colors.background,
  surface: Colors.surface,
  surfaceElevated: Colors.surfaceHigh,
  surfaceBorder: Colors.border,

  textPrimary: Colors.text,
  textSecondary: Colors.textSecondary,
  textMuted: Colors.textMuted,
  textOnPrimary: '#FFFFFF',

  success: Colors.success,
  error: Colors.error,
  warning: Colors.warning,
};

export const PalaceTypography = {
  hero: { fontSize: 34, fontWeight: '700' as const, lineHeight: 42 },
  h1: { fontSize: 26, fontWeight: '700' as const, lineHeight: 34 },
  h2: { fontSize: 22, fontWeight: '600' as const, lineHeight: 30 },
  h3: { fontSize: 18, fontWeight: '600' as const, lineHeight: 26 },
  body: { fontSize: 16, fontWeight: '400' as const, lineHeight: 24 },
  bodyMedium: { fontSize: 16, fontWeight: '500' as const, lineHeight: 24 },
  caption: { fontSize: 13, fontWeight: '400' as const, lineHeight: 20 },
  label: { fontSize: 12, fontWeight: '600' as const, lineHeight: 18 },
  button: { fontSize: 16, fontWeight: '600' as const },
};

export const PalaceSpacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 };

export const PalaceRadius = { sm: Radius.sm, md: Radius.md, lg: Radius.lg, xl: Radius.xl, full: Radius.full };

export const PalaceShadow = { card: Shadow.card, glow: Shadow.raised };
