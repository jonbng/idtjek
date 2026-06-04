/**
 * Trust list for AltID issuer (leaf) certificates.
 *
 * Per Appendix G / Table 13 of the AltID Technical Integration spec, the issuer
 * SIGNING certificate is published directly. AltID issuer certs are leaf certs
 * that rotate (new ones published >= 3 months ahead), so this list is meant to
 * be updatable rather than hard-baked. Add new certs by appending their PEM.
 *
 * Trust is established by matching the presented leaf's SubjectPublicKeyInfo
 * against a trusted certificate's SPKI — i.e. "the signing certificate is
 * included as a leaf in the trust list" (§11.2, first bullet).
 */
import { base64ToBytes, bytesEqual } from './bytes';
import { parseCertificate, type ParsedCertificate } from './x509';

/**
 * TEST / DEVELOPMENT issuer certificate.
 * Subject: CN=DKTB Credential Issuer, OU=KEA, O=Digitaliseringsstyrelsen, C=DK
 * Issuer:  CN=DKTB Issuing CA (self-signed test CA)
 * Validity: 2025-06-18 .. 2026-06-18
 * (Appendix G, Table 13 — verified to match the worked example's signing cert.)
 */
export const TEST_ISSUER_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIICSjCCAfCgAwIBAgIUQkfIkGJcupTqa/SxzW0Bl4Nsvc8wCgYIKoZIzj0EAwIw
bTELMAkGA1UEBhMCREsxEzARBgNVBAcMCkvDuGJlbmhhdm4xITAfBgNVBAoMGERp
Z2l0YWxpc2VyaW5nc3N0eXJlbHNlbjEMMAoGA1UECwwDS0VBMRgwFgYDVQQDDA9E
S1RCIElzc3VpbmcgQ0EwHhcNMjUwNjE4MTQyMzUxWhcNMjYwNjE4MTQyMzUxWjB0
MQswCQYDVQQGEwJESzETMBEGA1UEBwwKS8O4YmVuaGF2bjEhMB8GA1UECgwYRGln
aXRhbGlzZXJpbmdzc3R5cmVsc2VuMQwwCgYDVQQLDANLRUExHzAdBgNVBAMMFkRL
VEIgQ3JlZGVudGlhbCBJc3N1ZXIwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAASk
cFWfqRC7lkqfNIWs8st8dcRfpnFaWF8RLkxRuw4zE94UTPTM85Au8lTbvwz6YEdw
kXVlTLb3ipizsPY9pwgfo2cwZTAOBgNVHQ8BAf8EBAMCB4AwHwYDVR0jBBgwFoAU
oilV6fVKVDaabt5bENewEOCW/eIwHQYDVR0OBBYEFDBSgAQiJexB83Ztwvdz+4oV
SfK0MBMGA1UdJQQMMAoGCCsGAQUFBwMDMAoGCCqGSM49BAMCA0gAMEUCIQDPpwbK
K2AMdBgF+fzuRbZbDiwnIlqBM/aISWphztDJrAIgFSpBYc80VHH+moVgleRVDF6j
OVVa9OU4/8ycPedTkrA=
-----END CERTIFICATE-----`;

/**
 * PRODUCTION issuer certificate.
 * Subject: CN=DKTB Credential Issuer, O=Digitaliseringsstyrelsen, C=DK
 * Issuer:  CN=Buypass Class 3 CA G2 ST Business
 * Validity: 2026-05-06 .. 2029-05-06
 * (Appendix G, Table 13 / EU AV Trusted List; full PEM from certs/.)
 */
export const PROD_ISSUER_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIE4zCCAsugAwIBAgILAIkoDoOVN9UH98YwDQYJKoZIhvcNAQELBQAwaDELMAkG
A1UEBhMCTk8xGDAWBgNVBGEMD05UUk5PLTk4MzE2MzMyNzETMBEGA1UECgwKQnV5
cGFzcyBBUzEqMCgGA1UEAwwhQnV5cGFzcyBDbGFzcyAzIENBIEcyIFNUIEJ1c2lu
ZXNzMB4XDTI2MDUwNjA2MjUwMFoXDTI5MDUwNjIxNTkwMFowajELMAkGA1UEBhMC
REsxITAfBgNVBAoMGERpZ2l0YWxpc2VyaW5nc3N0eXJlbHNlbjEfMB0GA1UEAwwW
REtUQiBDcmVkZW50aWFsIElzc3VlcjEXMBUGA1UEYQwOTlRSREstMzQwNTExNzgw
WTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAAScQ6FXAvi8bFamKzXHrTk5WKgOxMLD
B84Xw/1OGLVmHka1b7eTwlHkJQWcmKy7bsNIzVSf3BT7PBis+qWmFH3so4IBVTCC
AVEwCQYDVR0TBAIwADAfBgNVHSMEGDAWgBSBRZwplWY4N+07VE6OMuWWIXnVZDAd
BgNVHQ4EFgQUStHjvRJJtxVPSfYGVGgtPGu6GrcwDgYDVR0PAQH/BAQDAgbAMB8G
A1UdIAQYMBYwCgYIYIRCARoBAwIwCAYGBACPegEBMDsGA1UdHwQ0MDIwMKAuoCyG
Kmh0dHA6Ly9jcmwuYnV5cGFzc2NhLmNvbS9CUENsM0NhRzJTVEJTLmNybDBvBggr
BgEFBQcBAQRjMGEwJwYIKwYBBQUHMAGGG2h0dHA6Ly9vY3NwYnMuYnV5cGFzc2Nh
LmNvbTA2BggrBgEFBQcwAoYqaHR0cDovL2NydC5idXlwYXNzY2EuY29tL0JQQ2wz
Q2FHMlNUQlMuY2VyMCUGCCsGAQUFBwEDBBkwFzAVBggrBgEFBQcLAjAJBgcEAIvs
SQECMA0GCSqGSIb3DQEBCwUAA4ICAQA0uIU7+0+ALt9IpuZAJBs16BPuuHkgXMGy
2tm2Q7g6lg3V+myqOMUH8/K1gpO1Xib4grrs66hbfBiaIpfDHWb0umJFem3l+gdz
Do69JdPP6d6y1VsQuoEDshedLs6ZZRE11kEjhaanmNiJkbfChKDj5Xb9X+XCMJ+/
q7IBdS367VQpvj1929oF8NbScsL99J/olWEKVzjqChADmkNp/PsBM9TX7B1WhGMW
QzEk7A/JtNBfuriM6E7jhadAafv7C1VfwfWt3Lmj7fj7q2tDseeuBAW9dUV2CjTU
80h9dtOF8rxWDIkf3o1m5Uds7SmxyKAFPevsiLA/hfYVkuT6X7tzHU9x3mJTaTOE
3flSxrSmSnpMX8euFZYncBcB+R9hC76AK6HNJayX3yDoRKYnPvo5AebRPIFwRk9b
3gRcVus1AS/FNWiDFeYZGxL/679/t3+85modcWAdgbdX1+FlHAZPZiOeU6e9ZytY
n+rMbYKMxdKqHXSV4FpkTzT/VrN5pAZ792WVlLI/oJ3Ix857HJ1SeaawVDoeP7pW
1H7hrQvffRQk7PvX3aecBrm651hYKFTcn4SrerCJC141mcKZqVjveJNbWtdOj73q
CcuRuHtsFbLBuPSm91H7Xo5ST78DBeuBD+AtuuW8Js31SApAJ1+Fx0yaeR6lDNOb
Vh74xYbdLA==
-----END CERTIFICATE-----`;

