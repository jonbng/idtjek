/**
 * AltID Proof-of-Age "Signed QR" validator.
 *
 * Implements Appendix B (Table 10) of the AltID Technical Integration spec for
 * the in-person Signed-QR PoA flow, returning a single business answer: is the
 * presenter 18 or older?
 *
 * Every step fails closed: any parse/verify problem yields `rejected`, never a
 * permissive default. See Validating-AltID-Proof-of-Age-QR.md for the prose.
 */
import { sha256 } from '@noble/hashes/sha2.js';

import { base64urlToBytes, bytesEqual, bytesToBase64url } from './bytes';
import {
  CborTag,
  cborDecode,
  encArray,
  encTag24,
  encTstr,
  encUint,
  ENC_EMPTY_MAP,
  ENC_NULL,
  type CborMap,
} from './cbor';
import {
  assertEs256,
  coseKeyToPublicKey,
  extractX5Chain,
  parseCoseSign1,
  verifyCoseSign1,
} from './cose';
import { parseCertificate } from './x509';
import {
  defaultTrustList,
  findTrustAnchor,
  type TrustAnchor,
} from './trust';

export const ALTID_TYP = 'AltID-1.0';
export const POA_DOCTYPE = 'eu.europa.ec.av.1';
export const POA_NAMESPACE = 'eu.europa.ec.av.1';
export const AGE_OVER_18 = 'age_over_18';
/** Disclosed age attributes are named `age_over_<NN>` (e.g. age_over_18). */
export const AGE_OVER_PREFIX = 'age_over_';

const DEFAULT_SKEW_SECONDS = 60;
const DEFAULT_MAX_WINDOW_SECONDS = 180; // QR validity window (validTo - validFrom)

export interface ValidateOptions {
  /** Current time in Unix seconds. Defaults to wall-clock. */
  now?: number;
  skewSeconds?: number;
  maxWindowSeconds?: number;
  trustList?: TrustAnchor[];
  /**
   * Anti-replay set of already-accepted mnonce values. If provided, a repeated
   * mnonce is rejected; an accepted one is added.
   */
  seenNonces?: Set<string>;
  /** Optional step-by-step diagnostics callback (e.g. console.log). */
  onDebug?: (line: string) => void;
  /**
   * Spec step 11a requires the MSO `signed` time to fall within the issuer
   * leaf certificate's validity window. AltID stamps `signed` at midnight of
   * the issuance day, so credentials issued around an issuer-cert rollover can
   * have `signed` a few hours/days *before* the cert's notBefore. That lower-
   * bound violation is benign (the signature, trust and attestation-validity
   * checks still hold), so by default we accept it and log a warning.
   *
   * Set true to enforce the spec-literal behaviour (matches the official AltID
   * verifier, which rejects such credentials with C-VQR-010).
   *
   * NOTE: the upper bound (`signed` after the cert's notAfter) is always
   * enforced regardless of this flag — signing with an expired cert is the
   * genuinely suspicious direction.
   */
  strictSignedCertWindow?: boolean;
}

/** Format Unix seconds as an ISO-8601 UTC string for diagnostics. */
function isoUtc(unixSeconds: number): string {
  if (!Number.isFinite(unixSeconds)) return `invalid(${unixSeconds})`;
  return new Date(unixSeconds * 1000).toISOString();
}

/**
 * Why a presentation was rejected, coarse enough to drive a helpful next-action:
 *  - 'expired'   → the QR / attestation is simply stale (refresh & rescan).
 *  - 'untrusted' → not signed by a recognised AltID issuer (not our QR / fake).
 *  - 'invalid'   → anything else (unreadable, malformed, bad signature, replay).
 * `reason` carries the precise diagnostic string for logs/debugging.
 */
export type RejectCode = 'expired' | 'untrusted' | 'invalid';

export type ValidationOutcome =
  // Cryptographically valid presentation. `ageOver` holds every disclosed
  // `age_over_NN` flag (NN → boolean); it may be empty if the holder shared no
  // age attribute. The age *policy* decision is left to the caller.
  | { kind: 'verified'; ageOver: Record<number, boolean>; mnonce: string }
  | { kind: 'rejected'; reason: string; code: RejectCode };

/** Coarse age bracket the UI cares about, derived from the disclosed flags. */
export type AgeBracket = 'over21' | 'over18' | 'under18';

