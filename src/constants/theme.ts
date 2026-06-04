/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#11181C',
    background: '#FFFFFF',
    backgroundElement: '#F4F5F7',
    backgroundSelected: '#E6E8EB',
    textSecondary: '#60646C',
    border: '#E6E8EB',

    brand: '#0A7CEF',
    onBrand: '#FFFFFF',

    success: '#15803D',
    successSurface: 'rgba(34, 197, 94, 0.12)',
    danger: '#DC2626',
    dangerSurface: 'rgba(239, 68, 68, 0.12)',
    warning: '#B45309',
    warningSurface: 'rgba(245, 158, 11, 0.14)',
  },
  dark: {
    text: '#ECEDEE',
    background: '#000000',
    backgroundElement: '#16181A',
    backgroundSelected: '#26292C',
    textSecondary: '#9BA1A6',
    border: '#26292C',

    brand: '#3C9FFE',
    onBrand: '#04121F',

    success: '#4ADE80',
    successSurface: 'rgba(74, 222, 128, 0.14)',
    danger: '#F87171',
    dangerSurface: 'rgba(248, 113, 113, 0.14)',
    warning: '#FBBF24',
    warningSurface: 'rgba(251, 191, 36, 0.14)',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
