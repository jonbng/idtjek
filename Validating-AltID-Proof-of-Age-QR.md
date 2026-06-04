# Validating an AltID Proof-of-Age QR → "over 18?" (true/false)

A language-agnostic reference for building a **Signed QR** validator that scans a
user's AltID Proof-of-Age (PoA) presentation and returns a single boolean:
**is the user 18 or older?**

This covers only the *proximity / in-person Signed QR* flow with the PoA
attestation. It does **not** cover OID4VP, PID, or online flows.

---

## 0. What you're actually validating (and why you can't skip it)

The QR is a self-contained, cryptographically signed credential. The value of the
whole system is that the data is **verifiable** — without the signature checks,
anyone could fabricate a QR that says `age_over_18: true`. So the cryptography
*is* the product. Reading the number out of the CBOR is the easy 5%.

Two independent signatures protect every presentation:

1. **Issuer signature** — proves the data was issued by the Danish authority
   (Digitaliseringsstyrelsen) and hasn't been modified.
2. **Device signature** — proves the credential is being presented *right now* by
   the phone that owns it, bound to this specific QR (anti-replay).

You must verify **both**.

### The good news for PoA specifically

- **Fully offline.** PoA has no revocation/status list, so no network is required.
- **One trusted certificate.** You only need to trust the AltID issuer cert.
- **No registration.** Signed QR needs no Relying Party Registry entry or OCES cert.

So this can be a self-contained app with no backend.

---

## 1. Prerequisites

You need libraries for:

| Capability | Purpose |
|---|---|
| **CBOR** decode/encode | All data is CBOR (binary). You must also *re-encode* items to recompute digests. |
| **COSE_Sign1** verify | Both signatures are COSE_Sign1 structures. |
| **ECDSA P-256 / SHA-256 (ES256)** | The signature algorithm used everywhere (`alg = -7`). |
| **X.509** chain building | To validate the issuer certificate against your trust anchor (RFC 5280). |
| **Base64URL** | QR parts and the nonce are Base64URL-encoded. |

Critical detail: your CBOR library must preserve **tag #6.24** (`bstr .cbor …`,
"encoded CBOR data item") and **deterministic/canonical encoding**, because you
re-encode structures to recompute hashes. Getting the bytes wrong → digest
mismatch even when the data is correct.

### Trust anchor (the issuer certificate)

You trust the **AltID Credential Issuer** certificate. Source it from AltID's
"Technical Integration" document, Appendix G, Table 13 (or the EU Age Verification
Trusted List, filtered to TSP `NTRDK-34051178`):

- **Production** subject: `CN = DKTB Credential Issuer, O = Digitaliseringsstyrelsen, C = DK` (chains under `Buypass Class 3 CA G2 ST Business`).
- **Test** subject: `CN = DKTB Credential Issuer, O = Digitaliseringsstyrelsen, OU = KEA, C = DK` (self-signed `DKTB Issuing CA`).

Issuer certificates are **leaf certs that rotate**. New ones are published at least
3 months before use, so make your trust list **configurable/updatable**, not
hard-baked into a release you can't change.

---

## 2. The QR transport: assembling multipart parts

The phone displays several QR codes in a fast loop. Each one decodes (after
Base64URL) to a CBOR map:

```
PartialQRPayload = {
  "typ":  tstr,   ; "AltID-<version>", e.g. "AltID-1.0"
  "txn":  tstr,   ; transaction id — identifies which payload these parts belong to
  "idx":  uint,   ; index of this part (0-based)
  "cnt":  uint,   ; total number of parts
  "part": bstr    ; this part's slice of the full payload
}
```

**Assembly algorithm:**

1. Scan parts. Group them by `txn`.
2. Keep collecting until you have every `idx` from `0` to `cnt - 1`.
3. If `txn` ever changes mid-scan, **discard everything and start over** (the user
   re-generated the QR).
4. Concatenate the `part` byte strings **in `idx` order** → a single byte array `Q`.

`Q` is itself CBOR. Decode it into the `QRPayload`.

---

## 3. The assembled payload

```
QRPayload = {
  "typ":    tstr,   ; "AltID-1.0"
  "txn":    tstr,   ; transaction id
  "mnonce": tstr,   ; mdocGeneratedNonce — Base64URL of 16 random bytes
  "nbf":    uint,   ; validFrom  (Unix seconds)
  "exp":    uint,   ; validTo    (Unix seconds)
  "doc":    bstr    ; CBOR-encoded mdoc Document (the actual credential)
}
```

