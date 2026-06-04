import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { GlassSurface } from '@/components/glass-surface';
import { ScannerFrame } from '@/components/scanner-frame';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { VerdictOverlay } from '@/components/verdict-overlay';
import { Icons } from '@/constants/icons';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useStrings, type Strings } from '@/i18n';
import { useTheme } from '@/hooks/use-theme';
import {
  ageBracket,
  buildTrustList,
  decodeQRPayload,
  defaultTrustList,
  hasAgeProof,
  MultipartAssembler,
  PROD_ISSUER_CERT_PEM,
  validateAssembled,
  type ValidationOutcome,
} from '@/altid';

// Animated variant so the progress pill keeps its fade-in entrance while gaining
// the native Liquid Glass surface on iOS 26+.
const AnimatedGlassSurface = Animated.createAnimatedComponent(GlassSurface);

/** Age the door enforces. The over-21 option flags the 18–20 span amber. */
type RequiredAge = 18 | 21;

type Tone = 'success' | 'danger' | 'warning';

type Presentation = {
  tone: Tone;
  icon: SymbolViewProps['name'];
  title: string;
  subtitle: string;
};

type ScanRecord = {
  id: number;
  outcome: ValidationOutcome;
  requiredAge: RequiredAge; // door policy at scan time (colours the 18–20 span)
  at: number; // epoch ms
  repeat: boolean; // a re-scan of a credential already checked this session
};

/** How long a clean PASS stays on screen before auto-advancing to the next holder. */
const PASS_FLASH_MS = 1100;
const MAX_HISTORY = 100;

/**
 * The holder's QR loops, so the same presentation re-assembles many times a
 * second; we keep showing one verdict per credential by de-duping on its
 * `mnonce`. But a *deliberate* re-scan — the QR left the camera and came back —
 * should re-show the result, clearly marked as a repeat. We tell the two apart
 * by the gap since we last saw that mnonce: a continuously-present QR keeps the
 * gap small (refreshed every completed loop, even across a pass auto-advance),
 * while a re-scan only happens after the QR has been absent for longer than
 * this. Must comfortably exceed PASS_FLASH_MS so holding a passing QR steady
 * across the flash never trips a false repeat.
 */
const REPEAT_GAP_MS = 2500;

/**
 * If a multipart scan stalls — the camera moved away mid-scan, the holder's
 * animation froze, or the user pointed at an unrelated QR — drop the collected
 * parts after this long and return the pill to "point at QR" rather than
 * freezing on e.g. "reading 1/7". Re-armed every time a new part advances
 * assembly, so a healthy (continuously looping) scan never trips it; only a
 * genuine stall, where no new part arrives for this window, does.
 */
const ASSEMBLY_STALE_MS = 2500;

/**
 * Whether a verdict should block the line until acknowledged. Only a clean
 * (green) pass auto-advances; an amber 18–20 result under a 21+ policy, a denial,
 * or an unverifiable scan all stay up and pause scanning so the bouncer
 * consciously handles it and the next patron isn't scanned over it.
 */
function isSticky(presentation: Presentation): boolean {
  return presentation.tone !== 'success';
}

/**
 * Map a verified/rejected outcome to a verdict, given the door's required age.
 * Verdicts collapse to Under 18 / Over 18 / Over 21; the `requiredAge` toggle
 * only changes whether the 18–20 span reads as a green pass or an amber flag
 * ("over 18, but you wanted 21+"). Over 21 is always green; Under 18 always red.
 */
function presentOutcome(
  outcome: ValidationOutcome,
  requiredAge: RequiredAge,
  s: Strings,
): Presentation {
  if (outcome.kind === 'rejected') {
    // Couldn't verify — not a statement about the person's age. Tailor the
    // next-action to *why* it failed instead of a one-size "check a physical ID".
    switch (outcome.code) {
      case 'expired':
        return { tone: 'warning', icon: Icons.clock, title: s.expiredTitle, subtitle: s.expiredSubtitle };
      case 'untrusted':
        return { tone: 'warning', icon: Icons.warn, title: s.untrustedTitle, subtitle: s.untrustedSubtitle };
      default:
        return { tone: 'warning', icon: Icons.warn, title: s.cantVerifyTitle, subtitle: s.cantVerifySubtitle };
    }
  }
  if (!hasAgeProof(outcome.ageOver)) {
    return { tone: 'warning', icon: Icons.warn, title: s.noProofTitle, subtitle: s.noProofSubtitle };
  }
  switch (ageBracket(outcome.ageOver)) {
    case 'over21':
      return { tone: 'success', icon: Icons.sealOk, title: s.overTitle(21), subtitle: s.overSubtitle };
    case 'over18': {
      const flagged = requiredAge >= 21; // 18+ proven, but the door wants 21+
      return {
        tone: flagged ? 'warning' : 'success',
        icon: Icons.sealOk,
        title: s.overTitle(18),
        subtitle: flagged ? s.over18CautionSubtitle : s.overSubtitle,
      };
    }
    case 'under18':
      return { tone: 'danger', icon: Icons.sealBad, title: s.underTitle, subtitle: s.underSubtitle };
  }
}