export interface TrustAnchor {
  label: string;
  cert: ParsedCertificate;
}

/** Strip PEM armour and Base64-decode to DER. */
export function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '');
  return base64ToBytes(body);
}

/** Build a trust list from PEM strings. Empty/blank entries are skipped. */
export function buildTrustList(
  entries: { label: string; pem: string }[],
): TrustAnchor[] {
  const out: TrustAnchor[] = [];
  for (const { label, pem } of entries) {
    if (!pem || !pem.trim()) continue;
    out.push({ label, cert: parseCertificate(pemToDer(pem)) });
  }
  return out;
}

/** The default trust list: test cert (plus prod, once its PEM is provided). */
export function defaultTrustList(): TrustAnchor[] {
  return buildTrustList([
    { label: 'AltID DKTB Credential Issuer (TEST)', pem: TEST_ISSUER_CERT_PEM },
    { label: 'AltID DKTB Credential Issuer (PROD)', pem: PROD_ISSUER_CERT_PEM },
  ]);
}

/**
 * Is `leaf` trusted? True iff its SubjectPublicKeyInfo matches a trust anchor.
 * Returns the matching anchor (so its validity window can be inspected).
 */
export function findTrustAnchor(
  leaf: ParsedCertificate,
  trustList: TrustAnchor[],
): TrustAnchor | null {
  for (const anchor of trustList) {
    if (bytesEqual(leaf.spki, anchor.cert.spki)) return anchor;
  }
  return null;
}