CBOR-decode `doc` into the mdoc `Document`:

```
Document = {
  "docType":      tstr,           ; "eu.europa.ec.av.1" for PoA
  "issuerSigned": IssuerSigned,   ; issuer-signed data + MSO
  "deviceSigned": DeviceSigned    ; device signature over the session
}

IssuerSigned = {
  "nameSpaces": { "eu.europa.ec.av.1": [ +IssuerSignedItemBytes ] },
  "issuerAuth": COSE_Sign1        ; signs the MSO (Mobile Security Object)
}

IssuerSignedItemBytes = #6.24(bstr .cbor IssuerSignedItem)
IssuerSignedItem = {
  "digestID":          uint,
  "random":            bstr,
  "elementIdentifier": tstr,      ; e.g. "age_over_18"
  "elementValue":      any        ; e.g. true
}
```

The **MSO** (inside `issuerAuth`'s payload) contains:

- `valueDigests` — per-namespace map of `digestID → SHA-256 digest` of each item.
- `deviceKeyInfo.deviceKey` — the COSE public key used to verify the device signature.
- `docType` — must equal the `Document.docType`.
- `validityInfo` — `signed`, `validFrom`, `validUntil`.
- *(PoA has no `status` element — skip revocation entirely.)*

---

## 4. Validation steps

Perform these in order. Any failure ⇒ **reject** (do not show a result).

### 4.1 Payload sanity & freshness
1. `typ == "AltID-1.0"`.
2. `nbf` and `exp` are integers; build timestamps `validFrom`, `validTo`.
3. `now >= validFrom` (allow ~60s clock skew).
4. `now <= validTo` (allow ~60s clock skew).
5. *(Recommended)* reject if `validTo - validFrom` exceeds a sane max (reference uses 3 min).
6. `mnonce` Base64URL-decodes to exactly **16 bytes**.

### 4.2 Issuer trust & signature
7. Extract the issuer certificate chain from `issuerAuth`'s **unprotected header,
   label 33** (`x5chain`). It may be a single `bstr` *or* an array of `bstr` —
   support both. The leaf (issuer/signing cert) is first.
8. Build/validate the chain (RFC 5280) and confirm it terminates at **your trusted
   AltID issuer certificate**. Use a mature X.509 library — do not hand-roll chain
   building.
9. Verify the `issuerAuth` **COSE_Sign1** (ES256) over the MSO bytes, using the
   public key from the leaf certificate.
10. Confirm the MSO's `validityInfo.signed` falls within the leaf certificate's own
    validity window.

### 4.3 Bind disclosed data to the signature (digest check)
11. For **each** disclosed `IssuerSignedItem`:
    - Re-encode it **with its `#6.24` tag** exactly as transmitted.
    - Compute `SHA-256` of those bytes.
    - Look up the expected digest in `MSO.valueDigests["eu.europa.ec.av.1"][digestID]`.
    - They must be **equal**. (This is what makes selective disclosure trustworthy.)

### 4.4 Document consistency & temporal validity
12. `Document.docType == MSO.docType == "eu.europa.ec.av.1"`.
13. `MSO.validityInfo.validFrom <= now <= MSO.validityInfo.validUntil`.

### 4.5 Device signature (proof of live possession + anti-replay binding)
14. Reconstruct the **SessionTranscript** for Signed QR:
    ```
    SessionTranscript = [
      null,                         ; DeviceEngagementBytes — always null here
      null,                         ; EReaderKeyBytes       — always null here
      [ mnonce, nbf, exp ]          ; SignedQRHandover
    ]
    ```
15. Build the detached payload (it is transmitted as `null`, so you must rebuild it):
    ```
    DeviceAuthentication = [
      "DeviceAuthentication",
      SessionTranscript,
      docType,                      ; "eu.europa.ec.av.1"
      #6.24(bstr .cbor {})          ; tagged, CBOR-encoded EMPTY map
    ]
    DeviceAuthenticationBytes = #6.24(bstr .cbor DeviceAuthentication)
    ```
16. Verify the `deviceSigned.deviceAuth.deviceSignature` **COSE_Sign1** (ES256),
    using `DeviceAuthenticationBytes` as the external/detached payload and the
    **public key from `MSO.deviceKeyInfo.deviceKey`**. (Note: the COSE signature is
    raw `r||s`, 64 bytes — convert to DER if your verify API expects DER.)

### 4.6 Anti-replay (recommended for door/till scanning)
17. Keep an in-memory set of `mnonce` values you've already accepted (you may evict
    entries once their `validTo` has passed). If this `mnonce` is already in the
    set ⇒ reject as a replay. Otherwise add it. This stops someone re-showing a
    screenshot of a valid presentation.