/** Compact summary for a history row. */
function summarize(
  outcome: ValidationOutcome,
  requiredAge: RequiredAge,
  s: Strings,
): { tone: Tone; label: string; icon: SymbolViewProps['name'] } {
  if (outcome.kind === 'rejected') {
    switch (outcome.code) {
      case 'expired':
        return { tone: 'warning', label: s.labelExpired, icon: Icons.clock };
      case 'untrusted':
        return { tone: 'warning', label: s.labelUntrusted, icon: Icons.warn };
      default:
        return { tone: 'warning', label: s.labelCantVerify, icon: Icons.warn };
    }
  }
  if (!hasAgeProof(outcome.ageOver)) {
    return { tone: 'warning', label: s.labelNoProof, icon: Icons.warn };
  }
  switch (ageBracket(outcome.ageOver)) {
    case 'over21':
      return { tone: 'success', label: s.labelOver21, icon: Icons.checkCircle };
    case 'over18':
      return {
        tone: requiredAge >= 21 ? 'warning' : 'success',
        label: s.labelOver18,
        icon: Icons.checkCircle,
      };
    case 'under18':
      return { tone: 'danger', label: s.labelUnder18, icon: Icons.xCircle };
  }
}

/**
 * Distinct tactile feedback so a bouncer can tell the verdict without looking,
 * keyed off the verdict tone:
 *  - success (green pass) → Success  (light double-tap → "good, next")
 *  - danger  (under 18)   → Error + a heavy follow-up thud → "deny"
 *  - warning (flag / can't verify) → Warning (medium → "stop, check / ask")
 */
function playResultHaptic(tone: Tone) {
  if (Platform.OS === 'web') return;
  if (tone === 'success') {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    return;
  }
  if (tone === 'danger') {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), 150);
    return;
  }
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}
function formatClock(at: number): string {
  const d = new Date(at);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}
function formatRelative(at: number, now: number, t: Strings): string {
  const secs = Math.max(0, Math.round((now - at) / 1000));
  if (secs < 5) return t.justNow;
  if (secs < 60) return t.secondsAgo(secs);
  const m = Math.floor(secs / 60);
  if (m < 60) return t.minutesAgo(m);
  const h = Math.floor(m / 60);
  return t.hoursAgo(h);
}

