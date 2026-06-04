/**
 * Tiny DER / X.509 reader, scoped to what the validator needs from an AltID
 * issuer (leaf) certificate:
 *   - the EC P-256 public key (to verify the issuer COSE signature),
 *   - the certificate validity window (to check MSO.signed falls inside it),
 *   - the SubjectPublicKeyInfo DER bytes (to match against the trust list).
 *
 * This is intentionally NOT a general-purpose chain builder. AltID publishes
 * the leaf signing certificate directly in its trust list (Appendix G, Table
 * 13), so trust here is established by matching the presented leaf's public key
 * against a trusted certificate — not by walking an RFC 5280 chain. If AltID
 * ever ships an intermediate-only trust anchor, this must be revisited.
 */

interface Tlv {
  tag: number;
  /** offset of the first (tag) byte */
  start: number;
  /** offset of the first content byte */
  contentStart: number;
  /** offset one past the last content byte */
  contentEnd: number;
}

export interface ParsedCertificate {
  /** Uncompressed EC point: 0x04 || X(32) || Y(32). */
  publicKey: Uint8Array;
  /** SubjectPublicKeyInfo, full DER (used for trust-list matching). */
  spki: Uint8Array;
  /** notBefore as Unix seconds (UTC). */
  notBefore: number;
  /** notAfter as Unix seconds (UTC). */
  notAfter: number;
}

function readTlv(buf: Uint8Array, pos: number): Tlv {
  if (pos + 1 >= buf.length) throw new Error('DER: truncated');
  const tag = buf[pos];
  const first = buf[pos + 1];
  let len: number;
  let contentStart: number;
  if (first < 0x80) {
    len = first;
    contentStart = pos + 2;
  } else {
    const n = first & 0x7f;
    if (n === 0 || n > 4) throw new Error('DER: unsupported length form');
    len = 0;
    for (let i = 0; i < n; i++) len = (len << 8) | buf[pos + 2 + i];
    contentStart = pos + 2 + n;
  }
  const contentEnd = contentStart + len;
  if (contentEnd > buf.length) throw new Error('DER: length exceeds buffer');
  return { tag, start: pos, contentStart, contentEnd };
}

function children(buf: Uint8Array, parent: Tlv): Tlv[] {
  const out: Tlv[] = [];
  let p = parent.contentStart;
  while (p < parent.contentEnd) {
    const t = readTlv(buf, p);
    out.push(t);
    p = t.contentEnd;
  }
  return out;
}

function parseTime(buf: Uint8Array, tlv: Tlv): number {
  let s = '';
  for (let i = tlv.contentStart; i < tlv.contentEnd; i++) {
    s += String.fromCharCode(buf[i]);
  }
  // 0x17 UTCTime: YYMMDDHHMMSSZ ; 0x18 GeneralizedTime: YYYYMMDDHHMMSSZ
  let year: number, rest: string;
  if (tlv.tag === 0x17) {
    const yy = parseInt(s.slice(0, 2), 10);
    year = yy < 50 ? 2000 + yy : 1900 + yy;
    rest = s.slice(2);
  } else if (tlv.tag === 0x18) {
    year = parseInt(s.slice(0, 4), 10);
    rest = s.slice(4);
  } else {
    throw new Error(`DER: unexpected time tag 0x${tlv.tag.toString(16)}`);
  }
  const month = parseInt(rest.slice(0, 2), 10);
  const day = parseInt(rest.slice(2, 4), 10);
  const hour = parseInt(rest.slice(4, 6), 10);
  const min = parseInt(rest.slice(6, 8), 10);
  const sec = parseInt(rest.slice(8, 10), 10);
  return Math.floor(Date.UTC(year, month - 1, day, hour, min, sec) / 1000);
}

/**
 * Parse an X.509 certificate (DER). Assumes an EC SubjectPublicKeyInfo, which
 * is what AltID issuer certs use (ECDSA P-256).
 */
export function parseCertificate(der: Uint8Array): ParsedCertificate {
  const cert = readTlv(der, 0); // Certificate ::= SEQUENCE
  const [tbs] = children(der, cert);
  const kids = children(der, tbs);

  // tbsCertificate ::= SEQUENCE {
  //   [0] version (optional), serialNumber, signature, issuer,
  //   validity, subject, subjectPublicKeyInfo, ... }
  const hasVersion = kids.length > 0 && kids[0].tag === 0xa0;
  const validityTlv = kids[hasVersion ? 4 : 3];
  const spkiTlv = kids[hasVersion ? 6 : 5];

  const [notBeforeTlv, notAfterTlv] = children(der, validityTlv);
  const notBefore = parseTime(der, notBeforeTlv);
  const notAfter = parseTime(der, notAfterTlv);

  // SubjectPublicKeyInfo ::= SEQUENCE { algorithm, subjectPublicKey BIT STRING }
  const spkiKids = children(der, spkiTlv);
  const bitString = spkiKids[1];
  if (bitString.tag !== 0x03) throw new Error('DER: SPKI missing BIT STRING');
  // BIT STRING content: first byte is the number of unused bits (0 here),
  // followed by the EC point 0x04 || X || Y.
  const publicKey = der.subarray(bitString.contentStart + 1, bitString.contentEnd);
  if (publicKey[0] !== 0x04) {
    throw new Error('DER: expected uncompressed EC point in SPKI');
  }

  const spki = der.subarray(spkiTlv.start, spkiTlv.contentEnd);
  return { publicKey: publicKey.slice(), spki: spki.slice(), notBefore, notAfter };
}
