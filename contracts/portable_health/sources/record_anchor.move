/// On-chain anchor for an off-chain (Walrus + Seal-encrypted) health record.
/// Stores only the ciphertext hash, Walrus blob reference, Seal policy ID,
/// hospital identifier, and timestamps. **No PHI on-chain.**
module portable_health::record_anchor;

use sui::event;
use portable_health::decryption_ticket::{Self, DecryptionTicket};

// === Errors ===

#[error]
const ENotOwner: vector<u8> = b"Caller is not the owner of this RecordAnchor";

#[error]
const ETombstoned: vector<u8> = b"RecordAnchor has already been revoked";

#[error]
const EInvalidContentHash: vector<u8> = b"content_hash must be 32 bytes (SHA-256)";

#[error]
const EEmptyBlobId: vector<u8> = b"walrus_blob_id must not be empty";

#[error]
const EEmptyHospitalId: vector<u8> = b"hospital_id must not be empty";

#[error]
const ENoAccess: vector<u8> = b"seal_approve: caller has no access to this record";

// === Constants ===

const VERSION_ACTIVE: u8 = 1;
const VERSION_TOMBSTONE: u8 = 255;
const CONTENT_HASH_LEN: u64 = 32;

// === Structs ===

/// Patient-owned anchor object. Held in the patient's address.
public struct RecordAnchor has key, store {
    id: UID,
    /// Address of the patient who owns this record.
    patient: address,
    /// SHA-256 hash of the Seal-wrapped ciphertext stored on Walrus.
    content_hash: vector<u8>,
    /// Walrus blob ID (opaque bytes).
    walrus_blob_id: vector<u8>,
    /// ID of the Seal policy object governing decryption access.
    seal_policy_id: ID,
    /// Opaque hospital identifier (e.g. NHI code, ISO facility ID).
    hospital_id: vector<u8>,
    /// Visit timestamp in milliseconds (provided by client; trusted to patient).
    visit_timestamp_ms: u64,
    /// On-chain creation timestamp from Clock.
    created_at_ms: u64,
    /// Schema version (1=active, 255=tombstone).
    version: u8,
    /// 0 = clinical record, 1 = longitudinal summary (versioned chain).
    kind: u8,
    /// Walrus blob id of the original image (empty for text-only / summary).
    image_blob_id: vector<u8>,
    /// For kind=1: number of records condensed. 0 for kind=0.
    covered_count: u64,
}

// === Events ===

public struct RecordCreated has copy, drop {
    record_id: ID,
    patient: address,
    content_hash: vector<u8>,
    hospital_id: vector<u8>,
    visit_timestamp_ms: u64,
    created_at_ms: u64,
    kind: u8,
    covered_count: u64,
}

public struct RecordRevoked has copy, drop {
    record_id: ID,
    patient: address,
    revoked_at_ms: u64,
}

// === Public functions ===

/// Create a new RecordAnchor as a SHARED object so doctor PTBs can reference it
/// during consume_grant (for is_active cross-check). Mutation still gated by
/// `record.patient == sender`. Privacy unchanged — only ciphertext hash on-chain.
public fun create_anchor(
    content_hash: vector<u8>,
    walrus_blob_id: vector<u8>,
    hospital_id: vector<u8>,
    visit_timestamp_ms: u64,
    kind: u8,
    image_blob_id: vector<u8>,
    covered_count: u64,
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
        kind,
        image_blob_id,
        covered_count,
    };

    event::emit(RecordCreated {
        record_id: object::id(&anchor),
        patient,
        content_hash: anchor.content_hash,
        hospital_id: anchor.hospital_id,
        visit_timestamp_ms,
        created_at_ms: now,
        kind,
        covered_count,
    });

    transfer::share_object(anchor);
}

/// Soft-delete a record by marking it tombstoned. Plaintext on Walrus
/// remains until Seal policy revocation; this is the on-chain signal.
public fun revoke_anchor(
    anchor: &mut RecordAnchor,
    clock: &sui::clock::Clock,
    ctx: &TxContext,
) {
    assert!(anchor.patient == ctx.sender(), ENotOwner);
    assert!(anchor.version != VERSION_TOMBSTONE, ETombstoned);

    anchor.version = VERSION_TOMBSTONE;
    let now = clock.timestamp_ms();

    event::emit(RecordRevoked {
        record_id: object::id(anchor),
        patient: anchor.patient,
        revoked_at_ms: now,
    });
}

// === Read accessors (used by access_grant for cross-module checks) ===

public fun id(anchor: &RecordAnchor): ID { object::id(anchor) }
public fun patient(anchor: &RecordAnchor): address { anchor.patient }
public fun is_active(anchor: &RecordAnchor): bool { anchor.version == VERSION_ACTIVE }
public fun content_hash(anchor: &RecordAnchor): &vector<u8> { &anchor.content_hash }
public fun walrus_blob_id(anchor: &RecordAnchor): &vector<u8> { &anchor.walrus_blob_id }
public fun seal_policy_id(anchor: &RecordAnchor): ID { anchor.seal_policy_id }
public fun kind(anchor: &RecordAnchor): u8 { anchor.kind }
public fun image_blob_id(anchor: &RecordAnchor): &vector<u8> { &anchor.image_blob_id }
public fun covered_count(anchor: &RecordAnchor): u64 { anchor.covered_count }

/// Seal access policy. Per Seal 1.x protocol the first parameter MUST be
/// `id: vector<u8>` — the IBE identity bytes the ciphertext was encrypted to.
/// Key servers dry-run this entry fn; success releases a key share. Aborts on
/// any failed condition:
///   1. `id` must equal the record's content_hash (IBE namespace)
///   2. ticket holder must be the tx sender (Seal sets sender from session)
///   3. ticket must reference this record
///   4. ticket must not be expired
///   5. record must still be active (not tombstoned)
entry fun seal_approve(
    id: vector<u8>,
    record: &RecordAnchor,
    ticket: &DecryptionTicket,
    clock: &sui::clock::Clock,
    ctx: &TxContext,
) {
    let now = clock.timestamp_ms();
    let ok = id == record.content_hash
        && decryption_ticket::holder(ticket) == ctx.sender()
        && decryption_ticket::record_id(ticket) == object::id(record)
        && now < decryption_ticket::expires_at_ms(ticket)
        && record.is_active();
    assert!(ok, ENoAccess);
}

#[test_only]
public fun version_active(): u8 { VERSION_ACTIVE }
#[test_only]
public fun version_tombstone(): u8 { VERSION_TOMBSTONE }
#[test_only]
public fun seal_approve_for_test(
    id: vector<u8>,
    record: &RecordAnchor,
    ticket: &DecryptionTicket,
    clock: &sui::clock::Clock,
    ctx: &TxContext,
) {
    seal_approve(id, record, ticket, clock, ctx)
}

/// Owner self-decrypt path. Patient can read their own record without a
/// DecryptionTicket. Intentionally ignores `is_active` (revoke only halts
/// new doctor grants; owner retains read access).
///   1. `id` must equal the record's content_hash (IBE namespace)
///   2. tx sender must be the record's patient
entry fun seal_approve_owner(
    id: vector<u8>,
    record: &RecordAnchor,
    ctx: &TxContext,
) {
    let ok = id == record.content_hash
        && record.patient == ctx.sender();
    assert!(ok, ENoAccess);
}

#[test_only]
public fun seal_approve_owner_for_test(
    id: vector<u8>,
    record: &RecordAnchor,
    ctx: &TxContext,
) {
    seal_approve_owner(id, record, ctx)
}
