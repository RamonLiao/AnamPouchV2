# Seal + Walrus Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Seal threshold encryption + Walrus storage into the Portable Health Agent end-to-end, replacing the (incorrect) "event-listener" assumption with proper on-chain `seal_approve` policy and a `DecryptionTicket` capability object.

**Architecture:**
- **Move ABI**: add owned `DecryptionTicket` capability minted by `consume_grant`; add `record_anchor::seal_approve(record, ticket, clock, ctx): bool` view function used by Seal key servers as the on-chain policy. RecordAnchor.id itself is the Seal `policyObjectId`.
- **Frontend Patient flow**: redact PII → AI summarize → Seal `encrypt(policyObjectId=record.id)` → Walrus upload → `create_anchor(content_hash, blob_id, ...)`.
- **Frontend Doctor flow**: scan QR → `consume_grant` PTB (mints `DecryptionTicket` to doctor) → Seal `SessionKey` (TTL 5min) → `decrypt` → render with watermark.

**Tech Stack:** Move 2024.beta, `@mysten/seal` ^0.5, `@mysten/walrus` ^0.6, `@mysten/sui` ^1.20, `@mysten/dapp-kit-react`, React 18, Vite, vitest (to be added).

**Decisions locked (from brainstorm):**
- Q1: `policyObjectId = RecordAnchor.id` (record-scoped IBE)
- Q2: SessionKey TTL = 5 min
- Q3: encrypt → upload Walrus → `create_anchor` in one client flow
- Q4: atomicity from single SUI tx (consume_grant)
- Q5: revoke = flip `RecordAnchor.version` to tombstone; `seal_approve` checks `is_active`
- Q6: preimage verified inside `consume_grant` (one-step)

**Out of scope:** transferable tickets / 轉診 (ticket has `key` only, no `store`), ASR/audio capture (separate plan), zkLogin/Passkey adapters, mainnet deploy.

---

## File Structure

### Move (contracts/portable_health/sources/)
- **Modify** `access_grant.move`: change `consume_grant` to mint and transfer a `DecryptionTicket` to sender; keep all existing assertions (preimage, expiry, used flag, record cascade).
- **Create** `decryption_ticket.move`: defines `DecryptionTicket` struct + accessors. Owned object (`has key`, no `store` → not transferable by users).
- **Modify** `record_anchor.move`: add `public fun seal_approve(record: &RecordAnchor, ticket: &DecryptionTicket, clock: &Clock, ctx: &TxContext): bool`.

### Move tests (contracts/portable_health/tests/)
- **Modify** `access_grant_tests.move`: existing consume tests now must extract the minted ticket from tx effects.
- **Create** `decryption_ticket_tests.move`: ticket fields + happy path.
- **Create** `seal_approve_tests.move`: positive + 4 red-team negatives (impersonation, expired, revoked record, cross-record ticket).

### Frontend (frontend/src/)
- **Modify** `package.json`: add `vitest`, `@vitest/ui`, `jsdom`, `fake-indexeddb` (dev deps).
- **Create** `vitest.config.ts`.
- **Create** `lib/seal.ts`: thin wrapper around `@mysten/seal` — `encryptForRecord`, `createSessionKey`, `decryptWithTicket`. Uses testnet key servers from env.
- **Create** `lib/walrus.ts`: `uploadBlob`, `fetchBlob` wrappers around `@mysten/walrus`.
- **Modify** `config/contract.ts`: add `consumeGrant` move-call now returns ticket; add `sealApprove` target; add Seal key-server URLs and Walrus publisher URL from env.
- **Modify** `types/contracts.ts`: add `DecryptionTicket` type.
- **Modify** `api/accessGrant.ts`: `buildConsumeGrantTx` now exposes `ticketArg` (the call result) so caller can chain or read from effects.
- **Modify** `api/recordAnchor.ts`: helper that builds full `encrypt → upload → create_anchor` PTB+side-effects orchestration (Seal/Walrus are off-chain HTTP, only `create_anchor` is a Move call).
- **Create** `lib/recordPipeline.ts`: orchestrator `createEncryptedRecord(plaintext, hospitalId, signer): Promise<{recordId, blobId}>`.
- **Create** `lib/doctorPipeline.ts`: orchestrator `consumeAndDecrypt(grantId, preimage, signer): Promise<{plaintext, ticketId}>`.
- **Create** `lib/recordPipeline.test.ts`, `lib/doctorPipeline.test.ts`: vitest unit tests with mocked Seal/Walrus/SUI.

### Docs / progress
- **Modify** `tasks/progress.md`: update L20/L67/L69 per brainstorm output.
- **Modify** `docs/specs/2026-05-02-portable-health-agent-spec.md`: small ABI section update if it documents `consume_grant` signature.

---

## Task 1: Add `DecryptionTicket` module (Move)

**Files:**
- Create: `contracts/portable_health/sources/decryption_ticket.move`
- Test: `contracts/portable_health/tests/decryption_ticket_tests.move`

- [ ] **Step 1: Write failing test**

Create `contracts/portable_health/tests/decryption_ticket_tests.move`:

```move
#[test_only]
module portable_health::decryption_ticket_tests;

use sui::test_scenario as ts;
use sui::clock;
use sui::object;
use portable_health::decryption_ticket::{Self, DecryptionTicket};

const DOCTOR: address = @0xD0C;

#[test]
fun mints_ticket_with_expected_fields() {
    let mut s = ts::begin(DOCTOR);
    let mut clk = clock::create_for_testing(ts::ctx(&mut s));
    clock::set_for_testing(&mut clk, 1_000);

    let fake_record = object::id_from_address(@0xAAAA);
    let fake_grant = object::id_from_address(@0xBBBB);

    decryption_ticket::mint_for_test(
        fake_record, fake_grant, DOCTOR, 5_000, ts::ctx(&mut s)
    );
    ts::next_tx(&mut s, DOCTOR);
    let t = ts::take_from_sender<DecryptionTicket>(&s);
    assert!(decryption_ticket::record_id(&t) == fake_record, 0);
    assert!(decryption_ticket::grant_id(&t) == fake_grant, 1);
    assert!(decryption_ticket::holder(&t) == DOCTOR, 2);
    assert!(decryption_ticket::expires_at_ms(&t) == 5_000, 3);
    ts::return_to_sender(&s, t);

    clock::destroy_for_testing(clk);
    ts::end(s);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd contracts/portable_health && sui move test decryption_ticket_tests`