export default function VerifyScreen() {
  const theme = useTheme();
  const s = useStrings();
  const [permission, requestPermission] = useCameraPermissions();
  const [verdict, setVerdict] = useState<{
    presentation: Presentation;
    sticky: boolean;
    repeat: boolean;
    key: number;
  } | null>(null);
  const [history, setHistory] = useState<ScanRecord[]>([]);
  const [progress, setProgress] = useState<{ have: number; total: number | null }>({
    have: 0,
    total: null,
  });
  const [torch, setTorch] = useState(false);
  const [requiredAge, setRequiredAge] = useState<RequiredAge>(18);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const assembler = useRef(new MultipartAssembler());
  // mnonce → epoch ms we last saw that presentation complete. The AltID QR is a
  // looping multipart animation, so the same presentation re-assembles many
  // times a second; the timestamp lets us de-dupe the continuous loop while
  // still recognising a deliberate re-scan after a gap (see REPEAT_GAP_MS).
  const processed = useRef(new Map<string, number>());
  const verdictTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Fires when a partial scan stops advancing — see ASSEMBLY_STALE_MS. Armed on
  // the part that advances assembly, cancelled when the payload completes.
  const assemblyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Collected-part count at the previous frame, so we can tell a part that
  // *advanced* assembly from the constant re-reads of parts already collected
  // (the holder's QR loops, so every part is seen many times). Only an advance
  // re-arms the staleness timer; that way a scan genuinely stuck short of a part
  // still times out instead of being kept alive by the re-reads.
  const prevCollected = useRef(0);
  // True while a verdict is on screen. Read inside the (continuous) scan callback
  // to drop frames until the verdict clears — gives passes a natural lockout and
  // prevents the next patron being scanned over an unacknowledged result.
  const busy = useRef(false);
  // mnonce of the verdict currently on screen (null for a malformed payload).
  // While a verdict shows, frames are dropped, so we can't see whether the QR is
  // still present; on dismiss we restart this credential's gap clock so a QR
  // that never left doesn't read as a fresh re-scan the instant scanning resumes.
  const shownMnonce = useRef<string | null>(null);
  const idCounter = useRef(0);
  // Epoch ms a payload last completed (shown or silently de-duped). Lets the
  // "lock-on" haptic fire only when the line has been quiet — reusing REPEAT_GAP_MS
  // so a held, continuously-looping QR (which re-assembles every loop) doesn't buzz
  // on each pass; only a genuinely new approach ticks.
  const lastCompleteAt = useRef(0);
  // Trust the AltID issuer(s). TEST credentials (and the bundled sample) are only
  // accepted in development builds; production builds trust the live issuer alone.
  const trustList = useMemo(
    () =>
      __DEV__
        ? defaultTrustList()
        : buildTrustList([
            { label: 'AltID DKTB Credential Issuer (PROD)', pem: PROD_ISSUER_CERT_PEM },
          ]),
    [],
  );

  const cameraAvailable = Platform.OS !== 'web';
  const liveCamera = cameraAvailable && !!permission?.granted;

  // Refresh relative timestamps in the history list.
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  // Clear any pending timers on unmount.
  useEffect(() => () => {
    if (verdictTimer.current) clearTimeout(verdictTimer.current);
    if (assemblyTimer.current) clearTimeout(assemblyTimer.current);
  }, []);

  // Keep the screen awake while the camera is live — this is a continuous
  // door/till scanner, so it shouldn't dim or sleep between holders.
  useEffect(() => {
    if (!liveCamera) return;
    // These reject when the Android activity is already gone (e.g. the screen
    // unmounts as the app backgrounds). Keeping a dead activity awake is moot,
    // so swallow the rejection instead of leaking an unhandled promise.
    activateKeepAwakeAsync('verify').catch(() => {});
    return () => {
      deactivateKeepAwake('verify').catch(() => {});
    };
  }, [liveCamera]);

  const runValidation = useCallback(
    (Q: Uint8Array, opts: Parameters<typeof validateAssembled>[1]): ValidationOutcome =>
      validateAssembled(Q, {
        ...opts,
        // Step-by-step diagnostics go to the console in development builds only.
        onDebug: __DEV__ ? (line) => console.log('[altid]', line) : undefined,
      }),
    [],
  );

  // Discard any half-collected multipart payload and return the pill to its
  // idle "point at QR" state. Called by the staleness timer and again whenever a
  // payload completes, so a partial scan never lingers on screen.
  const resetAssembly = useCallback(() => {
    if (assemblyTimer.current) {
      clearTimeout(assemblyTimer.current);
      assemblyTimer.current = null;
    }
    prevCollected.current = 0;
    assembler.current.reset();
    setProgress((prev) => (prev.have === 0 && prev.total === null ? prev : { have: 0, total: null }));
  }, []);

  // Clear the current verdict and resume scanning. Used both by the pass
  // auto-advance timer and the tap on a sticky verdict.
  const dismiss = useCallback(() => {
    if (verdictTimer.current) {
      clearTimeout(verdictTimer.current);
      verdictTimer.current = null;
    }
    // Restart the just-shown credential's gap clock from now, so if its QR is
    // still in front of the camera the resumed scan treats it as the same
    // presentation (silent) rather than an immediate re-scan.
    if (shownMnonce.current) processed.current.set(shownMnonce.current, Date.now());
    busy.current = false;
    setVerdict(null);
  }, []);

  // Tap on an auto-advancing pass: freeze it on screen by promoting it to a
  // sticky verdict (cancels the auto-advance; next tap dismisses normally).
  const holdVerdict = useCallback(() => {
    if (verdictTimer.current) {
      clearTimeout(verdictTimer.current);
      verdictTimer.current = null;
    }
    setVerdict((v) => (v && !v.sticky ? { ...v, sticky: true } : v));
    if (Platform.OS !== 'web') Haptics.selectionAsync();
  }, []);

  const record = useCallback(
    (outcome: ValidationOutcome, repeat = false) => {
      const at = Date.now();
      const id = ++idCounter.current;
      setHistory((h) => [{ id, outcome, requiredAge, at, repeat }, ...h].slice(0, MAX_HISTORY));

      const presentation = presentOutcome(outcome, requiredAge, s);
      // A repeat is always held until acknowledged, even for a clean pass: a
      // re-scan is a deliberate act, so make the bouncer consciously clear it
      // rather than letting the duplicate flash by and auto-advance.
      const sticky = repeat || isSticky(presentation);
      busy.current = true;
      setVerdict({ presentation, sticky, repeat, key: id });
      if (verdictTimer.current) clearTimeout(verdictTimer.current);
      // A clean first-time pass auto-advances; anything else stays until tapped.
      verdictTimer.current = sticky ? null : setTimeout(dismiss, PASS_FLASH_MS);

      // A light tick ahead of the result haptic distinguishes a repeat by feel.
      if (repeat && Platform.OS !== 'web') {
        Haptics.selectionAsync();
      }
      playResultHaptic(presentation.tone);
    },
    [dismiss, requiredAge, s],
  );

  // Continuous scanning: every frame is fed to the assembler; when a full
  // presentation arrives we validate, show the verdict, and reset — ready for
  // the next holder without any button press.
  const handleFrame = useCallback(
    (data: string) => {
      if (busy.current) return; // a verdict is showing — don't scan over it

      const Q = assembler.current.addFrame(data);
      const have = assembler.current.collected;
      const total = assembler.current.total;
      const prevHave = prevCollected.current;
      const advanced = have !== prevHave;
      prevCollected.current = have;
      setProgress((prev) => (prev.have === have && prev.total === total ? prev : { have, total }));

      // Lock-on: a single light tick the moment a fresh multipart scan catches its
      // first part, so the bouncer feels the read begin. Gated on a quiet line (no
      // recent completion) so a held QR's per-loop re-assembly stays silent.
      if (
        prevHave === 0 &&
        have > 0 &&
        total != null &&
        total > 1 &&
        Platform.OS !== 'web' &&
        Date.now() - lastCompleteAt.current > REPEAT_GAP_MS
      ) {
        Haptics.selectionAsync();
      }

      if (!Q) {
        // Mid-assembly. Re-arm the staleness timer only when this frame actually
        // added a part: the looping QR re-delivers parts we already hold many
        // times a second, and those must NOT keep a stuck scan (e.g. a torn QR
        // missing its last part) alive. A scan that has stopped advancing —
        // whether the camera moved away or the holder is stuck short — clears
        // itself after ASSEMBLY_STALE_MS. (A switch to a different AltID QR is
        // handled inside the assembler, which resets on a new txn; switching to
        // an unrelated QR leaves the partial untouched and this timer clears it.)
        if (advanced && total != null && have > 0 && have < total) {
          if (assemblyTimer.current) clearTimeout(assemblyTimer.current);
          assemblyTimer.current = setTimeout(resetAssembly, ASSEMBLY_STALE_MS);
        }
        return;
      }

      // Complete — tear down the partial state (timer, parts, progress pill)
      // before validating the captured payload bytes.
      resetAssembly();

      // Identify the presentation by its mnonce (unique per generated QR) to
      // tell apart the constant re-reads of one held QR from a deliberate
      // re-scan. (Cross-session replay defence rests on the short ≤180s validity
      // window in the presentation, checked during validation below.)
      let mnonce: string | null = null;
      try {
        mnonce = decodeQRPayload(Q).mnonce;
      } catch {
        // Malformed payload — fall through so the validator emits the rejection.
      }

      const now = Date.now();
      // Mark the line busy for the lock-on gate, even for a silently de-duped loop.
      lastCompleteAt.current = now;
      let repeat = false;
      if (mnonce) {
        const lastSeen = processed.current.get(mnonce);
        processed.current.set(mnonce, now);
        if (lastSeen !== undefined) {
          // Seen before. A small gap means the same QR is still looping in front
          // of the camera — stay silent (its verdict was just shown). A larger
          // gap means it left and came back: a real re-scan worth re-showing.
          if (now - lastSeen < REPEAT_GAP_MS) return;
          repeat = true;
        }
      }

      // Re-validate every time (don't cache the prior outcome): a credential
      // re-scanned minutes later may now be expired, so the verdict can legitimately
      // differ from the first read.
      shownMnonce.current = mnonce;
      record(runValidation(Q, { trustList }), repeat);
    },
    [trustList, record, runValidation, resetAssembly],
  );

  const clearHistory = useCallback(() => {
    setHistory([]);
    processed.current.clear();
  }, []);

  // "Over 18" tally for the summary line: anyone whose 18+ status was proven
  // (over-18 or over-21). Independent of the current policy toggle.
  const overCount = history.filter(
    (r) => r.outcome.kind === 'verified' && ageBracket(r.outcome.ageOver) !== 'under18',
  ).length;
  const assembling = progress.total != null && progress.have < progress.total;

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled">
          <Animated.View entering={FadeIn.duration(400)} style={styles.header}>
            <View style={styles.brandRow}>
              <SymbolView name={Icons.shield} size={20} tintColor={theme.brand} />
              <ThemedText style={[styles.brand, { color: theme.brand }]}>ALTID</ThemedText>
            </View>
            <ThemedText type="title" style={styles.heading}>
              {s.proofOfAge}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {s.tagline}
            </ThemedText>
          </Animated.View>

          <AgeThresholdToggle value={requiredAge} onChange={setRequiredAge} />

          <View
            style={[
              styles.viewfinder,
              { backgroundColor: theme.backgroundElement, borderColor: theme.border },
            ]}>
            {liveCamera ? (
              <>
                <CameraView
                  style={StyleSheet.absoluteFill}
                  facing="back"
                  autofocus="on"
                  enableTorch={torch}
                  barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                  onBarcodeScanned={({ data }) => handleFrame(data)}
                />
                <View style={styles.scrim} pointerEvents="none" />
              </>
            ) : null}

            <ScannerFrame active={liveCamera && !verdict} />

            {liveCamera && !verdict ? (
              <Pressable
                onPress={() => {
                  if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setTorch((t) => !t);
                }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityState={{ selected: torch }}
                accessibilityLabel={torch ? s.torchOff : s.torchOn}
                style={styles.torchBtn}>
                {({ pressed }) => (
                  <GlassSurface
                    interactive
                    fallbackColor="rgba(0,0,0,0.45)"
                    style={[styles.torchInner, { opacity: pressed ? 0.7 : 1 }]}>
                    <SymbolView
                      name={torch ? Icons.torchOn : Icons.torchOff}
                      size={20}
                      tintColor="#FFFFFF"
                    />
                  </GlassSurface>
                )}
              </Pressable>
            ) : null}

            <View style={styles.viewfinderInner} pointerEvents="none">
              {liveCamera ? (
                assembling && progress.total != null ? (
                  <ScanProgress have={progress.have} total={progress.total} />
                ) : (
                  <GlassSurface fallbackColor="rgba(0,0,0,0.6)" style={styles.progressPill}>
                    <ThemedText style={styles.progressText}>{s.pointAtQr}</ThemedText>
                  </GlassSurface>
                )
              ) : (
                <IdleContent
                  cameraAvailable={cameraAvailable}
                  blocked={!!permission && !permission.granted && !permission.canAskAgain}
                />
              )}
            </View>
          </View>

          {cameraAvailable && !permission?.granted ? (
            // Once access is permanently blocked, requestPermission() is a no-op
            // (the OS won't re-prompt) — send the operator straight to Settings.
            permission && !permission.canAskAgain ? (
              <Button label={s.openSettings} icon={Icons.settings} onPress={() => Linking.openSettings()} />
            ) : (
              <Button label={s.enableCamera} icon={Icons.camera} onPress={requestPermission} />
            )
          ) : null}

          {/* History */}
          <View style={styles.historySection}>
            <View style={styles.historyHeader}>
              <ThemedText type="subtitle">{s.recentScans}</ThemedText>
              {history.length > 0 ? (
                <Button label={s.clear} variant="ghost" icon={Icons.clear} onPress={clearHistory} />
              ) : null}
            </View>
            {history.length > 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                {s.scannedSummary(history.length, overCount)}
              </ThemedText>
            ) : null}

            {history.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
                {s.emptyHistory}
              </ThemedText>
            ) : (
              <View
                style={[styles.historyList, { borderColor: theme.border }]}>
                {history.map((rec, i) => (
                  <HistoryRow
                    key={rec.id}
                    record={rec}
                    now={nowTick}
                    first={i === 0}
                  />
                ))}
              </View>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>

      {verdict ? (
        <VerdictOverlay
          key={verdict.key}
          tone={verdict.presentation.tone}
          icon={verdict.presentation.icon}
          title={verdict.presentation.title}
          subtitle={verdict.presentation.subtitle}
          sticky={verdict.sticky}
          repeat={verdict.repeat}
          autoAdvanceMs={verdict.sticky ? undefined : PASS_FLASH_MS}
          onHold={holdVerdict}
          onDismiss={dismiss}
        />
      ) : null}
    </ThemedView>
  );
}

