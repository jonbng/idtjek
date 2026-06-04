/**
 * AltID Proof-of-Age "Signed QR" validator — public surface.
 *
 * Offline, self-contained verification of an AltID PoA presentation, answering
 * a single question: is the presenter 18 or older? Implements the Signed-QR
 * flow of the AltID Technical Integration spec (Appendix A/B/C/G).
 */
export {
  ALTID_TYP,
  POA_DOCTYPE,
  POA_NAMESPACE,
  AGE_OVER_18,
  AGE_OVER_PREFIX,
  ageBracket,
  hasAgeProof,
  MultipartAssembler,
  decodeQRPayload,
  validatePayload,
  validateAssembled,
  buildDeviceAuthenticationBytes,
  type ValidateOptions,
  type ValidationOutcome,
  type AgeBracket,
  type RejectCode,
  type QRPayload,
} from './validate';
export {
  defaultTrustList,
  buildTrustList,
  findTrustAnchor,
  pemToDer,
  TEST_ISSUER_CERT_PEM,
  PROD_ISSUER_CERT_PEM,
  type TrustAnchor,
} from './trust';
export { runSelfTest, type SelfTestResult, type SelfTestCheck } from './selfTest';