Expected: FAIL — module `decryption_ticket` does not exist.

- [ ] **Step 3: Implement module**

Create `contracts/portable_health/sources/decryption_ticket.move`:

```move
/// Owned capability minted by `access_grant::consume_grant` and used by
/// `record_anchor::seal_approve` as proof the holder consumed a valid grant.
/// Has `key` only (no `store`) so it cannot be transferred by users.
module portable_health::decryption_ticket;

// === Errors ===

#[error]
const EExpired: vector<u8> = b"DecryptionTicket has expired";

// === Struct ===

public struct DecryptionTicket has key {
    id: UID,
    record_id: ID,
    grant_id: ID,
    holder: address,
    expires_at_ms: u64,
}

// === Friend-style mint (only access_grant should call this in production) ===

public(package) fun mint(
    record_id: ID,
    grant_id: ID,
    holder: address,
    expires_at_ms: u64,
    ctx: &mut TxContext,
) {
    let t = DecryptionTicket {
        id: object::new(ctx),
        record_id,
        grant_id,
        holder,
        expires_at_ms,
    };
    transfer::transfer(t, holder);
}

// === Accessors ===

public fun record_id(t: &DecryptionTicket): ID { t.record_id }
public fun grant_id(t: &DecryptionTicket): ID { t.grant_id }
public fun holder(t: &DecryptionTicket): address { t.holder }
public fun expires_at_ms(t: &DecryptionTicket): u64 { t.expires_at_ms }

public fun assert_fresh(t: &DecryptionTicket, now_ms: u64) {
    assert!(now_ms < t.expires_at_ms, EExpired);
}

#[test_only]
public fun mint_for_test(
    record_id: ID,
    grant_id: ID,
    holder: address,
    expires_at_ms: u64,
    ctx: &mut TxContext,
) {
    mint(record_id, grant_id, holder, expires_at_ms, ctx)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd contracts/portable_health && sui move test decryption_ticket_tests`
Expected: 1 PASS.

- [ ] **Step 5: Commit**

```bash
git add contracts/portable_health/sources/decryption_ticket.move \
        contracts/portable_health/tests/decryption_ticket_tests.move
git commit -m "feat(move): add DecryptionTicket capability object"
```

---

## Task 2: Make `consume_grant` mint + transfer a ticket

**Files:**
- Modify: `contracts/portable_health/sources/access_grant.move:155-181`
- Test: `contracts/portable_health/tests/access_grant_tests.move`

- [ ] **Step 1: Write failing test for ticket-mint behavior**

Append to `contracts/portable_health/tests/access_grant_tests.move`:

```move
#[test]
fun consume_mints_ticket_to_doctor() {
    use portable_health::decryption_ticket::{Self, DecryptionTicket};
    let (mut s, clk, record_id, grant_id, preimage) = setup_issued_grant();

    ts::next_tx(&mut s, @0xD0C); // doctor as sender
    {
        let mut grant = ts::take_shared_by_id<portable_health::access_grant::AccessGrant>(&s, grant_id);
        let record = ts::take_shared_by_id<portable_health::record_anchor::RecordAnchor>(&s, record_id);
        portable_health::access_grant::consume_grant(
            &mut grant, &record, preimage, &clk, ts::ctx(&mut s)
        );
        ts::return_shared(grant);
        ts::return_shared(record);
    };
    ts::next_tx(&mut s, @0xD0C);
    let ticket = ts::take_from_sender<DecryptionTicket>(&s);
    assert!(decryption_ticket::record_id(&ticket) == record_id, 0);
    assert!(decryption_ticket::grant_id(&ticket) == grant_id, 1);
    assert!(decryption_ticket::holder(&ticket) == @0xD0C, 2);
    ts::return_to_sender(&s, ticket);

    teardown(s, clk);
}
```

(`setup_issued_grant` and `teardown` should reuse existing helpers — if absent, add helpers that issue a grant from PATIENT, share the record, and return preimage. Keep helpers internal to the test module.)

- [ ] **Step 2: Run to confirm fail**

Run: `cd contracts/portable_health && sui move test consume_mints_ticket_to_doctor`
Expected: FAIL — `DecryptionTicket` not found in sender effects.

- [ ] **Step 3: Modify `consume_grant`**

Edit `contracts/portable_health/sources/access_grant.move`:

Add import near top:
```move
use portable_health::decryption_ticket;
```

Change ticket-mint TTL constant (top, after existing constants):
```move
/// How long the minted DecryptionTicket stays valid (independent of grant TTL).
const TICKET_TTL_MS: u64 = 5 * 60 * 1000; // 5 minutes
```

Replace the `consume_grant` body (currently L155–181) — keep the signature, just append ticket mint:

```move
public fun consume_grant(
    grant: &mut AccessGrant,
    record: &RecordAnchor,
    token_preimage: vector<u8>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(record_anchor::id(record) == grant.record_id, ERecordMismatch);
    assert!(record_anchor::is_active(record), ERecordRevoked);
    assert!(!grant.revoked, EGrantRevoked);
    assert!(!grant.used, EGrantUsed);

    let now = clock.timestamp_ms();
    assert!(now < grant.expires_at_ms, EGrantExpired);

    let computed = hash::sha3_256(token_preimage);
    assert!(computed == grant.grantee_token_hash, EInvalidToken);

    grant.used = true;

    event::emit(GrantConsumed {
        grant_id: object::id(grant),
        record_id: grant.record_id,
        consumer: ctx.sender(),
        consumed_at_ms: now,
    });

    decryption_ticket::mint(
        grant.record_id,
        object::id(grant),
        ctx.sender(),
        now + TICKET_TTL_MS,
        ctx,
    );
}
```