/**
 * Collapse the disclosed `age_over_NN` flags into a single bracket by monotonic
 * reasoning: `age_over_N === true` means the holder is at least N. The AltID
 * wallet only ever discloses such lower-bound proofs (never a negative), so the
 * rule is simply "deny unless 18+ is proven":
 *   - proven ≥ 21            → 'over21'
 *   - proven ≥ 18 (not 21)   → 'over18'  (the 18–20 span)
 *   - 18+ not proven         → 'under18' (explicit under-age, a lower-bound that
 *                              stops short of 18, or nothing age-related shared)
 * The last case is the safe default for a door: if they didn't prove 18+, they
 * don't get the green light. Use {@link hasAgeProof} to tell "nothing shared"
 * apart from "shared something below 18" when the UI wants distinct copy.
 */
export function ageBracket(ageOver: Record<number, boolean>): AgeBracket {
  let maxProven = -Infinity;
  for (const [key, value] of Object.entries(ageOver)) {
    const n = Number(key);
    if (value && Number.isFinite(n)) maxProven = Math.max(maxProven, n);
  }
  if (maxProven >= 21) return 'over21';
  if (maxProven >= 18) return 'over18';
  return 'under18';
}

/** Whether the holder disclosed any age attribute at all. */
export function hasAgeProof(ageOver: Record<number, boolean>): boolean {
  return Object.keys(ageOver).length > 0;
}

export interface QRPayload {
  typ: string;
  txn: string;
  mnonce: string;
  nbf: number;
  exp: number;
  doc: Uint8Array;
}

class RejectError extends Error {
  code: RejectCode;
  constructor(reason: string, code: RejectCode = 'invalid') {
    super(reason);
    this.code = code;
  }
}
function reject(reason: string, code: RejectCode = 'invalid'): never {
  throw new RejectError(reason, code);
}

// --- small map helpers -----------------------------------------------------

function getMap(m: unknown, key: string | number, ctx: string): CborMap {
  if (!(m instanceof Map)) reject(`${ctx}: not a map`);
  const v = (m as CborMap).get(key);
  if (!(v instanceof Map)) reject(`${ctx}: '${key}' is not a map`);
  return v as CborMap;
}
function getStr(m: CborMap, key: string, ctx: string): string {
  const v = m.get(key);
  if (typeof v !== 'string') reject(`${ctx}: '${key}' is not a string`);
  return v as string;
}
function getNum(m: CborMap, key: string, ctx: string): number {
  const v = m.get(key);
  if (typeof v !== 'number') reject(`${ctx}: '${key}' is not a number`);
  return v as number;
}
function getBytes(m: CborMap, key: string, ctx: string): Uint8Array {
  const v = m.get(key);
  if (!(v instanceof Uint8Array)) reject(`${ctx}: '${key}' is not bytes`);
  return v as Uint8Array;
}

/** Parse a tdate value (CBOR tag 0 wrapping an RFC 3339 string) to Unix secs. */
function parseTdate(value: unknown, ctx: string): number {
  const iso = value instanceof CborTag ? value.value : value;
  if (typeof iso !== 'string') reject(`${ctx}: not a date string`);
  const ms = Date.parse(iso as string);
  if (Number.isNaN(ms)) reject(`${ctx}: unparseable date '${iso}'`);
  return Math.floor(ms / 1000);
}

// --- multipart QR assembly (§2) --------------------------------------------

/**
 * Assembles the multi-frame Signed-QR transport. Feed each scanned frame's
 * text (Base64URL) via {@link addFrame}; it returns the assembled payload bytes
 * `Q` once every part has been collected, otherwise null.
 */
export class MultipartAssembler {
  private txn: string | null = null;
  private cnt: number | null = null;
  private parts = new Map<number, Uint8Array>();
  // Raw frame strings already processed this scan. The holder's QR loops the
  // same parts continuously, so the camera re-reads each part many times; a
  // given part always renders the identical string, so this lets us drop a
  // repeat before the (comparatively costly) base64+CBOR decode below. Skipping
  // that work keeps the JS thread free to catch the parts we still need.
  private seen = new Set<string>();

  reset(): void {
    this.txn = null;
    this.cnt = null;
    this.parts.clear();
    this.seen.clear();
  }

  get total(): number | null {
    return this.cnt;
  }
  get collected(): number {
    return this.parts.size;
  }
  /** Transaction id of the parts collected so far (null before any frame). */
  get transaction(): string | null {
    return this.txn;
  }

