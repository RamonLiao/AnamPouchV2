# Portable Health Agent — System Design Spec

- **Date:** 2026-05-02
- **Status:** Draft v1 (Hackathon MVP)
- **Network:** SUI Testnet (Protocol 117) → Mainnet (Protocol 115)
- **SDK:** `@mysten/sui` ^1.x, `@mysten/dapp-kit-react`
- **Source PRD:** `Ideas/Portable_Health_Agent_PRD.md`

---

## 1. Executive Summary

Patient-controlled portable health records on SUI. Sensitive data lives on-device + Walrus (encrypted via Seal threshold encryption); only **content hashes, timestamps, hospital IDs, and access grants** touch the chain. Doctors gain time-bounded read access via QR-issued one-time `AccessGrant` objects.

**Hackathon MVP scope (Flow A + B end-to-end):**
1. Record visit → cloud LLM summary (with PII redaction) → Seal-encrypt → Walrus + phone → on-chain hash anchor.
2. QR authorization → doctor scans → fetch & decrypt via Seal policy → web viewer (no plaintext download).

---

## 2. Architecture Overview

### 2.1 Layered Design

```
┌──────────────────────────────────────────────────────────────┐
│  Patient App (React Native / PWA)                            │
│  - zkLogin + Passkey auth                                    │
│  - Audio capture, ASR, AIProvider (OpenAI/Gemini/Local)      │
│  - Seal client SDK, Walrus client                            │
└──────────────┬───────────────────────────┬───────────────────┘
               │                           │
       ┌───────▼────────┐         ┌────────▼─────────┐
       │  Walrus Blob   │         │  Seal Key Server │
       │  (ciphertext)  │         │  (threshold dec) │
       └────────────────┘         └──────────────────┘
               │                           │
               └─────────┬─────────────────┘
                         │
            ┌────────────▼─────────────┐
            │  SUI Move Contracts      │
            │  - record_anchor         │
            │  - access_grant          │
            │  - hospital_registry*    │  (*future)
            └────────────┬─────────────┘
                         │
            ┌────────────▼─────────────┐
            │  Doctor Web Viewer       │
            │  (stateless, no cache)   │
            └──────────────────────────┘
```

### 2.2 Data Layer Choice

| Need | Choice | Reason |
|------|--------|--------|
| Current state (record list) | gRPC (GA) | Primary, performant |
| Frontend dashboards | GraphQL (beta) | Better DX |
| Historical analytics (post-MVP) | Custom indexer | See `sui-indexer` |
| **JSON-RPC** | ❌ Not used | Deprecated April 2026 |

---

## 3. Module Design (Move)

```
sources/
├── record_anchor.move      # 病歷 hash 上鏈（Q1: A）
├── access_grant.move       # QR 一次性授權 + 撤銷（Q4: C, 預留升級）
├── hospital_registry.move  # [v2] 醫院/醫師 DoctorCap（4A 升級路徑）
└── errors.move
```

### 3.1 `record_anchor`

**Object: `RecordAnchor`** (owned by patient address)
```move
public struct RecordAnchor has key, store {
    id: UID,
    patient: address,
    content_hash: vector<u8>,       // sha3-256 of ciphertext
    walrus_blob_id: vector<u8>,     // Walrus reference
    seal_policy_id: ID,             // Seal access policy object
    hospital_id: vector<u8>,        // opaque hospital identifier
    visit_timestamp_ms: u64,
    created_at_ms: u64,
    version: u8,                    // schema versioning
}
```

**Entry functions**
- `create_anchor(patient, hash, blob_id, policy_id, hospital_id, ts, &mut TxContext)` → emits `RecordCreated`
- `revoke_anchor(record: &mut RecordAnchor, ctx)` — soft delete by setting `version = TOMBSTONE`

**Events**
- `RecordCreated { record_id, patient, content_hash, hospital_id, ts }`
- `RecordRevoked { record_id, patient, ts }`

### 3.2 `access_grant`

**Object: `AccessGrant`** (shared, time-locked, burn-on-use)
```move
public struct AccessGrant has key {
    id: UID,
    record_id: ID,
    issuer: address,                // patient
    grantee_token_hash: vector<u8>, // hash(one_time_token) — Q4:C
    grantee_doctor_cap: Option<ID>, // future: DoctorCap (4A path)
    scope: u8,                      // 0=single, 1=period, 2=disease
    expires_at_ms: u64,
    used: bool,
    revoked: bool,
}
```

