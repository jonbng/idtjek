import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '@/hooks/use-theme';

const BRACKET = 34;
const THICKNESS = 3;

/**
 * Camera viewfinder overlay: four animated corner brackets framing the live feed,
 * plus a sweeping scan line while the scanner is actively reading. Purely decorative
 * and pointer-transparent so it never intercepts camera taps.
 */
export function ScannerFrame({ active }: { active: boolean }) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const sweep = useSharedValue(0);
  const glow = useSharedValue(0.6);

  useEffect(() => {
    // Respect the OS "Reduce Motion" setting: hold the brackets bright and steady
    // and skip the sweeping line entirely rather than animating.
    if (reduceMotion) {
      cancelAnimation(sweep);
      cancelAnimation(glow);
      glow.value = withTiming(active ? 1 : 0.7, { duration: 200 });
      return;
    }
    if (active) {
      sweep.value = 0;
      sweep.value = withRepeat(
        withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.cubic) }),
        -1,
        true,
      );
      glow.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }),
          withTiming(0.55, { duration: 900, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
        true,
      );
    } else {
      cancelAnimation(sweep);
      cancelAnimation(glow);
      glow.value = withTiming(0.7, { duration: 200 });
    }
    return () => {
      cancelAnimation(sweep);
      cancelAnimation(glow);
    };
  }, [active, reduceMotion, sweep, glow]);

  const lineStyle = useAnimatedStyle(() => ({
    top: `${8 + sweep.value * 84}%`,
    opacity: active && !reduceMotion ? 0.9 : 0,
  }));

  const cornerStyle = useAnimatedStyle(() => ({ opacity: glow.value }));

  const color = theme.brand;
  const corners = [
    { top: 0, left: 0, borderTopWidth: THICKNESS, borderLeftWidth: THICKNESS, borderTopLeftRadius: 14 },
    { top: 0, right: 0, borderTopWidth: THICKNESS, borderRightWidth: THICKNESS, borderTopRightRadius: 14 },
    { bottom: 0, left: 0, borderBottomWidth: THICKNESS, borderLeftWidth: THICKNESS, borderBottomLeftRadius: 14 },
    { bottom: 0, right: 0, borderBottomWidth: THICKNESS, borderRightWidth: THICKNESS, borderBottomRightRadius: 14 },
  ] as const;

  return (
    <View pointerEvents="none" style={styles.fill}>
      {corners.map((c, i) => (
        <Animated.View
          key={i}
          style={[styles.corner, c, { borderColor: color }, cornerStyle]}
        />
      ))}
      <Animated.View
        style={[styles.scanLine, { backgroundColor: color, shadowColor: color }, lineStyle]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, margin: 18 },
  corner: {
    position: 'absolute',
    width: BRACKET,
    height: BRACKET,
  },
  scanLine: {
    position: 'absolute',
    left: '6%',
    right: '6%',
    height: 2,
    borderRadius: 2,
    shadowOpacity: 0.9,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
});
