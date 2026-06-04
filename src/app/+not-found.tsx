import { Link } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Icons } from '@/constants/icons';
import { Spacing } from '@/constants/theme';
import { useStrings } from '@/i18n';
import { useTheme } from '@/hooks/use-theme';

export default function NotFound() {
  const theme = useTheme();
  const s = useStrings();
  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safeArea}>
        <View style={[styles.icon, { backgroundColor: theme.backgroundElement }]}>
          <SymbolView name={Icons.warn} size={40} tintColor={theme.textSecondary} />
        </View>
        <ThemedText type="subtitle" style={styles.center}>
          {s.notFoundTitle}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
          {s.notFoundBody}
        </ThemedText>
        <Link href="/" style={[styles.link, { color: theme.brand }]}>
          {s.backToScanner}
        </Link>
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
    width: 80,
    height: 80,
    borderRadius: 24,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.two,
  },
  center: { textAlign: 'center' },
  link: { fontSize: 16, fontWeight: '600', marginTop: Spacing.two },
});