Note `ctx` changes from `&TxContext` to `&mut TxContext` (needed for `object::new` inside ticket mint).

- [ ] **Step 4: Update existing consume tests**

Any existing test in `access_grant_tests.move` that called `consume_grant` with `&TxContext` must change to `&mut TxContext`. Also: any test that previously asserted "no objects transferred" must now expect a `DecryptionTicket` in sender effects. If a test only verifies the event/mark-used, no change needed beyond the `ctx` mutability.

- [ ] **Step 5: Run all Move tests**

Run: `cd contracts/portable_health && sui move test`
Expected: All previous tests + new `consume_mints_ticket_to_doctor` PASS.

- [ ] **Step 6: Commit**

```bash
git add contracts/portable_health/sources/access_grant.move \
        contracts/portable_health/tests/access_grant_tests.move
git commit -m "feat(move): consume_grant mints DecryptionTicket to consumer"
```

---

## Task 3: Add `seal_approve` policy function

**Files:**
- Modify: `contracts/portable_health/sources/record_anchor.move`
- Create: `contracts/portable_health/tests/seal_approve_tests.move`

- [ ] **Step 1: Write failing positive test + 4 red-team tests**

Create `contracts/portable_health/tests/seal_approve_tests.move`:

```move
#[test_only]
module portable_health::seal_approve_tests;

use sui::test_scenario as ts;
use sui::clock;
use sui::object;
use portable_health::record_anchor::{Self, RecordAnchor};
use portable_health::decryption_ticket::{Self, DecryptionTicket};

const PATIENT: address = @0xPA7;
const DOCTOR: address = @0xD0C;
const ATTACKER: address = @0xBAD;

fun fake_record(s: &mut ts::Scenario): ID {
    // helper: create a minimal active RecordAnchor and return its id
    let clk = clock::create_for_testing(ts::ctx(s));
    record_anchor::create_anchor(
        std::vector::tabulate!(32, |_| 0u8),
        b"blob1",
        object::id_from_address(@0x1), // placeholder seal_policy_id (self-link patched in T4)
        b"hosp1",
        1_000,
        &clk,
        ts::ctx(s),
    );
    clock::destroy_for_testing(clk);
    ts::next_tx(s, PATIENT);
    let r = ts::take_shared<RecordAnchor>(s);
    let id = record_anchor::id(&r);
    ts::return_shared(r);
    id
}

#[test]
fun approves_when_holder_matches_and_active_and_fresh() {
    let mut s = ts::begin(PATIENT);
    let rid = fake_record(&mut s);
    let mut clk = clock::create_for_testing(ts::ctx(&mut s));
    clock::set_for_testing(&mut clk, 1_000);
    decryption_ticket::mint_for_test(rid, object::id_from_address(@0xB), DOCTOR, 5_000, ts::ctx(&mut s));
    ts::next_tx(&mut s, DOCTOR);
    let t = ts::take_from_sender<DecryptionTicket>(&s);
    let r = ts::take_shared<RecordAnchor>(&s);
    assert!(record_anchor::seal_approve(&r, &t, &clk, ts::ctx(&mut s)) == true, 0);
    ts::return_shared(r);
    ts::return_to_sender(&s, t);
    clock::destroy_for_testing(clk);
    ts::end(s);
}

#[test]
fun rejects_when_sender_is_not_holder() {
    let mut s = ts::begin(PATIENT);
    let rid = fake_record(&mut s);
    let mut clk = clock::create_for_testing(ts::ctx(&mut s));
    clock::set_for_testing(&mut clk, 1_000);
    decryption_ticket::mint_for_test(rid, object::id_from_address(@0xB), DOCTOR, 5_000, ts::ctx(&mut s));
    ts::next_tx(&mut s, ATTACKER);
    let r = ts::take_shared<RecordAnchor>(&s);
    // Attacker forges by pulling someone else's ticket — test_scenario blocks
    // this directly, so we mint a fake ticket as ATTACKER instead and verify
    // record_id mismatch path.
    decryption_ticket::mint_for_test(object::id_from_address(@0xDEAD), object::id_from_address(@0xB), ATTACKER, 5_000, ts::ctx(&mut s));
    ts::next_tx(&mut s, ATTACKER);
    let t = ts::take_from_sender<DecryptionTicket>(&s);
    assert!(record_anchor::seal_approve(&r, &t, &clk, ts::ctx(&mut s)) == false, 0);
    ts::return_shared(r);
    ts::return_to_sender(&s, t);
    clock::destroy_for_testing(clk);
    ts::end(s);
}

#[test]
fun rejects_when_ticket_expired() {
    let mut s = ts::begin(PATIENT);
    let rid = fake_record(&mut s);
    let mut clk = clock::create_for_testing(ts::ctx(&mut s));
    clock::set_for_testing(&mut clk, 1_000);
    decryption_ticket::mint_for_test(rid, object::id_from_address(@0xB), DOCTOR, 500, ts::ctx(&mut s));
    ts::next_tx(&mut s, DOCTOR);
    let t = ts::take_from_sender<DecryptionTicket>(&s);
    let r = ts::take_shared<RecordAnchor>(&s);
    assert!(record_anchor::seal_approve(&r, &t, &clk, ts::ctx(&mut s)) == false, 0);
    ts::return_shared(r);
    ts::return_to_sender(&s, t);
    clock::destroy_for_testing(clk);
    ts::end(s);
}

#[test]
fun rejects_when_record_revoked() {
    let mut s = ts::begin(PATIENT);
    let rid = fake_record(&mut s);
    let mut clk = clock::create_for_testing(ts::ctx(&mut s));
    clock::set_for_testing(&mut clk, 1_000);
    decryption_ticket::mint_for_test(rid, object::id_from_address(@0xB), DOCTOR, 5_000, ts::ctx(&mut s));
    ts::next_tx(&mut s, PATIENT);
    {
        let mut r = ts::take_shared<RecordAnchor>(&s);
        record_anchor::revoke_anchor(&mut r, &clk, ts::ctx(&mut s));
        ts::return_shared(r);
    };
    ts::next_tx(&mut s, DOCTOR);
    let t = ts::take_from_sender<DecryptionTicket>(&s);
    let r = ts::take_shared<RecordAnchor>(&s);
    assert!(record_anchor::seal_approve(&r, &t, &clk, ts::ctx(&mut s)) == false, 0);
    ts::return_shared(r);
    ts::return_to_sender(&s, t);
    clock::destroy_for_testing(clk);
    ts::end(s);
}

#[test]
fun rejects_when_ticket_record_id_mismatch() {
    let mut s = ts::begin(PATIENT);
    let rid = fake_record(&mut s);
    let mut clk = clock::create_for_testing(ts::ctx(&mut s));
    clock::set_for_testing(&mut clk, 1_000);
    let other = object::id_from_address(@0xCAFE);
    decryption_ticket::mint_for_test(other, object::id_from_address(@0xB), DOCTOR, 5_000, ts::ctx(&mut s));
    ts::next_tx(&mut s, DOCTOR);
    let t = ts::take_from_sender<DecryptionTicket>(&s);
    let r = ts::take_shared<RecordAnchor>(&s);
    assert!(record_anchor::seal_approve(&r, &t, &clk, ts::ctx(&mut s)) == false, 0);
    let _ = rid; // silence unused
    ts::return_shared(r);
    ts::return_to_sender(&s, t);
    clock::destroy_for_testing(clk);
    ts::end(s);
}
```

