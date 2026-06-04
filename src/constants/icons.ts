import type { SymbolViewProps } from 'expo-symbols';

/**
 * Cross-platform icon names. `expo-symbols` renders SF Symbols on iOS and Material
 * Symbols on Android/web, but only when given the `{ ios, android, web }` object form.
 * Centralising the mapping keeps every icon visible on all three platforms.
 */
type IconName = Extract<SymbolViewProps['name'], object>;

export const Icons = {
  shield: { ios: 'checkmark.shield.fill', android: 'verified_user', web: 'verified_user' },
  scan: { ios: 'qrcode.viewfinder', android: 'qr_code_scanner', web: 'qr_code_scanner' },
  qr: { ios: 'qrcode', android: 'qr_code_2', web: 'qr_code_2' },
  camera: { ios: 'camera.fill', android: 'photo_camera', web: 'photo_camera' },
  retry: { ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' },
  repeat: { ios: 'arrow.triangle.2.circlepath', android: 'repeat', web: 'repeat' },
  clock: { ios: 'clock.badge.exclamationmark', android: 'schedule', web: 'schedule' },
  settings: { ios: 'gearshape.fill', android: 'settings', web: 'settings' },
  sample: { ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' },
  copy: { ios: 'doc.on.doc', android: 'content_copy', web: 'content_copy' },
  check: { ios: 'checkmark', android: 'check', web: 'check' },
  sealOk: { ios: 'checkmark.seal.fill', android: 'verified', web: 'verified' },
  sealBad: { ios: 'xmark.seal.fill', android: 'gpp_bad', web: 'gpp_bad' },
  warn: { ios: 'exclamationmark.triangle.fill', android: 'warning', web: 'warning' },
  info: { ios: 'info.circle', android: 'info', web: 'info' },
  offline: { ios: 'wifi.slash', android: 'wifi_off', web: 'wifi_off' },
  signature: { ios: 'signature', android: 'draw', web: 'draw' },
  privacy: { ios: 'eye.slash', android: 'visibility_off', web: 'visibility_off' },
  replay: { ios: 'bolt.shield', android: 'security', web: 'security' },
  test: { ios: 'testtube.2', android: 'science', web: 'science' },
  checkCircle: { ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' },
  xCircle: { ios: 'xmark.circle.fill', android: 'cancel', web: 'cancel' },
  clear: { ios: 'trash', android: 'delete', web: 'delete' },
  torchOn: { ios: 'bolt.fill', android: 'flashlight_on', web: 'flashlight_on' },
  torchOff: { ios: 'bolt.slash.fill', android: 'flashlight_off', web: 'flashlight_off' },
} satisfies Record<string, IconName>;
