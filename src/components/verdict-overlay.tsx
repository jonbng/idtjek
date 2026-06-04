import { StatusBar } from 'expo-status-bar';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  ZoomIn,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Icons } from '@/constants/icons';
import { Spacing } from '@/constants/theme';
import { useStrings } from '@/i18n';

export type VerdictTone = 'success' | 'danger' | 'warning';

/**
 * Full-screen verdict shown after each scan, built for a bouncer glancing in a
 * dark, loud venue:
 *  - Bold SATURATED background (theme tone tokens are too pale in dark mode for
 *    white text, so these are fixed) with white foreground — legible at arm's
 *    length in either color scheme.
 *  - Meaning is carried by the icon SHAPE (✓ / ✕ / △) and the title text, so it
 *    survives red-green color blindness; color only reinforces.
 *  - `sticky` verdicts (anything but a clean pass) stay until tapped and capture
 *    the dismiss tap; a pass is pointer-transparent and auto-advances.
 */
const FLASH_BG: Record<VerdictTone, string> = {
  success: '#15803D',
  danger: '#B91C1C',
  warning: '#B45309',
};

export type VerdictOverlayProps = {
  tone: VerdictTone;
  icon: SymbolViewProps['name'];
  title: string;
  subtitle: string;
  sticky: boolean;
  /** This credential was already scanned earlier — flag it so the result isn't
   * mistaken for a fresh check. */
  repeat?: boolean;
  /** For a non-sticky (auto-advancing) pass: how long until it clears, in ms.
   * Drives the countdown bar and makes the verdict tappable to hold. */
  autoAdvanceMs?: number;
  /** Tap-to-hold on an auto-advancing pass: freeze it on screen. */
  onHold?: () => void;
  onDismiss: () => void;
};

export function VerdictOverlay({
  tone,
  icon,
  title,
  subtitle,
  sticky,
  repeat = false,
  autoAdvanceMs,
  onHold,
  onDismiss,
}: VerdictOverlayProps) {
  const reduceMotion = useReducedMotion();
  const s = useStrings();
  const bg = FLASH_BG[tone];
  // An auto-advancing pass we can freeze: show the countdown + "tap to hold".
  const holdable = !sticky && autoAdvanceMs != null && onHold != null;

  const body = (
    <>
      {/* The full-screen tone fill is dark-enough for white content in either
          scheme, so force a light status bar (overriding the root "auto") while
          the verdict is up; it reverts when this unmounts. */}
      <StatusBar style="light" animated />
      {repeat ? (
        <View style={styles.repeatChip}>
          <SymbolView name={Icons.repeat} size={15} tintColor="#FFFFFF" />
          <ThemedText style={styles.repeatChipText}>{s.repeatScan}</ThemedText>
        </View>
      ) : null}
      <Animated.View
        entering={reduceMotion ? undefined : ZoomIn.springify().damping(13)}
        style={styles.badge}>
        <SymbolView name={icon} size={96} tintColor="#FFFFFF" />
      </Animated.View>
      <ThemedText style={styles.title}>{title}</ThemedText>
      <ThemedText style={styles.subtitle}>{subtitle}</ThemedText>
      {sticky ? <ThemedText style={styles.hint}>{s.tapToContinue}</ThemedText> : null}
      {holdable && !reduceMotion ? (
        <CountdownBar durationMs={autoAdvanceMs} />
      ) : null}
      {holdable ? <ThemedText style={styles.holdHint}>{s.tapToHold}</ThemedText> : null}
    </>
  );

  if (sticky) {
    return (
      <Animated.View
        entering={reduceMotion ? undefined : FadeIn.duration(140)}
        style={[styles.fill, { backgroundColor: bg }]}
        accessibilityRole="alert"
        accessibilityLiveRegion="assertive">
        <Pressable
          onPress={onDismiss}
          style={[styles.fill, styles.center]}
          accessibilityRole="button"
          accessibilityLabel={s.dismissA11y}>
          {body}
        </Pressable>
      </Animated.View>
    );
  }

  // Auto-advancing pass: tappable to freeze on screen (tap converts it to a
  // sticky verdict in the parent), otherwise it clears itself.
  if (holdable) {
    return (
      <Animated.View
        entering={reduceMotion ? undefined : FadeIn.duration(140)}
        style={[styles.fill, { backgroundColor: bg }]}
        accessibilityRole="alert"
        accessibilityLiveRegion="assertive">
        <Pressable
          onPress={onHold}
          style={[styles.fill, styles.center]}
          accessibilityRole="button"
          accessibilityLabel={s.tapToHold}>
          {body}
        </Pressable>
      </Animated.View>
    );
  }

  return (
    <Animated.View
      pointerEvents="none"
      entering={reduceMotion ? undefined : FadeIn.duration(140)}
      style={[styles.fill, styles.center, { backgroundColor: bg }]}
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive">
      {body}
    </Animated.View>
  );
}

/** Slim bar that depletes over `durationMs`, mirroring the auto-advance timer. */
function CountdownBar({ durationMs }: { durationMs: number }) {
  const progress = useSharedValue(1);
  useEffect(() => {
    progress.value = withTiming(0, { duration: durationMs, easing: Easing.linear });
  }, [durationMs, progress]);
  const fillStyle = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));
  return (
    <View style={styles.countdownTrack}>
      <Animated.View style={[styles.countdownFill, fillStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
    gap: Spacing.two,
  },
  repeatChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.28)',
    marginBottom: Spacing.three,
  },
  repeatChipText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  badge: {
    width: 144,
    height: 144,
    borderRadius: 72,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.two,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 44,
    lineHeight: 48,
    fontWeight: '800',
    textAlign: 'center',
  },
  subtitle: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 16,
    lineHeight: 22,
    textAlign: 'center',
    maxWidth: 320,
  },
  hint: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 14,
    fontWeight: '600',
    marginTop: Spacing.five,
  },
  countdownTrack: {
    marginTop: Spacing.five,
    height: 4,
    width: 180,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.25)',
    overflow: 'hidden',
  },
  countdownFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: '#FFFFFF',
  },
  holdHint: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    fontWeight: '600',
    marginTop: Spacing.two,
  },
});
