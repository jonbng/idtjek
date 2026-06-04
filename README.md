# ID Tjek

A door/till scanner that reads an **AltID proof-of-age QR code** and shows a
single verdict — over 18 / over 21 / under 18 / can't verify — with haptic
feedback so an operator can read it without looking. Built with Expo (SDK 56).

Everything runs **on-device**: no servers, no accounts, no network calls. See
[`PRIVACY.md`](./PRIVACY.md).

## How it works

The QR is a looping multi-part animation. The app assembles the frames,
verifies the credential per the AltID Signed-QR spec (Appendix B), and reports
the disclosed age threshold. The validator **fails closed** — any parse,
signature, trust, or freshness problem yields a rejection, never a permissive
default.

The validation core lives in [`src/altid/`](./src/altid) and is documented in
[`Validating-AltID-Proof-of-Age-QR.md`](./Validating-AltID-Proof-of-Age-QR.md).

## Develop

```bash
npm install
npm start          # Expo dev server
npm run android    # build + run on Android
npm run ios        # build + run on iOS
```

> **Android builds need JDK 21**, not the system default. Point `JAVA_HOME` at
> Android Studio's bundled JBR:
> `JAVA_HOME=/usr/local/android-studio/jbr npm run android`

## Checks

```bash
npm run altid:selftest   # validator self-test (assembly, signatures, replay, fail-closed)
npm run lint
npx tsc --noEmit         # type-check
```

The self-test runs the validator end-to-end against a bundled test vector and
covers replay protection and expiry. Run it before any release.

## Trust list & cert rotation

Trusted issuer certificates are PEM-pinned in
[`src/altid/trust.ts`](./src/altid/trust.ts). Release builds trust the
**production** issuer only; the test cert is accepted in `__DEV__` builds.

AltID rotates the issuer signing cert periodically (new certs are published
≥3 months ahead). To add the next cert, append its PEM to `trust.ts` and ship
an update **before** the current one expires. The active production cert is
valid through **2029-05-06**.

## Releasing

Builds and submissions go through EAS (`eas.json`). Before submitting:

1. Run the checks above and smoke-test a **real production AltID QR** on a
   physical device.
2. Provide the store privacy-policy URL (host [`PRIVACY.md`](./PRIVACY.md)) and
   complete the age/content rating.