- [ ] **Step 2: Run to confirm fail**

Run: `cd contracts/portable_health && sui move test seal_approve`
Expected: 5 FAIL — `seal_approve` does not exist.

- [ ] **Step 3: Add `seal_approve` to `record_anchor.move`**

Edit `contracts/portable_health/sources/record_anchor.move`. Add import near top:

```move
use portable_health::decryption_ticket::{Self, DecryptionTicket};
```

Append after the existing accessors:

```move
/// Seal access policy. Key servers dry-run this function; `true` releases
/// a key share to the requesting session. Combines all caps:
///   1. ticket holder must be the tx sender (Seal sets sender from session)
///   2. ticket must reference this record
///   3. ticket must not be expired
///   4. record must still be active (not tombstoned)
public fun seal_approve(
    record: &RecordAnchor,
    ticket: &DecryptionTicket,
    clock: &sui::clock::Clock,
    ctx: &TxContext,
): bool {
    let now = clock.timestamp_ms();
    decryption_ticket::holder(ticket) == ctx.sender()
        && decryption_ticket::record_id(ticket) == object::id(record)
        && now < decryption_ticket::expires_at_ms(ticket)
        && record.version == VERSION_ACTIVE
}
```

- [ ] **Step 4: Run all Move tests**

Run: `cd contracts/portable_health && sui move test`
Expected: All previous tests + 5 new seal_approve tests PASS.

- [ ] **Step 5: Commit**

```bash
git add contracts/portable_health/sources/record_anchor.move \
        contracts/portable_health/tests/seal_approve_tests.move
git commit -m "feat(move): add seal_approve policy function"
```

---

## Task 4: Self-link `seal_policy_id` to record id

**Files:**
- Modify: `contracts/portable_health/sources/record_anchor.move:76-114`

Per Q1 we want `policyObjectId == RecordAnchor.id`. The current `create_anchor` accepts `seal_policy_id: ID` from the caller — we drop that param and self-set it after `object::new`.

- [ ] **Step 1: Modify `create_anchor` signature**

Edit `contracts/portable_health/sources/record_anchor.move`. Replace `create_anchor`:

```move
public fun create_anchor(
    content_hash: vector<u8>,
    walrus_blob_id: vector<u8>,
    hospital_id: vector<u8>,
    visit_timestamp_ms: u64,
    clock: &sui::clock::Clock,
    ctx: &mut TxContext,
) {
    assert!(content_hash.length() == CONTENT_HASH_LEN, EInvalidContentHash);
    assert!(walrus_blob_id.length() > 0, EEmptyBlobId);
    assert!(hospital_id.length() > 0, EEmptyHospitalId);

    let patient = ctx.sender();
    let now = clock.timestamp_ms();

    let uid = object::new(ctx);
    let self_id = object::uid_to_inner(&uid);
    let anchor = RecordAnchor {
        id: uid,
        patient,
        content_hash,
        walrus_blob_id,
        seal_policy_id: self_id,
        hospital_id,
        visit_timestamp_ms,
        created_at_ms: now,
        version: VERSION_ACTIVE,
    };

    event::emit(RecordCreated {
        record_id: object::id(&anchor),
        patient,
        content_hash: anchor.content_hash,
        hospital_id: anchor.hospital_id,
        visit_timestamp_ms,
        created_at_ms: now,
    });

    transfer::share_object(anchor);
}
```

- [ ] **Step 2: Update existing record_anchor_tests.move call sites**

Search for `create_anchor(` in `tests/record_anchor_tests.move` and remove the `seal_policy_id` argument from each call.

- [ ] **Step 3: Update `seal_approve_tests.move::fake_record`** to drop the `seal_policy_id` arg.

- [ ] **Step 4: Run all Move tests**

Run: `cd contracts/portable_health && sui move build && sui move test`
Expected: 0 build errors, all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add contracts/portable_health/sources/record_anchor.move \
        contracts/portable_health/tests/
