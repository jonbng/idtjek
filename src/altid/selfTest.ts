/**
 * Self-test: runs the validator against the official Appendix C test vector and
 * verifies each cryptographic building block against the spec's stated expected
 * values (device-auth bytes, session transcript, digest), then the end-to-end
 * "over 18?" decision.
 *
 * This is what lets us trust the validator without a live phone: if these pass,
 * the CBOR encoding, COSE signature verification (issuer + device) and digest
 * binding are all byte-correct.
 */
import { sha256 } from '@noble/hashes/sha2.js';

import { bytesToBase64url, bytesToHex } from './bytes';
import { CborTag, cborDecode } from './cbor';
import { defaultTrustList } from './trust';
import { POA_DOCTYPE, POA_NAMESPACE } from './validate';
import {
  buildDeviceAuthenticationBytes,
  decodeQRPayload,
  MultipartAssembler,
  validateAssembled,
  validatePayload,
  type QRPayload,
} from './validate';
import { VECTOR, vectorDocBytes } from './testVector';

export interface SelfTestCheck {
  name: string;
  pass: boolean;
  detail?: string;
}
export interface SelfTestResult {
  pass: boolean;
  checks: SelfTestCheck[];
}

function payloadFromVector(): QRPayload {
  return {
    typ: VECTOR.typ,
    txn: VECTOR.txn,
    mnonce: VECTOR.mnonce,
    nbf: VECTOR.nbf,
    exp: VECTOR.exp,
    doc: vectorDocBytes(),
  };
}

export function runSelfTest(): SelfTestResult {
  const checks: SelfTestCheck[] = [];
  const add = (name: string, pass: boolean, detail?: string) =>
    checks.push({ name, pass, detail });

  // 1. Multipart assembly reproduces the documented Document bytes.
  try {
    const asm = new MultipartAssembler();
    let Q: Uint8Array | null = null;
    for (const frame of VECTOR.qrParts) {
      Q = asm.addFrame(frame) ?? Q;
    }
    if (!Q) {
      add('multipart assembly', false, 'frames did not assemble');
    } else {
      const payload = decodeQRPayload(Q);
      const ok = bytesToHex(payload.doc) === VECTOR.docHex;
      add('multipart assembly -> doc bytes', ok, ok ? undefined : 'doc mismatch');
    }
  } catch (e) {
    add('multipart assembly', false, String(e));
  }

  // 2. SessionTranscript + DeviceAuthenticationBytes match the spec exactly.
  const { sessionTranscript, deviceAuthenticationBytes } =
    buildDeviceAuthenticationBytes(
      VECTOR.mnonce,
      VECTOR.nbf,
      VECTOR.exp,
      POA_DOCTYPE,
    );
  add(
    'SessionTranscript encoding',
    bytesToBase64url(sessionTranscript) === VECTOR.expected.sessionTranscriptB64u,
    bytesToBase64url(sessionTranscript),
  );
  add(
    'DeviceAuthenticationBytes encoding',
    bytesToBase64url(deviceAuthenticationBytes) ===
      VECTOR.expected.deviceAuthBytesB64u,
    bytesToBase64url(deviceAuthenticationBytes),
  );

  // 3. age_over_18 IssuerSignedItem digest matches the documented hash.
  try {
    const doc = cborDecode(vectorDocBytes()) as Map<string, unknown>;
    const issuerSigned = doc.get('issuerSigned') as Map<string, unknown>;
    const nameSpaces = issuerSigned.get('nameSpaces') as Map<string, unknown>;
    const items = nameSpaces.get(POA_NAMESPACE) as CborTag[];
    const item = items[0];
    const digestHex = bytesToHex(sha256(item.encoded));
    add(
      'age_over_18 digest (SHA-256 of IssuerSignedItemBytes)',
      digestHex === VECTOR.expected.ageDigestHex,
      digestHex,
    );
    add(
      'IssuerSignedItemBytes encoding',
      bytesToBase64url(item.encoded) === VECTOR.expected.issuerItemB64u,
      bytesToBase64url(item.encoded),
    );
  } catch (e) {
    add('age_over_18 digest', false, String(e));
  }

  // 3b. Trust list parses both the test and production issuer certs.
  try {
    const anchors = defaultTrustList();
    add(
      'trust list loads test + production certs',
      anchors.length === 2,
      anchors.map((a) => a.label).join(' | '),
    );
  } catch (e) {
    add('trust list loads test + production certs', false, String(e));
  }

  // 4. End-to-end: full pipeline verifies and discloses age_over_18 = true.
  const outcome = validatePayload(payloadFromVector(), { now: VECTOR.now });
  add(
    'end-to-end validatePayload -> verified, age_over_18 true',
    outcome.kind === 'verified' && outcome.ageOver[18] === true,
    JSON.stringify(outcome),
  );

  // 5. Fail-closed: an expired clock must be rejected.
  const expired = validatePayload(payloadFromVector(), {
    now: VECTOR.exp + 10_000,
  });
  add(
    'fail-closed on expired clock',
    expired.kind === 'rejected',
    JSON.stringify(expired),
  );

  // 6. Replay protection rejects the second presentation of the same mnonce.
  const seen = new Set<string>();
  const first = validateAssembled(buildVectorQ(), { now: VECTOR.now, seenNonces: seen });
  const second = validateAssembled(buildVectorQ(), { now: VECTOR.now, seenNonces: seen });
  add(
    'replay protection',
    first.kind === 'verified' && second.kind === 'rejected',
    JSON.stringify({ first: first.kind, second: second.kind }),
  );

  return { pass: checks.every((c) => c.pass), checks };
}

// Helper: assemble Q from the vector frames (for replay test).
function buildVectorQ(): Uint8Array {
  const asm = new MultipartAssembler();
  let Q: Uint8Array | null = null;
  for (const frame of VECTOR.qrParts) Q = asm.addFrame(frame) ?? Q;
  if (!Q) throw new Error('vector frames did not assemble');
  return Q;
}