  /** @returns assembled `Q` bytes when complete, else null. */
  addFrame(frameText: string): Uint8Array | null {
    const trimmed = frameText.trim();
    // A part we've already decoded this scan can never be the one that
    // completes assembly, so bail before doing any decoding work.
    if (this.seen.has(trimmed)) return null;
    let map: unknown;
    try {
      map = cborDecode(base64urlToBytes(trimmed));
    } catch {
      return null; // not a frame we understand; ignore
    }
    if (!(map instanceof Map)) return null;
    const typ = map.get('typ');
    const txn = map.get('txn');
    const idx = map.get('idx');
    const cnt = map.get('cnt');
    const part = map.get('part');
    if (
      typeof typ !== 'string' ||
      !typ.startsWith('AltID-') ||
      typeof txn !== 'string' ||
      typeof idx !== 'number' ||
      typeof cnt !== 'number' ||
      !(part instanceof Uint8Array)
    ) {
      return null;
    }

    // A new transaction id mid-scan means the user regenerated the QR; reset()
    // also clears `seen`, and the regenerated parts carry a fresh txn so their
    // strings won't collide with the cleared cache.
    if (this.txn !== null && this.txn !== txn) this.reset();
    this.txn = txn;
    this.cnt = cnt;
    this.parts.set(idx, part);
    this.seen.add(trimmed);

    if (this.parts.size !== cnt) return null;
    for (let i = 0; i < cnt; i++) {
      if (!this.parts.has(i)) return null;
    }
    const ordered: Uint8Array[] = [];
    for (let i = 0; i < cnt; i++) ordered.push(this.parts.get(i)!);
    let len = 0;
    for (const p of ordered) len += p.length;
    const Q = new Uint8Array(len);
    let off = 0;
    for (const p of ordered) {
      Q.set(p, off);
      off += p.length;
    }
    return Q;
  }
}

// --- payload decode ---------------------------------------------------------

export function decodeQRPayload(Q: Uint8Array): QRPayload {
  const map = cborDecode(Q);
  if (!(map instanceof Map)) reject('QRPayload: not a CBOR map');
  return {
    typ: getStr(map, 'typ', 'QRPayload'),
    txn: getStr(map, 'txn', 'QRPayload'),
    mnonce: getStr(map, 'mnonce', 'QRPayload'),
    nbf: getNum(map, 'nbf', 'QRPayload'),
    exp: getNum(map, 'exp', 'QRPayload'),
    doc: getBytes(map, 'doc', 'QRPayload'),
  };
}

// --- the validation pipeline ------------------------------------------------

/**
 * Internal building block exposed for self-tests: reconstruct the detached
 * DeviceAuthenticationBytes payload for a Signed-QR presentation.
 */
export function buildDeviceAuthenticationBytes(
  mnonce: string,
  nbf: number,
  exp: number,
  docType: string,
): { sessionTranscript: Uint8Array; deviceAuthenticationBytes: Uint8Array } {
  const sessionTranscript = encArray([
    ENC_NULL,
    ENC_NULL,
    encArray([encTstr(mnonce), encUint(nbf), encUint(exp)]),
  ]);
  const deviceAuthentication = encArray([
    encTstr('DeviceAuthentication'),
    sessionTranscript,
    encTstr(docType),
    encTag24(ENC_EMPTY_MAP),
  ]);
  return {
    sessionTranscript,
    deviceAuthenticationBytes: encTag24(deviceAuthentication),
  };
}