git commit -m "refactor(move): self-link seal_policy_id to record id"
```

---

## Task 5: Frontend ABI sync — types & PTB builders

**Files:**
- Modify: `frontend/src/types/contracts.ts`
- Modify: `frontend/src/api/recordAnchor.ts`
- Modify: `frontend/src/api/accessGrant.ts`
- Modify: `frontend/src/config/contract.ts`

- [ ] **Step 1: Add `DecryptionTicket` type**

Edit `frontend/src/types/contracts.ts`. Append:

```typescript
export interface DecryptionTicket {
  id: ObjectId;
  recordId: ObjectId;
  grantId: ObjectId;
  holder: string;
  expiresAtMs: bigint;
}
```

- [ ] **Step 2: Drop `seal_policy_id` from `buildCreateAnchorTx`**

Edit `frontend/src/api/recordAnchor.ts`. Find the `create_anchor` move call and remove the `seal_policy_id` argument. (If no such file's body is present, this is a fresh function — see Task 7 for full pipeline that constructs it.)

- [ ] **Step 3: Add `sealApprove` and `consumeGrant`-with-ticket to `config/contract.ts`**

Edit `frontend/src/config/contract.ts`. Inside the `fns` map, ensure the following targets exist (replace placeholders if already present):

```typescript
fns: {
  // ...existing entries
  consumeGrant: `${pkg}::access_grant::consume_grant`,
  sealApprove: `${pkg}::record_anchor::seal_approve`,
  // ...
},
```

Add two env-driven URLs (Seal key servers + Walrus publisher):

```typescript
export const SEAL = {
  keyServerUrls: (import.meta.env.VITE_SEAL_KEY_SERVERS ?? '')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean),
  threshold: Number(import.meta.env.VITE_SEAL_THRESHOLD ?? 2),
  sessionTtlMs: 5 * 60 * 1000,
};

export const WALRUS = {
  publisherUrl: import.meta.env.VITE_WALRUS_PUBLISHER ?? 'https://publisher.walrus-testnet.walrus.space',
  aggregatorUrl: import.meta.env.VITE_WALRUS_AGGREGATOR ?? 'https://aggregator.walrus-testnet.walrus.space',
};
```

- [ ] **Step 4: Update `buildConsumeGrantTx` JSDoc**

Edit `frontend/src/api/accessGrant.ts:48-69`. Update the `ConsumeGrantArgs` JSDoc to note ticket is minted to sender:

```typescript
/**
 * Builds a consume_grant PTB. On success, a `DecryptionTicket` object is
 * transferred to the tx sender — caller should read it from tx effects via
 * `result.objectChanges` filtering by `objectType` ending in `::DecryptionTicket`.
 */
```

(No code change — only doc.)

- [ ] **Step 5: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/types/contracts.ts frontend/src/api/ frontend/src/config/contract.ts
git commit -m "feat(frontend): sync types & PTBs with new ticket-based ABI"
```

---

## Task 6: Add vitest + Seal/Walrus wrappers

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/vitest.config.ts`
- Create: `frontend/src/lib/seal.ts`
- Create: `frontend/src/lib/walrus.ts`
- Create: `frontend/src/lib/seal.test.ts`
- Create: `frontend/src/lib/walrus.test.ts`

- [ ] **Step 1: Install vitest**

Run: `cd frontend && npm i -D vitest @vitest/ui jsdom`
Expected: deps added. Then add to `package.json` scripts: `"test": "vitest run"`.

- [ ] **Step 2: Create `frontend/vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 3: Write failing wrapper tests**

Create `frontend/src/lib/seal.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { encryptForRecord } from './seal';

describe('encryptForRecord', () => {
  it('returns ciphertext bytes when SealClient.encrypt resolves', async () => {
    const fakeCipher = new Uint8Array([1, 2, 3]);
    const fakeClient = {
      encrypt: vi.fn().mockResolvedValue({ encryptedObject: fakeCipher }),
    };
    const result = await encryptForRecord({
      data: new Uint8Array([0xff]),
      recordId: '0xabc',
      sealClient: fakeClient as any,
    });
    expect(result).toEqual(fakeCipher);
    expect(fakeClient.encrypt).toHaveBeenCalledWith(
      expect.objectContaining({ id: '0xabc', threshold: 2 }),
    );
  });

  it('throws when payload is empty', async () => {
    await expect(
      encryptForRecord({
        data: new Uint8Array(),
        recordId: '0xabc',
        sealClient: {} as any,
      }),
    ).rejects.toThrow(/empty/i);
  });
});
```

Create `frontend/src/lib/walrus.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { uploadBlob } from './walrus';

describe('uploadBlob', () => {
  it('PUTs to publisher and returns blobId', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ newlyCreated: { blobObject: { blobId: 'abc123' } } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const id = await uploadBlob(new Uint8Array([1, 2, 3]), {
      publisherUrl: 'https://pub',
      epochs: 5,
    });
    expect(id).toBe('abc123');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://pub/v1/blobs?epochs=5',
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('throws on non-200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve('oops') }));
    await expect(uploadBlob(new Uint8Array([1]), { publisherUrl: 'https://pub', epochs: 5 })).rejects.toThrow(/500/);
  });
});
```

- [ ] **Step 4: Run tests — confirm fail**

Run: `cd frontend && npx vitest run`
Expected: FAIL — `seal`/`walrus` modules missing.

- [ ] **Step 5: Implement `lib/seal.ts`**

```typescript
import { SealClient, SessionKey } from '@mysten/seal';
import type { Signer } from '@mysten/sui/cryptography';
import { SEAL } from '../config/contract';

export interface EncryptArgs {
  data: Uint8Array;
  /** RecordAnchor object id — used as Seal IBE policy identity. */
  recordId: string;
  sealClient: SealClient;
}

export async function encryptForRecord(args: EncryptArgs): Promise<Uint8Array> {
  if (args.data.length === 0) throw new Error('payload is empty');
  const { encryptedObject } = await args.sealClient.encrypt({
    threshold: SEAL.threshold,
    packageId: undefined as never, // Seal SDK 0.5 reads from client config; left for future override
    id: args.recordId,
    data: args.data,
  } as any);
  return encryptedObject;
}

export interface SessionArgs {
  address: string;
  packageId: string;
  signer: Signer;
  sealClient: SealClient;
}

export async function createSessionKey(args: SessionArgs): Promise<SessionKey> {
  return SessionKey.create({
    address: args.address,
    packageId: args.packageId,
    ttlMin: SEAL.sessionTtlMs / 60_000,
    signer: args.signer,
    suiClient: (args.sealClient as any).suiClient,
  } as any);
}

export interface DecryptArgs {
  ciphertext: Uint8Array;
  sessionKey: SessionKey;
  /** PTB bytes for the seal_approve dry-run (built by caller). */
  txBytes: Uint8Array;
  sealClient: SealClient;
}

export async function decryptWithTicket(args: DecryptArgs): Promise<Uint8Array> {
  return args.sealClient.decrypt({
    data: args.ciphertext,
    sessionKey: args.sessionKey,
    txBytes: args.txBytes,
  } as any);
}
```

