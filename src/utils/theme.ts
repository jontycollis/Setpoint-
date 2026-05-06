// App-wide theme constants with dark mode support
import React, { createContext, useContext } from 'react';

// Shared values that don't change between themes
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};

export const fontSize = {
  xs: 10,
  sm: 12,
  md: 14,
  lg: 16,
  xl: 18,
  xxl: 22,
  xxxl: 28,
  title: 32,
};

export const borderRadius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  full: 9999,
};

// ─── Color palettes ──────────────────────────────────────────────────────────

export interface ThemeColors {
  primary: string;
  primaryDark: string;
  primaryLight: string;
  accent: string;
  accentLight: string;

  background: string;
  surface: string;
  surfaceElevated: string;

  text: string;
  textSecondary: string;
  textLight: string;
  textOnPrimary: string;

  border: string;
  divider: string;

  success: string;
  warning: string;
  error: string;
  info: string;

  win: string;
  loss: string;
  draw: string;

  // Dark-screen specific (used by screens with dark headers/backgrounds)
  screenBg: string;
  cardBg: string;
  cardBorder: string;
  screenText: string;
  screenTextSecondary: string;
  screenTextLight: string;
}

export const lightColors: ThemeColors = {
  primary: '#1a73e8',
  primaryDark: '#1557b0',
  primaryLight: '#e8f0fe',
  accent: '#ff6b35',
  accentLight: '#fff3ee',

  background: '#f5f5f5',
  surface: '#ffffff',
  surfaceElevated: '#ffffff',

  text: '#1a1a1a',
  textSecondary: '#666666',
  textLight: '#999999',
  textOnPrimary: '#ffffff',

  border: '#e0e0e0',
  divider: '#eeeeee',

  success: '#34a853',
  warning: '#fbbc04',
  error: '#ea4335',
  info: '#4285f4',

  win: '#34a853',
  loss: '#ea4335',
  draw: '#fbbc04',

  // Screens that were previously hard-coded dark now follow theme
  screenBg: '#1a1a1a',
  cardBg: 'rgba(255,255,255,0.08)',
  cardBorder: 'rgba(255,255,255,0.12)',
  screenText: '#ffffff',
  screenTextSecondary: 'rgba(255,255,255,0.5)',
  screenTextLight: 'rgba(255,255,255,0.3)',
};

export const darkColors: ThemeColors = {
  primary: '#5b9bf5',
  primaryDark: '#1a73e8',
  primaryLight: 'rgba(91,155,245,0.15)',
  accent: '#ff8a5c',
  accentLight: 'rgba(255,138,92,0.15)',

  background: '#121212',
  surface: '#1e1e1e',
  surfaceElevated: '#2a2a2a',

  text: '#e8e8e8',
  textSecondary: '#a0a0a0',
  textLight: '#707070',
  textOnPrimary: '#ffffff',

  border: '#333333',
  divider: '#2a2a2a',

  success: '#4caf50',
  warning: '#ffc107',
  error: '#ef5350',
  info: '#5b9bf5',

  win: '#4caf50',
  loss: '#ef5350',
  draw: '#ffc107',

  screenBg: '#121212',
  cardBg: 'rgba(255,255,255,0.06)',
  cardBorder: 'rgba(255,255,255,0.10)',
  screenText: '#e8e8e8',
  screenTextSecondary: 'rgba(255,255,255,0.5)',
  screenTextLight: 'rgba(255,255,255,0.3)',
};

// ─── Default export (light) for backward compatibility ─────────────────────
// After the dark-mode refactor, every component reads `colors` via
// `useTheme()` so toggling actually re-renders styles. This static
// export is retained as a tripwire only — in __DEV__ we wrap it in a
// Proxy that logs a one-shot warning the first time anything reads
// from it, so we catch any new code that bypasses `useTheme()`. In
// production it falls through to the plain lightColors object so we
// never throw on a holdout.
let _staticColorsWarned = false;
// React, Fast Refresh, and the bundler probe every named export for these
// keys to figure out whether each export is a React component / module
// metadata. We must NOT treat that probing as a tripwire hit, otherwise
// the warning fires on every dev launch even when no real consumer exists.
const _silentTripwireKeys = new Set([
  '$$typeof',
  '__esModule',
  'default',
  'render',
  'displayName',
  'getDefaultProps',
  'propTypes',
  'contextTypes',
  'childContextTypes',
  'getDerivedStateFromProps',
  'prototype',
  'name',
  'length',
  'then',
  'toJSON',
  'asymmetricMatch',
]);
export const colors: ThemeColors = __DEV__
  ? (new Proxy(lightColors, {
      get(target, prop, receiver) {
        // Silent on Symbols (Symbol.toPrimitive, Symbol.toStringTag, etc.)
        // and on the well-known introspection keys above.
        if (typeof prop === 'symbol' || _silentTripwireKeys.has(prop as string)) {
          return Reflect.get(target, prop, receiver);
        }
        if (!_staticColorsWarned) {
          _staticColorsWarned = true;
          // eslint-disable-next-line no-console
          console.warn(
            '[theme] Static `colors` import detected. After the dark-mode ' +
              'refactor every component should consume `useTheme()` so the ' +
              'theme toggle actually re-renders styles. Convert the holdout ' +
              'to `const { colors } = useTheme();` plus ' +
              '`const styles = useMemo(() => makeStyles(colors), [colors]);`. ' +
              'First missed key: ' + String(prop)
          );
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as ThemeColors)
  : lightColors;

// ─── Theme context ───────────────────────────────────────────────────────────

export type ThemeMode = 'light' | 'dark';

export interface ThemeContextValue {
  mode: ThemeMode;
  colors: ThemeColors;
  toggle: () => void;
}

export const ThemeContext = createContext<ThemeContextValue>({
  mode: 'light',
  colors: lightColors,
  toggle: () => {},
});

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