export function validatePayload(
  payload: QRPayload,
  opts: ValidateOptions = {},
): ValidationOutcome {
  const dbg = opts.onDebug ?? (() => {});
  try {
    const now = opts.now ?? Math.floor(Date.now() / 1000);
    const skew = opts.skewSeconds ?? DEFAULT_SKEW_SECONDS;
    const maxWindow = opts.maxWindowSeconds ?? DEFAULT_MAX_WINDOW_SECONDS;
    const trustList = opts.trustList ?? defaultTrustList();

    dbg(`now=${now} (${isoUtc(now)}), skew=${skew}s`);

    // §4.1 payload sanity & freshness
    if (payload.typ !== ALTID_TYP) reject(`unexpected typ '${payload.typ}'`);
    if (!Number.isInteger(payload.nbf) || !Number.isInteger(payload.exp)) {
      reject('nbf/exp not integers');
    }
    dbg(
      `QR validity: nbf=${payload.nbf} (${isoUtc(payload.nbf)}) .. ` +
        `exp=${payload.exp} (${isoUtc(payload.exp)}), window=${payload.exp - payload.nbf}s`,
    );
    if (now + skew < payload.nbf) {
      reject(`presentation not yet valid (now ${isoUtc(now)} < nbf ${isoUtc(payload.nbf)})`);
    }
    if (now - skew > payload.exp) {
      reject(`presentation expired (now ${isoUtc(now)} > exp ${isoUtc(payload.exp)})`, 'expired');
    }
    if (payload.exp - payload.nbf > maxWindow) {
      reject(`validity window too long (${payload.exp - payload.nbf}s > ${maxWindow}s)`);
    }
    if (base64urlToBytes(payload.mnonce).length !== 16) {
      reject('mnonce is not 16 bytes');
    }

    // Decode Document
    const doc = cborDecode(payload.doc);
    if (!(doc instanceof Map)) reject('Document: not a CBOR map');
    const docType = getStr(doc as CborMap, 'docType', 'Document');
    const issuerSigned = getMap(doc, 'issuerSigned', 'Document');
    const deviceSigned = getMap(doc, 'deviceSigned', 'Document');

    // IssuerAuth (COSE_Sign1) + MSO
    const issuerAuthRaw = (issuerSigned as CborMap).get('issuerAuth');
    const issuerAuth = parseCoseSign1(issuerAuthRaw);
    assertEs256(issuerAuth);
    if (!issuerAuth.payload) reject('issuerAuth payload missing');

    const msoTag = cborDecode(issuerAuth.payload);
    if (!(msoTag instanceof CborTag) || msoTag.tag !== 24) {
      reject('MSO not a #6.24 tagged bstr');
    }
    const mso = cborDecode((msoTag as CborTag).value as Uint8Array);
    if (!(mso instanceof Map)) reject('MSO: not a CBOR map');
    const msoMap = mso as CborMap;

    // §4.2 issuer trust & signature
    const chain = extractX5Chain(issuerAuth.unprotected);
    dbg(`x5chain: ${chain.length} cert(s)`);
    const leaf = parseCertificate(chain[0]);
    dbg(
      `leaf cert validity: notBefore=${isoUtc(leaf.notBefore)} .. ` +
        `notAfter=${isoUtc(leaf.notAfter)}`,
    );
    const anchor = findTrustAnchor(leaf, trustList);
    dbg(`trust match: ${anchor ? anchor.label : 'NONE'}`);
    if (!anchor) reject('issuer certificate not in trust list', 'untrusted');
    if (!verifyCoseSign1(issuerAuth, leaf.publicKey)) {
      reject('issuer signature invalid');
    }
    dbg('issuer signature OK');

    // §4.4 docType consistency
    const msoDocType = getStr(msoMap, 'docType', 'MSO');
    if (docType !== POA_DOCTYPE) reject(`unexpected docType '${docType}'`);
    if (msoDocType !== docType) reject('docType mismatch (MSO vs Document)');

    // §4.4 / step 11a: MSO.signed within leaf cert validity; temporal validity
    const validity = getMap(msoMap, 'validityInfo', 'MSO');
    const signed = parseTdate(validity.get('signed'), 'validityInfo.signed');
    const validFrom = parseTdate(validity.get('validFrom'), 'validityInfo.validFrom');
    const validUntil = parseTdate(validity.get('validUntil'), 'validityInfo.validUntil');
    dbg(
      `MSO validityInfo: signed=${isoUtc(signed)}, ` +
        `validFrom=${isoUtc(validFrom)}, validUntil=${isoUtc(validUntil)}`,
    );
    // Upper bound: signing after the cert expired is always rejected.
    if (signed > leaf.notAfter) {
      reject(
        `MSO signed after certificate expiry ` +
          `(signed ${isoUtc(signed)} > leaf notAfter ${isoUtc(leaf.notAfter)})`,
      );
    }
    // Lower bound: signing before the cert's notBefore. Benign (issuer stamps
    // `signed` at midnight of the issuance day; cert-rollover stragglers can
    // predate notBefore). Reject only in strict mode; otherwise warn + accept.
    if (signed < leaf.notBefore) {
      if (opts.strictSignedCertWindow) {
        reject(
          `MSO signed before certificate validity ` +
            `(signed ${isoUtc(signed)} < leaf notBefore ${isoUtc(leaf.notBefore)})`,
        );
      }
      dbg(
        `WARNING: MSO signed ${isoUtc(signed)} is before leaf notBefore ` +
          `${isoUtc(leaf.notBefore)} — accepted (lenient mode; issuer timestamp artifact)`,
      );
    }
    if (now + skew < validFrom) {
      reject(`attestation not yet valid (now ${isoUtc(now)} < validFrom ${isoUtc(validFrom)})`);
    }
    if (now - skew > validUntil) {
      reject(`attestation expired (now ${isoUtc(now)} > validUntil ${isoUtc(validUntil)})`, 'expired');
    }

    // §4.3 digest check + capture every disclosed age_over_NN flag
    const valueDigests = getMap(msoMap, 'valueDigests', 'MSO');
    const nsDigests = valueDigests.get(POA_NAMESPACE);
    if (!(nsDigests instanceof Map)) reject('valueDigests missing PoA namespace');

    const nameSpaces = getMap(issuerSigned, 'nameSpaces', 'IssuerSigned');
    const items = nameSpaces.get(POA_NAMESPACE);
    if (!Array.isArray(items)) reject('IssuerSigned namespace not an array');

    const ageOver: Record<number, boolean> = {};
    for (const item of items as unknown[]) {
      if (!(item instanceof CborTag) || item.tag !== 24) {
        reject('IssuerSignedItem not a #6.24 tag');
      }
      const tag = item as CborTag;
      const digest = sha256(tag.encoded); // hash raw bytes, per §7.3
      // #6.24 wraps a bstr whose content is the CBOR IssuerSignedItem.
      if (!(tag.value instanceof Uint8Array)) reject('IssuerSignedItem not bstr');
      const itemMap = cborDecode(tag.value as Uint8Array);
      if (!(itemMap instanceof Map)) reject('IssuerSignedItem not a map');
      const digestId = getNum(itemMap as CborMap, 'digestID', 'IssuerSignedItem');
      const expected = (nsDigests as Map<number, unknown>).get(digestId);
      if (!(expected instanceof Uint8Array) || !bytesEqual(digest, expected)) {
        reject(`digest mismatch for digestID ${digestId}`);
      }
      const id = (itemMap as CborMap).get('elementIdentifier');
      dbg(`disclosed item: digestID=${digestId}, id='${String(id)}' (digest OK)`);
      if (typeof id === 'string' && id.startsWith(AGE_OVER_PREFIX)) {
        const n = Number(id.slice(AGE_OVER_PREFIX.length));
        const val = (itemMap as CborMap).get('elementValue');
        if (typeof val !== 'boolean') reject(`${id} is not a boolean`);
        if (Number.isInteger(n)) ageOver[n] = val as boolean;
      }
    }

    // §4.5 device signature (proof of live possession + anti-replay binding)
    const deviceKeyInfo = getMap(msoMap, 'deviceKeyInfo', 'MSO');
    const deviceKey = coseKeyToPublicKey(deviceKeyInfo.get('deviceKey'));
    const deviceAuth = getMap(deviceSigned, 'deviceAuth', 'DeviceSigned');
    const deviceCose = parseCoseSign1(deviceAuth.get('deviceSignature'));
    assertEs256(deviceCose);
    const { deviceAuthenticationBytes } = buildDeviceAuthenticationBytes(
      payload.mnonce,
      payload.nbf,
      payload.exp,
      docType,
    );
    if (
      !verifyCoseSign1(deviceCose, deviceKey, {
        detachedPayload: deviceAuthenticationBytes,
      })
    ) {
      reject('device signature invalid');
    }
    dbg('device signature OK');

    // §4.6 anti-replay
    if (opts.seenNonces) {
      if (opts.seenNonces.has(payload.mnonce)) reject('replayed presentation');
      opts.seenNonces.add(payload.mnonce);
    }

    // §4.7 hand the disclosed age flags back; the age policy lives in the UI.
    dbg(`disclosed ages: ${JSON.stringify(ageOver)} -> bracket ${ageBracket(ageOver)}`);
    return { kind: 'verified', ageOver, mnonce: payload.mnonce };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = err instanceof RejectError ? err.code : 'invalid';
    dbg(`REJECTED (${code}): ${msg}`);
    return { kind: 'rejected', reason: msg, code };
  }
}

/** Convenience: assemble Q (already done) then decode + validate. */
export function validateAssembled(
  Q: Uint8Array,
  opts: ValidateOptions = {},
): ValidationOutcome {
  let payload: QRPayload;
  try {
    payload = decodeQRPayload(Q);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { kind: 'rejected', reason: msg, code: 'invalid' };
  }
  return validatePayload(payload, opts);
}

export { bytesToBase64url };