**Entry functions**
- `issue_grant(record: &RecordAnchor, token_hash, scope, ttl_ms, clock, ctx)` — patient-only, share object
- `consume_grant(grant: &mut AccessGrant, token_preimage, clock, ctx)` — verify hash, mark `used = true`, emit access event (Seal key server reads this event for policy decision)
- `revoke_grant(grant: &mut AccessGrant, ctx)` — issuer-only

**Events**
- `GrantIssued { grant_id, record_id, expires_at_ms, scope }`
- `GrantConsumed { grant_id, consumer, ts }`
- `GrantRevoked { grant_id, ts }`

**Why hash(token) instead of plaintext token on-chain?** Token plaintext stays in QR; only its hash anchors on-chain → preimage verification at consume time prevents replay/leak.

### 3.3 Errors
```move
const E_NOT_OWNER: u64 = 1;
const E_GRANT_EXPIRED: u64 = 2;
const E_GRANT_USED: u64 = 3;
const E_GRANT_REVOKED: u64 = 4;
const E_INVALID_TOKEN: u64 = 5;
const E_TOMBSTONED: u64 = 6;
```

---

## 4. Off-Chain Components

### 4.1 AIProvider Abstraction (MVP critical)

```typescript
interface AIProvider {
  redactPII(transcript: string): RedactedText;       // ALWAYS run before cloud call
  summarize(redacted: RedactedText): StructuredSummary;
}

// MVP adapters
class OpenAIAdapter implements AIProvider { /* gpt-4o-mini */ }
class GeminiAdapter implements AIProvider { /* gemini-2.x-flash */ }
// Post-MVP
class LocalLlamaAdapter implements AIProvider { /* llama.cpp / mlc */ }
```

**StructuredSummary schema** (matches PRD §2.3):
```ts
{
  chiefComplaint: string,
  doctorQuestions: string[],
  preliminaryAssessment: string,
  examResults: string[],
  medications: { name, dose, freq, notes }[],
  patientNotes?: string,
}
```

**PII redaction rules (MVP — must ship):**
- Regex mask: TW national ID (`\b[A-Z][12]\d{8}\b`), phone, email, addresses
- Name detection via NER-lite (spaCy / on-device); replace with `<PATIENT_NAME>` tokens before API call
- Re-hydrate tokens client-side after summary returns

### 4.2 Seal Encryption Flow (Q3:B)

1. Patient app generates `summary_plaintext` → AES-256-GCM with `data_key`
2. `data_key` wrapped via **Seal threshold encryption** under policy:
   ```
   policy = OR(
     patient_address == owner,
     access_grant.consume_event seen for record_id within ttl
   )
   ```
3. Ciphertext → Walrus blob; ciphertext hash → on-chain `RecordAnchor.content_hash`
4. Doctor consume flow: scan QR → call `consume_grant` → Seal key servers detect event → release decryption shares → web viewer assembles plaintext (in-memory, no download)

### 4.3 Storage Strategy (Q2:C)

- **Primary:** phone Secure Enclave / Keystore (encrypted DB, offline-first)
- **Backup:** Walrus blob (same ciphertext, content-addressed)
- **Sync:** on app start, diff `RecordAnchor` events for `patient` vs local DB → pull missing blobs

### 4.4 Auth (Q5:C)

- **zkLogin** (Google/Apple) → derived SUI address, ephemeral keypair (max epoch +2)
- **Passkey** (WebAuthn / Face ID) → secp256r1 signer, on-device key
- Both produce same `patient` address abstraction → unified `PatientSession` interface

---

## 5. Data Flows

### Flow A: Record creation (PRD §3 Flow A)
```
1. record audio → ASR (on-device whisper.cpp / cloud)
2. AIProvider.redactPII(transcript)
3. AIProvider.summarize(redacted) → StructuredSummary
4. patient confirms/edits in UI
5. AES encrypt → ciphertext
6. Seal.wrap(data_key, policy) → seal_blob
7. Walrus.put(ciphertext) → blob_id
8. PTB:
   - record_anchor::create_anchor(hash, blob_id, policy_id, hospital_id, ts)
9. UI: ✅ on-chain (show tx hash)
```

### Flow B: Doctor authorized read (PRD §3 Flow B)
```
1. patient picks scope → app generates one_time_token, computes hash
2. PTB: access_grant::issue_grant(record, token_hash, scope, ttl)
3. QR encodes: { record_id, grant_id, token_preimage, walrus_blob_id }
4. doctor scans → web viewer:
   a. PTB: access_grant::consume_grant(grant, token_preimage)
   b. Walrus.get(blob_id) → ciphertext
   c. Seal.unwrap(seal_blob) — keyservers verify GrantConsumed event
   d. AES decrypt → plaintext rendered (no download, no cache)
5. revoke: patient calls revoke_grant anytime
```

