# Threat Model — Portable Health Agent

**Date:** 2026-05-02 · **Scope:** Hackathon MVP (Flow A + B)

## Assets
- A1. Patient health record plaintext (PHI)
- A2. Patient identity / SUI keys
- A3. Access grants (capability tokens)
- A4. On-chain anchors (hash, hospital_id)

## Trust Boundaries
- TB1. Phone ↔ Cloud LLM API (PII redaction layer)
- TB2. Phone ↔ Walrus (ciphertext only)
- TB3. Phone ↔ Seal keyservers (key shares)
- TB4. QR handoff: patient ↔ doctor device (physical, in-clinic)
- TB5. Doctor browser ↔ on-chain (consume_grant)

## Threats (STRIDE)

| ID | Threat | Asset | Vector | Severity | Mitigation | Residual |
|----|--------|-------|--------|----------|------------|----------|
| T1 | Cloud LLM logs/leaks PHI | A1 | TB1 | **High** | Mandatory PII redaction (regex + NER); no raw names/IDs/addresses sent; documented as transitional; post-MVP move to local LLM | Medium — clinical context still leaks |
| T2 | QR token interception | A3 | TB4 | Medium | Single-use, hash-anchored, short TTL (default 15 min); physical handoff only | Low |
| T3 | Replay of consumed grant | A3 | TB5 | Low | `used` flag set atomically in `consume_grant`; expires_at check via `Clock` | Low |
| T4 | Walrus blob enumeration | A1 | TB2 | Low | High-entropy blob_id; ciphertext is Seal-wrapped (key not on Walrus) | Low |
| T5 | Doctor exfiltrates plaintext | A1 | TB5 | **High** | Web viewer: CSP, no IndexedDB/localStorage, no download button, watermark with viewer identity; **legal/UX deterrent only** | High — accepted MVP risk |
| T6 | Lost / stolen phone | A1, A2 | device | High | zkLogin recovery path; Passkey requires platform sync (iCloud/Google); local DB encrypted at rest | Medium |
| T7 | Hospital impersonation (fake QR receiver) | A1 | TB4 | Medium | MVP accepts (4C trust model); v2 adds `DoctorCap` from `HospitalRegistry` | Medium — accepted |
| T8 | Seal keyserver collusion | A1 | TB3 | Low | Threshold t-of-n with t≥3, n=5; geographically diverse operators | Low |
| T9 | Integer overflow on `expires_at_ms` | A3 | contract | Low | `u64` ms timestamps, bounded TTL (max 30 days); checked add | Low |
| T10 | DoS via spam grant issuance | A3 | contract | Low | Gas cost is natural rate-limit; per-record grant cap optional v2 | Low |
| T11 | Patient impersonation (phishing zkLogin) | A2 | TB1 | Medium | Standard OAuth phishing risk; user education; Passkey path immune | Medium |
| T12 | Front-running `consume_grant` | A3 | mempool | Low | Token preimage is secret in QR; hash on-chain reveals nothing usable | Low |
| T13 | Predictable preimage (R2-bis) | A3 | client | Medium | Patient app MUST hash CSPRNG-generated preimage (≥32 random bytes). Contract enforces `token_hash.length() == 32` (defense-in-depth) but cannot detect predictable preimages like `sha3_256(b"")`. Audit app code for `crypto.getRandomValues()` / `SecureRandom` usage. | Low (with app discipline) |
| T14 | Duplicate `token_hash` across grants (R7) | A3 | client | Low | Patient app MUST generate fresh preimage per grant. On-chain registry of used hashes deferred to v2 (per-record `Table<bytes, ()>` write). Single leaked preimage compromises all grants sharing that hash. | Medium — accepted MVP risk |
| T15 | Tombstone cascade bypass (R6 — fixed) | A1 | contract | — | `consume_grant` now requires `&RecordAnchor` and asserts `is_active`. Revoking a record kills all live grants on the next consume attempt. | Resolved |

## Move-Specific Red Team Vectors

1. **Access control bypass:** can a non-issuer revoke a grant? → assert `grant.issuer == sender`
2. **Object stealing:** is `RecordAnchor` truly owned (`has key, store`)? Verify no shared transfer paths
3. **Hot-potato leak:** ensure no `AccessGrant` instance escapes without `share_object` or burn
4. **Capability confusion:** `AccessGrant` must not double as authorization for `RecordAnchor` mutation
5. **Clock manipulation:** rely on `Clock` shared object only, never `tx_context::epoch_timestamp_ms` for grant expiry (epoch granularity too coarse)

## Out-of-Scope (MVP)
- HIPAA / PDPA / 個資法 legal compliance review (required before mainnet)
- Multi-jurisdictional data residency
- Insurance fraud detection
- Family/guardian multi-party access

## Action Items Before Demo
- [ ] PII redaction unit tests (golden cases for TW/JP IDs, names, addresses)
- [ ] Doctor viewer CSP headers + watermark implemented
- [x] `sui-red-team` suite — 10 rounds run, 9 defended / 2 accepted (T13, T14)
- [ ] Document the cloud-LLM caveat prominently in demo script
- [ ] Patient app: enforce `crypto.getRandomValues(new Uint8Array(32))` for preimage gen (T13/T14)
- [ ] Code review: every `issue_grant` call site audited for fresh preimage (T14)

## Red Team Summary (2026-05-02)

10 attack rounds executed against `record_anchor` + `access_grant`:

| Round | Vector | Result |
|-------|--------|--------|
| R1 | TTL u64 overflow | DEFENDED (Move arithmetic abort) |
| R2 | Short token_hash | DEFENDED (length check); R2-bis predictable preimage → T13 |
| R3 | TTL > MAX_TTL_MS | DEFENDED |
| R4 | Consume at exact expiry boundary | DEFENDED |
| R5 | Double revoke grant | DEFENDED |
| R6 | Tombstone cascade | **FIXED** (consume_grant now takes &RecordAnchor) |
| R7 | Duplicate token_hash | ACCEPTED (T14 — client responsibility) |
| R8 | Cross-account grant issuance | DEFENDED |
| R9 | Revoke after consume | **FIXED** (added !used assertion) |
| R10 | Empty anchor fields | **FIXED** (input validation) |

Confidence: 75%. Re-run on every contract change.