### 4.7 The business decision
18. Find the disclosed item with `elementIdentifier == "age_over_18"`.
    - If present and `elementValue == true` ⇒ **return TRUE**.
    - If present and `elementValue == false` ⇒ **return FALSE**.
    - If **not present**, the user did not disclose it — you cannot infer it.
      Treat as "no over-18 proof shared; ask them to share it." (See gotcha below.)

---

## 5. Reference pseudocode

```text
function validateOver18(scannedQrFrames) -> Result<bool>:
    Q      = assembleMultipart(scannedQrFrames)          # §2
    payload = cborDecode(Q)                              # QRPayload §3

    assert payload.typ == "AltID-1.0"
    assertWithinWindow(now, payload.nbf, payload.exp, skew=60s)   # §4.1
    assert base64UrlDecode(payload.mnonce).length == 16

    doc = cborDecode(payload.doc)                        # Document §3
    mso = parseMSO(doc.issuerSigned.issuerAuth)

    chain = readX5Chain(doc.issuerSigned.issuerAuth)     # COSE header 33 §4.2
    assert validateChainToTrustAnchor(chain, TRUSTED_ISSUER_CERTS)
    assert verifyCoseSign1(doc.issuerSigned.issuerAuth, chain.leaf.publicKey)
    assert mso.validityInfo.signed within chain.leaf.validity

    for item in doc.issuerSigned.nameSpaces["eu.europa.ec.av.1"]:   # §4.3
        digest = sha256(cborEncodeTagged24(item))
        assert digest == mso.valueDigests["eu.europa.ec.av.1"][item.digestID]

    assert doc.docType == mso.docType == "eu.europa.ec.av.1"        # §4.4
    assert mso.validityInfo.validFrom <= now <= mso.validityInfo.validUntil

    transcript = [null, null, [payload.mnonce, payload.nbf, payload.exp]]   # §4.5
    devAuthBytes = cborEncodeTagged24(
        ["DeviceAuthentication", transcript, doc.docType, cborEncodeTagged24({})]
    )
    assert verifyCoseSign1Detached(
        doc.deviceSigned.deviceAuth.deviceSignature,
        externalPayload = devAuthBytes,
        publicKey       = mso.deviceKeyInfo.deviceKey)

    assert payload.mnonce not in SEEN_NONCES                        # §4.6
    SEEN_NONCES.add(payload.mnonce)

    item = findItem(doc, "age_over_18")                             # §4.7
    if item is None: return Error("over-18 proof not shared")
    return Ok(item.elementValue == true)
```

---

## 6. Gotchas

- **The user chooses what to disclose.** In Signed QR (unlike OID4VP) you cannot
  *request* specific attributes. Instruct the person to share their over-18 proof;
  your app reads `age_over_18` if it's present. Plan a clear "nothing relevant was
  shared" path.
- **CBOR canonicalization matters.** Digest and signature checks compare raw bytes.
  Use deterministic encoding and preserve `#6.24` tags exactly, or correct data
  will still fail.
- **Detached payloads.** Both the issuer and device signatures sign data that is
  *not* sent inline (the device `DeviceAuthentication` is transmitted as `null`).
  You must reconstruct those bytes before verifying.
- **Raw vs DER signatures.** COSE signatures are `r||s` (64 bytes). Many verify APIs
  expect DER-encoded ECDSA; convert if needed.
- **Clock skew.** Allow ~60s on temporal checks; the QR's own validity window is
  very short by design.
- **Trust list updates.** Issuer certs rotate. Don't hard-bake a single cert you
  can't update; support multiple trust anchors.
- **Fail closed.** Any parse/verify failure must show "not verified," never a
  permissive default.

---

## 7. Scope notes

- This document targets **PoA over Signed QR** only. Because PoA carries no status
  list, step 4.x for revocation is intentionally absent and the whole flow works
  offline.
- If you later need **online** age checks or **identity (PID)** data, that's a
  different protocol (OID4VP, profiles [AVP]/[HAIP]) with a required server-side
  endpoint and (for PID) Relying Party Registry registration.