---

## 6. Capability / Permission Model

| Action | Authorization |
|--------|---------------|
| Create record | `tx.sender == patient` (owned object) |
| Revoke record | `record.patient == sender` |
| Issue grant | `record.patient == sender` |
| Consume grant | hash(token_preimage) == `grant.grantee_token_hash` AND `now < expires_at` AND `!used` AND `!revoked` |
| Revoke grant | `grant.issuer == sender` |
| **[v2]** Doctor verified | `DoctorCap` from `HospitalRegistry` (path 4A) |

No admin cap, no upgrade cap centralization concerns for MVP. Use `published-at` immutable for hackathon; add `UpgradeCap` policy for v2.

---

## 7. Security Threat Model (summary — full in `docs/security/threat-model.md`)

| Vector | Mitigation |
|--------|------------|
| Cloud LLM leaks PHI | **PII redaction layer (mandatory, MVP)**; documented as transitional |
| QR token interception | Single-use, time-bounded, hash-anchored; physical handoff in clinic |
| Replay of old grant | `used` flag + `expires_at_ms` checked atomically |
| Walrus blob enumeration | blob_id is high-entropy; ciphertext is Seal-wrapped |
| Doctor caches plaintext | Web viewer: no download, CSP, no IndexedDB; legal/UX deterrent only — flagged risk |
| Lost phone | Recovery via zkLogin re-derivation + Walrus pull; Passkey path requires backup (iCloud Keychain) |
| Hospital impersonation (MVP) | **Accepted risk** — 4C trusts QR receiver. v2 adds DoctorCap |
| Seal keyserver collusion | Threshold (t-of-n); choose t≥3, n=5 |

---

## 8. SUI Ecosystem Integration

| Tool | Use |
|------|-----|
| **Seal** | Threshold encryption + policy-gated decryption (core) |
| **Walrus** | Encrypted blob storage |
| **zkLogin** | Patient OAuth login |
| **Passkey** | Patient biometric login |
| **gRPC** | Primary on-chain reads |
| **Display V2** | Render `RecordAnchor` in wallets (date, hospital, hash badge) |
| `sui-indexer` | [v2] Health insights aggregation |

---

## 9. Testing Strategy

- **Move unit tests:** anchor lifecycle, grant issue/consume/revoke, expiry, replay, double-use
- **Move red-team** (`sui-red-team`): access control bypass, integer overflow on `expires_at`, object manipulation, DoS on shared `AccessGrant`
- **Integration:** Walrus put/get round-trip + Seal wrap/unwrap with real keyservers (testnet)
- **E2E:** Playwright — patient creates record → QR → doctor viewer renders
- **Monkey testing:** malformed QR, expired grant retry, network drop mid-PTB, duplicate token_hash

---

## 10. Deployment Plan

| Phase | Network | Goal |
|-------|---------|------|
| Day 1-2 | localnet | Move modules + tests pass |
| Day 3 | devnet | Walrus + Seal integration |
| Day 4 | testnet | Full E2E demo |
| Demo day | testnet | Live show |
| Post-hackathon | mainnet | After audit |

`UpgradeCap` retained by team multisig until governance defined.

---

## 11. Gas Estimates (rough)

| Op | Est. gas |
|----|----------|
| `create_anchor` | ~2M MIST |
| `issue_grant` (shared object) | ~3M MIST |
| `consume_grant` | ~2M MIST |

Acceptable for hackathon; optimize via `sui-dev-agents:gas` post-MVP.

---

## 12. Open Questions / Deferred

- Hospital onboarding governance (DoctorCap issuance) — v2
- Long-term key rotation for Seal policies
- Multi-patient sharing (family/guardian) — out of scope
- HIPAA/PDPA legal compliance review — required before mainnet

---

## 13. Next Steps

1. ✅ Spec approved → invoke `sui-developer` to scaffold Move modules
2. Parallel: `sui-frontend` for patient app + doctor viewer
3. `sui-tester` for unit + red-team suite
4. `sui-deployer` for staged rollout

---

## Appendix A — Module Dependency

See `docs/architecture/module-dependency.mmd`.

## Appendix B — Data Flow

See `docs/architecture/data-flow.mmd`.

## Appendix C — Threat Model

See `docs/security/threat-model.md`.
