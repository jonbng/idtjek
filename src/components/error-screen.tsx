import type { ErrorBoundaryProps } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Icons } from '@/constants/icons';
import { Spacing } from '@/constants/theme';
import { useStrings } from '@/i18n';
import { useTheme } from '@/hooks/use-theme';

/**
 * App-wide fallback shown when a screen throws during render. Wired up by
 * re-exporting it as `ErrorBoundary` from the root layout.
 */
export function ErrorScreen({ error, retry }: ErrorBoundaryProps) {
  const theme = useTheme();
  const s = useStrings();
  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safeArea}>
        <View style={[styles.icon, { backgroundColor: theme.dangerSurface }]}>
          <SymbolView name={Icons.warn} size={36} tintColor={theme.danger} />
        </View>
        <ThemedText type="subtitle" style={styles.center}>
          {s.errorTitle}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
          {s.errorBody}
        </ThemedText>

        <ScrollView
          style={[styles.detail, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
          contentContainerStyle={styles.detailContent}>
          <ThemedText type="code" themeColor="textSecondary" selectable>
            {error.message}
          </ThemedText>
        </ScrollView>

        <Button label={s.tryAgain} icon={Icons.retry} onPress={retry} style={styles.button} />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safeArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    padding: Spacing.four,
  },
  icon: {
    width: 76,
    height: 76,
    borderRadius: 24,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.two,
  },
  center: { textAlign: 'center' },
  detail: {
    alignSelf: 'stretch',
    maxHeight: 140,
    marginTop: Spacing.two,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderCurve: 'continuous',
    paddingHorizontal: Spacing.three,
  },
  detailContent: { paddingVertical: Spacing.three },
  button: { alignSelf: 'stretch', marginTop: Spacing.three },
});
