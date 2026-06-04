/**
 * UI string catalogue. English and Danish must stay structurally identical —
 * `translations` is typed as `Record<Lang, Strings>`, so a missing or mistyped
 * key in either language is a compile error.
 *
 * Parameterised strings are plain functions, which keeps interpolation and
 * pluralisation type-safe without a runtime i18n engine.
 */
export type Lang = 'en' | 'da';

export type Strings = {
  // Header
  proofOfAge: string;
  tagline: string;

  // Verdict (full screen)
  overTitle: (n: number) => string;
  overSubtitle: string;
  over18CautionSubtitle: string; // 18+ confirmed but the door requires 21+
  underTitle: string;
  underSubtitle: string;
  noProofTitle: string;
  noProofSubtitle: string;
  cantVerifyTitle: string;
  cantVerifySubtitle: string;
  expiredTitle: string;
  expiredSubtitle: string;
  untrustedTitle: string;
  untrustedSubtitle: string;

  // History row labels
  labelOver21: string;
  labelOver18: string;
  labelUnder18: string;
  labelNoProof: string;
  labelCantVerify: string;
  labelExpired: string;
  labelUntrusted: string;

  // Age policy toggle
  requiredAge: string;

  // Scanner
  readingShort: string;
  almostThere: string;
  pointAtQr: string;
  cameraOff: string;
  cameraUnavailableWeb: string;
  enableCameraHint: string;
  enableCameraSettingsHint: string;
  webHint: string;
  enableCamera: string;
  openSettings: string;
  torchOn: string;
  torchOff: string;

  // History section
  recentScans: string;
  scannedSummary: (scanned: number, over: number) => string;
  clear: string;
  emptyHistory: string;

  // Relative time
  justNow: string;
  secondsAgo: (s: number) => string;
  minutesAgo: (m: number) => string;
  hoursAgo: (h: number) => string;

  // Verdict overlay
  tapToContinue: string;
  tapToHold: string;
  dismissA11y: string;
  repeatScan: string;

  // Error boundary
  errorTitle: string;
  errorBody: string;
  tryAgain: string;

  // Not found
  notFoundTitle: string;
  notFoundBody: string;
  backToScanner: string;
};

const en: Strings = {
  proofOfAge: 'Age verification',
  tagline: 'Scan a customer’s age QR code to confirm they’re 18 or over.',

  overTitle: (n) => `Over ${n}`,
  overSubtitle: 'Age confirmed — OK to proceed.',
  over18CautionSubtitle: 'Over 18, but 21+ isn’t confirmed.',
  underTitle: 'Under 18',
  underSubtitle: 'Not confirmed as 18 or over — do not proceed.',
  noProofTitle: 'No age proof shared',
  noProofSubtitle: 'Ask the customer to share their age proof, then scan again.',
  cantVerifyTitle: 'Couldn’t read code',
  cantVerifySubtitle: 'The code couldn’t be read. Try again, or check a physical ID.',
  expiredTitle: 'Code expired',
  expiredSubtitle: 'Ask the customer to refresh their QR code, then scan again.',
  untrustedTitle: 'Not an AltID code',
  untrustedSubtitle: 'This isn’t a recognised AltID age code. Check a physical ID.',

  labelOver21: 'Over 21',
  labelOver18: 'Over 18',
  labelUnder18: 'Under 18',
  labelNoProof: 'No proof shared',
  labelCantVerify: 'Unreadable',
  labelExpired: 'Expired',
  labelUntrusted: 'Untrusted',

  requiredAge: 'Required age',

  readingShort: 'Reading code…',
  almostThere: 'Almost there…',
  pointAtQr: 'Point the camera at the customer’s age QR code',
  cameraOff: 'Camera is off',
  cameraUnavailableWeb: 'Camera isn’t available in a web browser',
  enableCameraHint: 'Turn on the camera to start verifying ages.',
  enableCameraSettingsHint: 'Camera access is blocked. Enable it in Settings to scan.',
  webHint: 'Open the app on a phone to scan customers’ age QR codes.',
  enableCamera: 'Turn on camera',
  openSettings: 'Open Settings',
  torchOn: 'Turn on light',
  torchOff: 'Turn off light',

  recentScans: 'Recent checks',
  scannedSummary: (scanned, over) => `${scanned} checked · ${over} over 18`,
  clear: 'Clear',
  emptyHistory: 'Each check you make will appear here.',

  justNow: 'just now',
  secondsAgo: (s) => `${s}s ago`,
  minutesAgo: (m) => `${m}m ago`,
  hoursAgo: (h) => `${h}h ago`,

  tapToContinue: 'Tap to continue',
  tapToHold: 'Tap to keep on screen',
  dismissA11y: 'Dismiss and continue scanning',
  repeatScan: 'Already scanned',

  errorTitle: 'Something went wrong',
  errorBody: 'The app ran into an unexpected problem. Please try again.',
  tryAgain: 'Try again',

  notFoundTitle: 'Screen not found',
  notFoundBody: 'This screen doesn’t exist.',
  backToScanner: 'Back to scanner',
};

