import * as Haptics from 'expo-haptics';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Platform, Pressable, StyleSheet, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Variant = 'primary' | 'secondary' | 'ghost';

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: Variant;
  icon?: SymbolViewProps['name'];
  disabled?: boolean;
  style?: ViewStyle;
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  disabled,
  style,
}: ButtonProps) {
  const theme = useTheme();

  const isPrimary = variant === 'primary';
  const isGhost = variant === 'ghost';

  const backgroundColor = isPrimary
    ? theme.brand
    : isGhost
      ? 'transparent'
      : theme.backgroundElement;
  const foreground = isPrimary ? theme.onBrand : isGhost ? theme.brand : theme.text;

  return (
    <Pressable
      onPress={() => {
        if (Platform.OS !== 'web') {
          Haptics.impactAsync(
            isPrimary
              ? Haptics.ImpactFeedbackStyle.Medium
              : Haptics.ImpactFeedbackStyle.Light,
          );
        }
        onPress();
      }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        styles.base,
        isGhost && styles.ghost,
        {
          backgroundColor,
          borderCurve: 'continuous',
          opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
          transform: [{ scale: pressed ? 0.97 : 1 }],
        },
        style,
      ]}>
      {icon ? <SymbolView name={icon} size={18} tintColor={foreground} weight="semibold" /> : null}
      <ThemedText style={[styles.label, { color: foreground }]}>{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    borderRadius: 16,
  },
  ghost: {
    paddingVertical: Spacing.two,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
  },
});
