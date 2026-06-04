/**
 * Minimal, dependency-free CBOR (RFC 8949) codec, scoped to exactly what the
 * AltID Signed-QR validator needs.
 *
 * Decoder: handles definite-length uints, negative ints, byte/text strings,
 * arrays, maps, tags and simple values (true/false/null). It deliberately
 * rejects indefinite-length items — AltID always uses definite lengths, and
 * accepting them would open canonicalisation gaps.
 *
 * Crucially, every CBOR *tag* item is returned as a {@link CborTag} that
 * carries the **raw encoded bytes** of the whole tagged item. This lets the
 * validator hash `IssuerSignedItemBytes` (a #6.24 tag) directly from the wire,
 * exactly as the spec recommends — no re-encoding, no canonicalisation risk.
 *
 * Encoder: a handful of explicit builders used to reconstruct the detached
 * COSE payloads (SessionTranscript / DeviceAuthentication) and the COSE
 * Sig_structure. Everything is definite-length / shortest-form.
 */
import { bytesToUtf8, concatBytes, utf8ToBytes } from './bytes';

export class CborTag {
  constructor(
    readonly tag: number,
    readonly value: unknown,
    /** Raw encoded bytes of the entire tagged item (tag + content). */
    readonly encoded: Uint8Array,
  ) {}
}

export type CborMap = Map<string | number, unknown>;

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

class Reader {
  pos = 0;
  constructor(readonly buf: Uint8Array) {}

  private u8(): number {
    if (this.pos >= this.buf.length) throw new Error('CBOR: unexpected end');
    return this.buf[this.pos++];
  }

  private readArg(ai: number): number | bigint {
    if (ai < 24) return ai;
    if (ai === 24) return this.u8();
    if (ai === 25) return (this.u8() << 8) | this.u8();
    if (ai === 26) {
      const v = this.u8() * 0x1000000 + (this.u8() << 16) + (this.u8() << 8) + this.u8();
      return v;
    }
    if (ai === 27) {
      let v = 0n;
      for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(this.u8());
      return v <= MAX_SAFE ? Number(v) : v;
    }
    throw new Error(`CBOR: unsupported additional info ${ai}`);
  }

  private asLen(arg: number | bigint): number {
    const n = typeof arg === 'bigint' ? Number(arg) : arg;
    if (!Number.isSafeInteger(n) || n < 0) throw new Error('CBOR: bad length');
    return n;
  }

  decode(): unknown {
    const start = this.pos;
    const ib = this.u8();
    const major = ib >> 5;
    const ai = ib & 0x1f;

    switch (major) {
      case 0: // unsigned int
        return this.readArg(ai);
      case 1: { // negative int
        const arg = this.readArg(ai);
        return typeof arg === 'bigint' ? -1n - arg : -1 - arg;
      }
      case 2: { // byte string
        if (ai === 31) throw new Error('CBOR: indefinite bstr not supported');
        const len = this.asLen(this.readArg(ai));
        const out = this.buf.subarray(this.pos, this.pos + len);
        if (out.length !== len) throw new Error('CBOR: truncated bstr');
        this.pos += len;
        return out;
      }
      case 3: { // text string
        if (ai === 31) throw new Error('CBOR: indefinite tstr not supported');
        const len = this.asLen(this.readArg(ai));
        const slice = this.buf.subarray(this.pos, this.pos + len);
        if (slice.length !== len) throw new Error('CBOR: truncated tstr');
        this.pos += len;
        return bytesToUtf8(slice);
      }
      case 4: { // array
        if (ai === 31) throw new Error('CBOR: indefinite array not supported');
        const len = this.asLen(this.readArg(ai));
        const arr = new Array(len);
        for (let i = 0; i < len; i++) arr[i] = this.decode();
        return arr;
      }
      case 5: { // map
        if (ai === 31) throw new Error('CBOR: indefinite map not supported');
        const len = this.asLen(this.readArg(ai));
        const map: CborMap = new Map();
        for (let i = 0; i < len; i++) {
          const k = this.decode();
          const v = this.decode();
          if (typeof k !== 'string' && typeof k !== 'number') {
            throw new Error('CBOR: unsupported map key type');
          }
          map.set(k, v);
        }
        return map;
      }
      case 6: { // tag
        const tag = this.asLen(this.readArg(ai));
        const value = this.decode();
        const encoded = this.buf.subarray(start, this.pos);
        return new CborTag(tag, value, encoded);
      }
      case 7: // simple / float
        if (ai === 20) return false;
        if (ai === 21) return true;
        if (ai === 22) return null;
        if (ai === 23) return undefined;
        throw new Error(`CBOR: unsupported simple/float ${ai}`);
      default:
        throw new Error(`CBOR: unknown major type ${major}`);
    }
  }
}

/** Decode a single CBOR item from `buf`. Extra trailing bytes are ignored. */
export function cborDecode(buf: Uint8Array): unknown {
  return new Reader(buf).decode();
}

// ---------------------------------------------------------------------------
// Encoder (shortest-form, definite length) — only the shapes we need.
// ---------------------------------------------------------------------------

function encHead(major: number, n: number): Uint8Array {
  const m = major << 5;
  if (n < 24) return Uint8Array.of(m | n);
  if (n < 0x100) return Uint8Array.of(m | 24, n);
  if (n < 0x10000) return Uint8Array.of(m | 25, (n >> 8) & 0xff, n & 0xff);
  if (n < 0x100000000) {
    return Uint8Array.of(
      m | 26,
      (n >>> 24) & 0xff,
      (n >>> 16) & 0xff,
      (n >>> 8) & 0xff,
      n & 0xff,
    );
  }
  // 64-bit
  const hi = Math.floor(n / 0x100000000);
  const lo = n >>> 0;
  return Uint8Array.of(
    m | 27,
    (hi >>> 24) & 0xff,
    (hi >>> 16) & 0xff,
    (hi >>> 8) & 0xff,
    hi & 0xff,
    (lo >>> 24) & 0xff,
    (lo >>> 16) & 0xff,
    (lo >>> 8) & 0xff,
    lo & 0xff,
  );
}

export function encUint(n: number): Uint8Array {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('encUint: bad value');
  return encHead(0, n);
}

export function encBstr(bytes: Uint8Array): Uint8Array {
  return concatBytes(encHead(2, bytes.length), bytes);
}

export function encTstr(str: string): Uint8Array {
  const b = utf8ToBytes(str);
  return concatBytes(encHead(3, b.length), b);
}

export function encArray(items: Uint8Array[]): Uint8Array {
  return concatBytes(encHead(4, items.length), ...items);
}

export const ENC_NULL = Uint8Array.of(0xf6);
/** CBOR encoding of an empty map: 0xa0. */
export const ENC_EMPTY_MAP = Uint8Array.of(0xa0);

/** #6.24(bstr .cbor inner) — tag 24 wrapping a byte string of `inner`. */
export function encTag24(inner: Uint8Array): Uint8Array {
  return concatBytes(encHead(6, 24), encBstr(inner));
}