function HistoryRow({
  record,
  now,
  first,
}: {
  record: ScanRecord;
  now: number;
  first: boolean;
}) {
  const theme = useTheme();
  const s = useStrings();
  const { tone, label, icon } = summarize(record.outcome, record.requiredAge, s);
  return (
    <Animated.View
      entering={first ? FadeInDown.duration(220) : undefined}
      style={[styles.row, { borderTopColor: theme.border, borderTopWidth: first ? 0 : StyleSheet.hairlineWidth }]}>
      <View style={[styles.rowDot, { backgroundColor: theme[`${tone}Surface` as const] }]}>
        <SymbolView name={icon} size={20} tintColor={theme[tone]} />
      </View>
      <View style={styles.rowMain}>
        <View style={styles.rowLabel}>
          <ThemedText type="smallBold" numberOfLines={1} style={{ color: theme[tone] }}>
            {label}
          </ThemedText>
          {record.repeat ? (
            <SymbolView name={Icons.repeat} size={13} tintColor={theme.textSecondary} />
          ) : null}
        </View>
        <ThemedText type="small" themeColor="textSecondary" style={styles.rowClock}>
          {record.repeat ? `${s.repeatScan} · ${formatClock(record.at)}` : formatClock(record.at)}
        </ThemedText>
      </View>
      <ThemedText
        type="small"
        themeColor="textSecondary"
        numberOfLines={1}
        style={styles.rowAgo}>
        {formatRelative(record.at, now, s)}
      </ThemedText>
    </Animated.View>
  );
}