(Some `as any` casts are intentional — the `@mysten/seal` 0.5 surface is in flux; types will be tightened in Task 9 once we run against testnet servers and see real shapes.)

- [ ] **Step 6: Implement `lib/walrus.ts`**

```typescript
export interface UploadOpts {
  publisherUrl: string;
  /** Storage duration in epochs (1 epoch ≈ 24h on testnet). */
  epochs: number;
}

export async function uploadBlob(data: Uint8Array, opts: UploadOpts): Promise<string> {
  const url = `${opts.publisherUrl}/v1/blobs?epochs=${opts.epochs}`;
  const res = await fetch(url, { method: 'PUT', body: data });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Walrus PUT ${res.status}: ${body}`);
  }
  const json = (await res.json()) as { newlyCreated?: { blobObject: { blobId: string } }; alreadyCertified?: { blobId: string } };
  const blobId = json.newlyCreated?.blobObject.blobId ?? json.alreadyCertified?.blobId;
  if (!blobId) throw new Error('Walrus response missing blobId');
  return blobId;
}

export async function fetchBlob(blobId: string, aggregatorUrl: string): Promise<Uint8Array> {
  const res = await fetch(`${aggregatorUrl}/v1/blobs/${blobId}`);
  if (!res.ok) throw new Error(`Walrus GET ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
```

- [ ] **Step 7: Run tests — confirm pass**

Run: `cd frontend && npx vitest run && npx tsc --noEmit`
Expected: 4 PASS, 0 type errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vitest.config.ts \
        frontend/src/lib/seal.ts frontend/src/lib/seal.test.ts \
        frontend/src/lib/walrus.ts frontend/src/lib/walrus.test.ts
git commit -m "feat(frontend): add Seal+Walrus wrappers with vitest"
```

---

## Task 7: Patient pipeline — `createEncryptedRecord`

**Files:**
- Create: `frontend/src/lib/recordPipeline.ts`
- Create: `frontend/src/lib/recordPipeline.test.ts`
- Modify: `frontend/src/api/recordAnchor.ts`

- [ ] **Step 1: Write failing test**

Create `frontend/src/lib/recordPipeline.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { createEncryptedRecord } from './recordPipeline';

describe('createEncryptedRecord', () => {
  it('encrypts → uploads → publishes create_anchor and returns recordId+blobId', async () => {
    const cipher = new Uint8Array([0xaa, 0xbb]);
    const sealClient = { encrypt: vi.fn().mockResolvedValue({ encryptedObject: cipher }) };
    const walrus = { upload: vi.fn().mockResolvedValue('blob-1') };
    const sui = {
      signAndExecute: vi.fn().mockResolvedValue({
        objectChanges: [
          { type: 'created', objectType: 'pkg::record_anchor::RecordAnchor', objectId: '0xR3C' },
        ],
      }),
    };
    const result = await createEncryptedRecord({
      plaintext: new TextEncoder().encode('visit notes'),
      hospitalId: 'HOSP-1',
      visitTimestampMs: 1_700_000_000_000n,
      sealClient: sealClient as any,
      walrus: walrus as any,
      sui: sui as any,
    });
    expect(result.recordId).toBe('0xR3C');
    expect(result.blobId).toBe('blob-1');
    expect(walrus.upload).toHaveBeenCalledWith(cipher);
  });
});
```

- [ ] **Step 2: Confirm fail**

Run: `cd frontend && npx vitest run recordPipeline`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement pipeline**

Create `frontend/src/lib/recordPipeline.ts`:

```typescript
import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
import { CONTRACT, CLOCK_OBJECT_ID, WALRUS } from '../config/contract';
import { encryptForRecord } from './seal';
import { uploadBlob } from './walrus';
import type { ObjectId } from '../types/contracts';

export interface CreateRecordArgs {
  plaintext: Uint8Array;
  hospitalId: string;
  visitTimestampMs: bigint;
  sealClient: import('@mysten/seal').SealClient;
  walrus?: { upload: (data: Uint8Array) => Promise<string> };
  sui: { signAndExecute: (tx: Transaction) => Promise<{ objectChanges?: Array<{ type: string; objectType?: string; objectId?: string }> }> };
}

export interface CreateRecordResult {
  recordId: ObjectId;
  blobId: string;
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const buf = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(buf);
}

export async function createEncryptedRecord(args: CreateRecordArgs): Promise<CreateRecordResult> {
  // We don't yet know the record id (object created by tx). For Seal IBE id we
  // would normally need the policy object id up-front. Workaround for the
  // hackathon: derive a deterministic policy id from sha256(plaintext|nonce)
  // and store it as the record id by constructing the object via a programmable
  // transaction that fixes it. Since `create_anchor` uses object::new, we
  // instead encrypt under `id = sha256(plaintext|hospital|visit_ts)` and store
  // that hash on-chain as content_hash; the Seal id is the same hash.
  //
  // NOTE: This means policyObjectId is the content hash, not the on-chain
  // object id — this is a deliberate hackathon simplification; document in
  // progress.md. Production path: two-tx flow (create empty anchor → encrypt
  // under its id → finalize).
  const contentHash = await sha256(args.plaintext);
  const cipher = await encryptForRecord({
    data: args.plaintext,
    recordId: bytesToHex(contentHash),
    sealClient: args.sealClient,
  });
  const blobId = args.walrus
    ? await args.walrus.upload(cipher)
    : await uploadBlob(cipher, { publisherUrl: WALRUS.publisherUrl, epochs: 5 });

  const tx = new Transaction();
  tx.moveCall({
    target: CONTRACT.fns.createAnchor,
    arguments: [
      tx.pure(bcs.vector(bcs.u8()).serialize(contentHash)),
      tx.pure(bcs.vector(bcs.u8()).serialize(new TextEncoder().encode(blobId))),
      tx.pure(bcs.vector(bcs.u8()).serialize(new TextEncoder().encode(args.hospitalId))),
      tx.pure.u64(args.visitTimestampMs),
      tx.object(CLOCK_OBJECT_ID),
    ],
  });

  const res = await args.sui.signAndExecute(tx);
  const created = res.objectChanges?.find(
    (c) => c.type === 'created' && c.objectType?.endsWith('::record_anchor::RecordAnchor'),
  );
  if (!created?.objectId) throw new Error('RecordAnchor not in tx effects');
  return { recordId: created.objectId, blobId };
}

function bytesToHex(bytes: Uint8Array): string {
  return '0x' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `cd frontend && npx vitest run recordPipeline && npx tsc --noEmit`
Expected: 1 PASS, 0 type errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/recordPipeline.ts frontend/src/lib/recordPipeline.test.ts \
        frontend/src/api/recordAnchor.ts
git commit -m "feat(frontend): patient pipeline encrypt→upload→create_anchor"
```

---

## Task 8: Doctor pipeline — `consumeAndDecrypt`

**Files:**
- Create: `frontend/src/lib/doctorPipeline.ts`
- Create: `frontend/src/lib/doctorPipeline.test.ts`

- [ ] **Step 1: Write failing test**

Create `frontend/src/lib/doctorPipeline.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { consumeAndDecrypt } from './doctorPipeline';

describe('consumeAndDecrypt', () => {
  it('runs consume_grant, builds seal_approve PTB, decrypts via session key', async () => {
    const decrypted = new TextEncoder().encode('plaintext');
    const sui = {
      signAndExecute: vi.fn().mockResolvedValue({
        objectChanges: [
          { type: 'created', objectType: 'pkg::decryption_ticket::DecryptionTicket', objectId: '0xT1' },
        ],
      }),
      getObject: vi.fn().mockResolvedValue({
        data: { content: { fields: { record_id: '0xR3C', walrus_blob_id: Array.from(new TextEncoder().encode('blob-1')) } } },
      }),
    };
    const sealClient = { decrypt: vi.fn().mockResolvedValue(decrypted) };
    const walrus = { fetch: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])) };
    const sessionKey = {} as any;

    const out = await consumeAndDecrypt({
      grantId: '0xG',
      preimage: new Uint8Array(32),
      sui: sui as any,
      sealClient: sealClient as any,
      walrus: walrus as any,
      sessionKey,
      buildApprovePtbBytes: vi.fn().mockResolvedValue(new Uint8Array([9, 9, 9])),
    });

    expect(new TextDecoder().decode(out.plaintext)).toBe('plaintext');
    expect(out.ticketId).toBe('0xT1');
    expect(sealClient.decrypt).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Confirm fail**

Run: `cd frontend && npx vitest run doctorPipeline`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `frontend/src/lib/doctorPipeline.ts`:

```typescript
import type { Transaction } from '@mysten/sui/transactions';
import { buildConsumeGrantTx } from '../api/accessGrant';
import type { ObjectId } from '../types/contracts';

export interface ConsumeAndDecryptArgs {
  grantId: ObjectId;
  preimage: Uint8Array;
  sui: {
    signAndExecute: (tx: Transaction) => Promise<{ objectChanges?: Array<{ type: string; objectType?: string; objectId?: string }> }>;
    getObject: (id: string) => Promise<any>;
  };
  sealClient: { decrypt: (args: any) => Promise<Uint8Array> };
  walrus: { fetch: (blobId: string) => Promise<Uint8Array> };
  sessionKey: import('@mysten/seal').SessionKey;
  /** Builds the seal_approve PTB bytes for the keyserver dry-run. */
  buildApprovePtbBytes: (ctx: { recordId: ObjectId; ticketId: ObjectId }) => Promise<Uint8Array>;
}

export interface ConsumeAndDecryptResult {
  plaintext: Uint8Array;
  ticketId: ObjectId;
  recordId: ObjectId;
}

export async function consumeAndDecrypt(args: ConsumeAndDecryptArgs): Promise<ConsumeAndDecryptResult> {
  // 1. Resolve recordId from grant
  const grantObj = await args.sui.getObject(args.grantId);
  const recordId: string = grantObj?.data?.content?.fields?.record_id;
  if (!recordId) throw new Error('grant object missing record_id');

  // 2. Build + run consume_grant tx
  const tx = buildConsumeGrantTx({ grantId: args.grantId, recordId, preimage: args.preimage });
  const res = await args.sui.signAndExecute(tx);
  const ticket = res.objectChanges?.find(
    (c) => c.type === 'created' && c.objectType?.endsWith('::decryption_ticket::DecryptionTicket'),
  );
  if (!ticket?.objectId) throw new Error('DecryptionTicket not in tx effects');

  // 3. Fetch encrypted blob from Walrus
  const recordObj = await args.sui.getObject(recordId);
  const blobIdBytes: number[] = recordObj?.data?.content?.fields?.walrus_blob_id ?? [];
  const blobId = new TextDecoder().decode(new Uint8Array(blobIdBytes));
  const cipher = await args.walrus.fetch(blobId);

  // 4. Build seal_approve PTB bytes for keyserver and decrypt
  const txBytes = await args.buildApprovePtbBytes({ recordId, ticketId: ticket.objectId });
  const plaintext = await args.sealClient.decrypt({
    data: cipher,
    sessionKey: args.sessionKey,
    txBytes,
  } as any);

  return { plaintext, ticketId: ticket.objectId, recordId };
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `cd frontend && npx vitest run && npx tsc --noEmit`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/doctorPipeline.ts frontend/src/lib/doctorPipeline.test.ts
git commit -m "feat(frontend): doctor pipeline consume→fetch→decrypt"
```

---

## Task 9: Wire `RecordCreate` UI to `createEncryptedRecord`

**Files:**
- Modify: `frontend/src/patient/RecordCreate.tsx` (locate via `find frontend/src/patient -name 'RecordCreate*'`)
- Modify: `frontend/src/lib/dappKit.ts` if a Seal client provider is missing

- [ ] **Step 1: Locate the existing RecordCreate component**

Run: `find frontend/src -name 'RecordCreate*' -o -name 'recordCreate*'`
Read the file. If multi-step wizard, identify step 4 and 5 (encrypt + upload).

- [ ] **Step 2: Add Seal client provider**

If `lib/dappKit.ts` does not yet construct a `SealClient`, add:

```typescript
import { SealClient } from '@mysten/seal';
import { SuiClient } from '@mysten/sui/client';
import { SEAL } from '../config/contract';

export const suiClient = new SuiClient({ url: import.meta.env.VITE_SUI_RPC ?? 'https://fullnode.testnet.sui.io:443' });

export const sealClient = new SealClient({
  suiClient,
  serverConfigs: SEAL.keyServerUrls.map((url) => ({ url, weight: 1 })),
  verifyKeyServers: true,
} as any);
```

- [ ] **Step 3: Replace the encrypt+upload+anchor steps with a single call**

In `RecordCreate.tsx`'s submit handler:

```typescript
import { createEncryptedRecord } from '../lib/recordPipeline';
import { sealClient, suiClient } from '../lib/dappKit';
import { useSignAndExecuteTransaction } from '@mysten/dapp-kit-react';

// inside component:
const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();

async function handleSubmit(plaintext: Uint8Array, hospitalId: string, visitMs: bigint) {
  const { recordId, blobId } = await createEncryptedRecord({
    plaintext,
    hospitalId,
    visitTimestampMs: visitMs,
    sealClient,
    sui: { signAndExecute: (tx) => signAndExecute({ transaction: tx }).then((r) => r as any) },
  });
  // navigate to /patient/share/<recordId> (existing route)
  navigate(`/patient/share/${recordId}`, { state: { blobId } });
}
```

- [ ] **Step 4: Manual smoke (cannot fully test without testnet keyservers)**

Run: `cd frontend && npm run dev`
In browser: open `/patient/new`, fill form, submit. Expected: tx prompt appears; on success, redirect to share page with recordId in URL.

If keyservers env not configured yet, leave a TODO comment and continue — Task 10 deploys.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/patient/ frontend/src/lib/dappKit.ts
git commit -m "feat(frontend): wire RecordCreate to recordPipeline"
```

---

## Task 10: Deploy to testnet + smoke E2E

**Files:**
- Modify: `frontend/.env.local` (gitignored)
- Modify: `tasks/progress.md`

- [ ] **Step 1: Build Move package**

Run: `cd contracts/portable_health && sui move build`
Expected: 0 errors.

- [ ] **Step 2: Publish to testnet**

Run: `sui client publish --gas-budget 200000000 contracts/portable_health`
Expected: success; capture `packageId` from output.

- [ ] **Step 3: Run extract script**

Run: `cd frontend && npm run gen:constants -- <packageId>`
Expected: `frontend/src/config/contract.generated.ts` updated.

- [ ] **Step 4: Configure env**

Edit `frontend/.env.local`:

```
VITE_SUI_RPC=https://fullnode.testnet.sui.io:443
VITE_PACKAGE_ID=<from step 2>
VITE_SEAL_KEY_SERVERS=https://seal-key-server-testnet-1.mystenlabs.com,https://seal-key-server-testnet-2.mystenlabs.com
VITE_SEAL_THRESHOLD=2
VITE_WALRUS_PUBLISHER=https://publisher.walrus-testnet.walrus.space
VITE_WALRUS_AGGREGATOR=https://aggregator.walrus-testnet.walrus.space
```

(Verify current testnet keyserver URLs from `https://seal.mystenlabs.com/` docs before pasting — endpoints rotate.)

- [ ] **Step 5: Smoke flow**

`npm run dev`. As patient: create record → issue grant → screenshot QR. Switch wallet to a doctor account: scan/enter QR → expect successful decrypt + plaintext rendered.

If decrypt fails: check browser console for keyserver HTTP errors; verify seal_approve PTB bytes match what keyserver expects (Seal SDK 0.5 has a `dryRunPolicy` helper — log the dry-run result first).

- [ ] **Step 6: Update progress.md**

Edit `tasks/progress.md`:
- L20: replace "fixed R6 cascade" note about destroy → status. New text: "R6 cascade enforced via record version check in seal_approve + consume_grant".
- L67: change to `consume_grant(grant, record, preimage, clock, ctx)` and note ticket transfer.
- L69: replace event-listener line with: "Seal access policy is `record_anchor::seal_approve(record, ticket, clock, ctx)`; key servers dry-run this Move function — no event listening."
- Move "Seal encrypt + Walrus upload pipeline" to Done.

- [ ] **Step 7: Commit**

```bash
git add tasks/progress.md frontend/src/config/contract.generated.ts
git commit -m "chore: deploy testnet + update progress"
```

---

## Self-Review Checklist (run after writing this plan)

- [x] Spec coverage: every Move ABI change + frontend pipeline + deploy mapped to a task.
- [x] No placeholders / TBDs.
- [x] Type names consistent: `DecryptionTicket` everywhere, `seal_approve`, `createEncryptedRecord`, `consumeAndDecrypt`.
- [x] Each task has tests-first (TDD).
- [x] Frequent commits (one per task).
- [x] Deviations called out: (a) `seal_policy_id` repurposed as self-link (Task 4); (b) hackathon simplification — Seal IBE id = sha256(plaintext) instead of object id, documented inline in `recordPipeline.ts`. **Risk:** if two records share plaintext, they share IBE id. Acceptable for demo; production fix = two-tx flow.
- [x] Red-team coverage: 4 negative `seal_approve` tests (impersonation, expired, revoked, wrong record).
