import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { forwardRef } from 'react';
import { Platform, View, type ViewProps } from 'react-native';

/**
 * True only where the OS actually renders Apple's Liquid Glass (iOS 26+). The
 * native module's `isLiquidGlassAvailable()` already returns false off-iOS, but
 * we guard on the platform too and swallow any lookup error so a missing native
 * module (e.g. an old client) degrades to the solid fallback instead of throwing.
 */
export const liquidGlassAvailable = (() => {
  try {
    return Platform.OS === 'ios' && isLiquidGlassAvailable();
  } catch {
    return false;
  }
})();

type Props = ViewProps & {
  /** Solid translucent fill used everywhere Liquid Glass isn't available. */
  fallbackColor: string;
  /** Hint to the OS that the surface reacts to touch (subtle lift on press). */
  interactive?: boolean;
};

/**
 * A floating surface that uses native Liquid Glass on iOS 26+ and falls back to
 * the prior solid translucent fill everywhere else. Forwards its ref to a host
 * view, so it's safe to wrap with `Animated.createAnimatedComponent`.
 */
export const GlassSurface = forwardRef<View, Props>(function GlassSurface(
  { fallbackColor, interactive, style, ...rest },
  ref,
) {
  if (liquidGlassAvailable) {
    return (
      <GlassView
        ref={ref}
        glassEffectStyle="regular"
        isInteractive={interactive}
        style={style}
        {...rest}
      />
    );
  }
  return <View ref={ref} style={[{ backgroundColor: fallbackColor }, style]} {...rest} />;
});