const da: Strings = {
  proofOfAge: 'Aldersverifikation',
  tagline: 'Scan kundens alders-QR-kode for at bekræfte, at de er 18 år eller derover.',

  overTitle: (n) => `Over ${n}`,
  overSubtitle: 'Alder bekræftet — i orden.',
  over18CautionSubtitle: 'Over 18, men 21+ er ikke bekræftet.',
  underTitle: 'Under 18',
  underSubtitle: 'Ikke bekræftet som 18 eller derover — fortsæt ikke.',
  noProofTitle: 'Intet aldersbevis delt',
  noProofSubtitle: 'Bed kunden dele deres aldersbevis, og scan igen.',
  cantVerifyTitle: 'Kunne ikke læse koden',
  cantVerifySubtitle: 'Koden kunne ikke læses. Prøv igen, eller tjek et fysisk ID.',
  expiredTitle: 'Koden er udløbet',
  expiredSubtitle: 'Bed kunden opdatere deres QR-kode, og scan igen.',
  untrustedTitle: 'Ikke en AltID-kode',
  untrustedSubtitle: 'Dette er ikke en genkendt AltID-alderskode. Tjek et fysisk ID.',

  labelOver21: 'Over 21',
  labelOver18: 'Over 18',
  labelUnder18: 'Under 18',
  labelNoProof: 'Intet bevis delt',
  labelCantVerify: 'Ulæselig',
  labelExpired: 'Udløbet',
  labelUntrusted: 'Ikke betroet',

  requiredAge: 'Krævet alder',

  readingShort: 'Læser kode…',
  almostThere: 'Næsten færdig…',
  pointAtQr: 'Ret kameraet mod kundens alders-QR-kode',
  cameraOff: 'Kameraet er slukket',
  cameraUnavailableWeb: 'Kameraet er ikke tilgængeligt i en browser',
  enableCameraHint: 'Tænd kameraet for at begynde at verificere aldre.',
  enableCameraSettingsHint: 'Kameraadgang er blokeret. Aktivér den i Indstillinger for at scanne.',
  webHint: 'Åbn appen på en telefon for at scanne kunders alders-QR-koder.',
  enableCamera: 'Tænd kamera',
  openSettings: 'Åbn Indstillinger',
  torchOn: 'Tænd lys',
  torchOff: 'Sluk lys',

  recentScans: 'Seneste tjek',
  scannedSummary: (scanned, over) => `${scanned} tjekket · ${over} over 18`,
  clear: 'Ryd',
  emptyHistory: 'Hvert tjek, du foretager, vises her.',

  justNow: 'lige nu',
  secondsAgo: (s) => `${s} sek. siden`,
  minutesAgo: (m) => `${m} min. siden`,
  hoursAgo: (h) => `${h} t. siden`,

  tapToContinue: 'Tryk for at fortsætte',
  tapToHold: 'Tryk for at beholde på skærmen',
  dismissA11y: 'Luk og fortsæt scanning',
  repeatScan: 'Allerede scannet',

  errorTitle: 'Noget gik galt',
  errorBody: 'Appen stødte på et uventet problem. Prøv venligst igen.',
  tryAgain: 'Prøv igen',

  notFoundTitle: 'Skærmen blev ikke fundet',
  notFoundBody: 'Denne skærm findes ikke.',
  backToScanner: 'Tilbage til scanneren',
};

export const translations: Record<Lang, Strings> = { en, da };