type SegmentState = 'filled' | 'active' | 'pending';

/**
 * Visual assembly progress: one segment per part of the multipart QR. Captured
 * parts fill solid; the single part we're still waiting on *breathes* so the
 * wait reads as the scanner actively hunting rather than a stalled bar — which
 * matters because the last part is, by chance, much the slowest to catch (most
 * frames are parts we already hold). Once only that final part remains, the
 * label softens to "almost there" so the longer pause feels expected.
 */
function ScanProgress({ have, total }: { have: number; total: number }) {
  const s = useStrings();
  const finalStretch = have >= total - 1;
  return (
    <AnimatedGlassSurface
      entering={FadeIn.duration(200)}
      fallbackColor="rgba(0,0,0,0.6)"
      style={styles.progressPill}>
      <ThemedText style={styles.progressText}>
        {finalStretch ? s.almostThere : s.readingShort}
      </ThemedText>
      <View style={styles.segmentRow}>
        {Array.from({ length: total }, (_, i) => (
          <ProgressSegment
            key={i}
            state={i < have ? 'filled' : i === have ? 'active' : 'pending'}
          />
        ))}
      </View>
    </AnimatedGlassSurface>
  );
}

function ProgressSegment({ state }: { state: SegmentState }) {
  const reduceMotion = useReducedMotion();
  // 0 → dim, 1 → bright; looped while this is the segment being hunted.
  const pulse = useSharedValue(0);

  useEffect(() => {
    if (state === 'active' && !reduceMotion) {
      pulse.value = withRepeat(
        withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
    } else {
      cancelAnimation(pulse);
      pulse.value = withTiming(0, { duration: 180 });
    }
  }, [state, reduceMotion, pulse]);

  const animatedStyle = useAnimatedStyle(() => {
    if (state === 'active') {
      // Reduced motion: a steady mid-brightness still marks "next" without animating.
      return {
        opacity: reduceMotion ? 0.7 : 0.4 + 0.6 * pulse.value,
        transform: [{ scaleY: reduceMotion ? 1 : 0.78 + 0.22 * pulse.value }],
      };
    }
    return {
      opacity: withTiming(state === 'filled' ? 1 : 0.25, { duration: 200 }),
      transform: [{ scaleY: withTiming(state === 'filled' ? 1 : 0.55, { duration: 200 }) }],
    };
  });

  return <Animated.View style={[styles.segment, animatedStyle]} />;
}

/**
 * Door policy: the minimum age to clear green. At 18+ the 18–20 span passes
 * green; at 21+ that span is flagged amber (proven 18 but not 21). Doesn't gate
 * scanning — it only changes how the 18–20 verdict is coloured.
 */
function AgeThresholdToggle({
  value,
  onChange,
}: {
  value: RequiredAge;
  onChange: (next: RequiredAge) => void;
}) {
  const theme = useTheme();
  const s = useStrings();
  return (
    <View style={styles.toggleRow}>
      <ThemedText type="small" themeColor="textSecondary">
        {s.requiredAge}
      </ThemedText>
      <View
        style={[
          styles.segGroup,
          { backgroundColor: theme.backgroundElement, borderColor: theme.border },
        ]}>
        {([18, 21] as const).map((age) => {
          const active = value === age;
          return (
            <Pressable
              key={age}
              onPress={() => onChange(age)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${s.requiredAge} ${age}+`}
              style={[styles.segBtn, active && { backgroundColor: theme.brand }]}>
              <ThemedText
                type="smallBold"
                style={{ color: active ? '#FFFFFF' : theme.textSecondary }}>
                {age}+
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function IdleContent({
  cameraAvailable,
  blocked,
}: {
  cameraAvailable: boolean;
  blocked: boolean;
}) {
  const theme = useTheme();
  const s = useStrings();
  const hint = !cameraAvailable ? s.webHint : blocked ? s.enableCameraSettingsHint : s.enableCameraHint;
  return (
    <Animated.View entering={FadeIn.duration(300)} style={styles.idle}>
      <View style={[styles.idleIcon, { backgroundColor: theme.background }]}>
        <SymbolView name={Icons.qr} size={44} tintColor={theme.textSecondary} />
      </View>
      <ThemedText type="smallBold" style={styles.idleText}>
        {cameraAvailable ? s.cameraOff : s.cameraUnavailableWeb}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.idleText}>
        {hint}
      </ThemedText>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safeArea: { flex: 1, alignItems: 'center' },
  scroll: { flex: 1, width: '100%', maxWidth: MaxContentWidth },
  content: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.six,
    gap: Spacing.three,
  },
  header: { gap: Spacing.one },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  brand: { fontSize: 13, fontWeight: '700', letterSpacing: 2 },
  heading: { fontSize: 34, lineHeight: 38 },

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  segGroup: {
    flexDirection: 'row',
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 2,
    gap: 2,
  },
  segBtn: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: 999,
    minWidth: 52,
    alignItems: 'center',
  },

  viewfinder: {
    width: '100%',
    aspectRatio: 1,
    maxHeight: 440,
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  scrim: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(0,0,0,0.18)' },
  viewfinderInner: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },

  idle: { alignItems: 'center', gap: Spacing.two },
  idleIcon: {
    width: 96,
    height: 96,
    borderRadius: 28,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.one,
  },
  idleText: { textAlign: 'center', maxWidth: 280 },

  progressPill: {
    position: 'absolute',
    bottom: Spacing.four,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 999,
    alignItems: 'center',
    gap: Spacing.one,
    overflow: 'hidden',
  },
  progressText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  segmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    width: 200,
  },
  segment: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FFFFFF',
  },
  torchBtn: {
    position: 'absolute',
    top: Spacing.three,
    right: Spacing.three,
  },
  torchInner: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },

  historySection: { gap: Spacing.two },
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  empty: { paddingVertical: Spacing.two },
  historyList: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  rowDot: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowMain: { flex: 1, gap: 1 },
  rowLabel: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  rowClock: { fontVariant: ['tabular-nums'] },
  rowAgo: { flexShrink: 0, textAlign: 'right', fontVariant: ['tabular-nums'] },
});
