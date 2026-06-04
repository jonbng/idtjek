/**
 * COSE_Sign1 (RFC 8152) verification for AltID — ES256 (ECDSA P-256 + SHA-256)
 * only, which is the single algorithm AltID uses (`alg = -7`).
 *
 * Supports both the attached issuer signature and the *detached* device
 * signature (where the payload is transmitted as `null` and must be supplied
 * externally).
 */
import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { CborTag, encArray, encBstr, encTstr, ENC_EMPTY_MAP } from './cbor';

const EMPTY = new Uint8Array(0);

export interface CoseSign1 {
  /** Protected header, as the raw encoded bstr (signed verbatim). */
  protectedHeader: Uint8Array;
  /** Unprotected header map (e.g. x5chain at label 33). */
  unprotected: Map<string | number, unknown>;
  /** Attached payload bstr, or null when detached. */
  payload: Uint8Array | null;
  /** Raw signature bytes (ECDSA r||s, 64 bytes for ES256). */
  signature: Uint8Array;
}

/** Parse a decoded COSE_Sign1 CBOR array into its four fields. */
export function parseCoseSign1(value: unknown): CoseSign1 {
  if (!Array.isArray(value) || value.length !== 4) {
    throw new Error('COSE: expected 4-element array');
  }
  const [prot, unprot, payload, sig] = value;
  if (!(prot instanceof Uint8Array)) throw new Error('COSE: bad protected header');
  if (!(unprot instanceof Map)) throw new Error('COSE: bad unprotected header');
  if (payload !== null && !(payload instanceof Uint8Array)) {
    throw new Error('COSE: bad payload');
  }
  if (!(sig instanceof Uint8Array)) throw new Error('COSE: bad signature');
  return {
    protectedHeader: prot,
    unprotected: unprot,
    payload,
    signature: sig,
  };
}

/**
 * Build the COSE Sig_structure for a COSE_Sign1 and verify the signature.
 *
 *   Sig_structure = [ "Signature1", body_protected, external_aad, payload ]
 *
 * @param publicKey  EC point (0x04||X||Y) or compressed point.
 * @param detachedPayload  Required when `cose.payload` is null.
 * @param externalAad  Defaults to empty (AltID uses no external AAD).
 */
export function verifyCoseSign1(
  cose: CoseSign1,
  publicKey: Uint8Array,
  opts: { detachedPayload?: Uint8Array; externalAad?: Uint8Array } = {},
): boolean {
  const payload = cose.payload ?? opts.detachedPayload;
  if (!payload) throw new Error('COSE: detached payload required');
  const externalAad = opts.externalAad ?? EMPTY;

  const sigStructure = encArray([
    encTstr('Signature1'),
    encBstr(cose.protectedHeader),
    encBstr(externalAad),
    encBstr(payload),
  ]);

  const digest = sha256(sigStructure);
  // prehash:false — `digest` is already the SHA-256 of the Sig_structure, so
  // noble must verify against it directly. (noble-curves v2 prehashes the
  // message by default; without this it would hash our digest a second time.)
  // lowS:false — accept signatures regardless of S normalisation; we are a
  // verifier and must not reject otherwise-valid issuer/device signatures.
  return p256.verify(cose.signature, digest, publicKey, {
    prehash: false,
    lowS: false,
  });
}

/**
 * Extract the x5chain (label 33) from a COSE unprotected header. Per the spec
 * this is either a single bstr (the issuer cert) or an array of bstr (chain,
 * leaf first). Returns the chain leaf-first.
 */
export function extractX5Chain(unprotected: Map<string | number, unknown>): Uint8Array[] {
  const v = unprotected.get(33);
  if (v instanceof Uint8Array) return [v];
  if (Array.isArray(v) && v.every((c) => c instanceof Uint8Array)) {
    return v as Uint8Array[];
  }
  throw new Error('COSE: missing or malformed x5chain (label 33)');
}

/** Decode a COSE_Key (EC2) map into an uncompressed EC point 0x04||X||Y. */
export function coseKeyToPublicKey(key: unknown): Uint8Array {
  if (!(key instanceof Map)) throw new Error('COSE_Key: not a map');
  const kty = key.get(1);
  const crv = key.get(-1);
  const x = key.get(-2);
  const y = key.get(-3);
  if (kty !== 2) throw new Error('COSE_Key: only EC2 (kty=2) supported');
  if (crv !== 1) throw new Error('COSE_Key: only P-256 (crv=1) supported');
  if (!(x instanceof Uint8Array) || !(y instanceof Uint8Array)) {
    throw new Error('COSE_Key: missing x/y coordinates');
  }
  const out = new Uint8Array(65);
  out[0] = 0x04;
  out.set(x, 1);
  out.set(y, 33);
  return out;
}

/** Verify the protected header advertises ES256 (`{1: -7}`). */
export function assertEs256(cose: CoseSign1): void {
  // The protected header is a CBOR map; for AltID it is exactly {1: -7},
  // encoded as a3? No — a1 01 26. We accept any header that maps alg(1) -> -7.
  const { protectedHeader } = cose;
  // Fast path for the canonical encoding {1:-7} = 0xa1 0x01 0x26.
  if (
    protectedHeader.length === 3 &&
    protectedHeader[0] === 0xa1 &&
    protectedHeader[1] === 0x01 &&
    protectedHeader[2] === 0x26
  ) {
    return;
  }
  throw new Error('COSE: unexpected protected header (expected ES256 {1:-7})');
}

// Re-export so consumers building DeviceAuthentication have the tag helper.
export { CborTag, ENC_EMPTY_MAP };
