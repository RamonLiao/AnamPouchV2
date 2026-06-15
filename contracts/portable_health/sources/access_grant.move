/// Time-locked, single-use access capability for a RecordAnchor.
/// Patient issues a grant by anchoring sha3_256(token_preimage) on-chain.
/// Doctor consumes by presenting the preimage (transmitted out-of-band via QR).
/// `consume_grant` atomically mints a `DecryptionTicket` capability to the consumer;
/// Seal key servers then dry-run `record_anchor::seal_approve(record, ticket, ...)`
/// as the on-chain access policy (no event-based release).
module portable_health::access_grant;

use std::hash;
use sui::clock::Clock;
use sui::event;
use portable_health::record_anchor::{Self, RecordAnchor};
use portable_health::decryption_ticket;

// === Errors ===

#[error]
const ENotIssuer: vector<u8> = b"Only the issuing patient can revoke this grant";

#[error]
const EGrantExpired: vector<u8> = b"AccessGrant has expired";

#[error]
const EGrantUsed: vector<u8> = b"AccessGrant already consumed (single-use)";

#[error]
const EGrantRevoked: vector<u8> = b"AccessGrant has been revoked by issuer";

#[error]
const EInvalidToken: vector<u8> = b"Token preimage does not match stored hash";

#[error]
const EInvalidScope: vector<u8> = b"Scope must be 0, 1, or 2";

#[error]
const ETtlOutOfRange: vector<u8> = b"TTL must be between 60s and 30 days";

#[error]
const ERecordTombstoned: vector<u8> = b"Cannot issue grant for revoked record";

#[error]
const ENotRecordOwner: vector<u8> = b"Only the record patient can issue grants";

#[error]
const EInvalidTokenHashLen: vector<u8> = b"token_hash must be 32 bytes (sha3-256)";

#[error]
const ERecordMismatch: vector<u8> = b"Record object does not match grant.record_id";

#[error]
const ERecordRevoked: vector<u8> = b"Underlying RecordAnchor has been revoked (cascade)";

// === Constants ===

#[allow(unused_const)]
const SCOPE_SINGLE: u8 = 0;
#[allow(unused_const)]
const SCOPE_PERIOD: u8 = 1;
const SCOPE_DISEASE: u8 = 2;

/// How long the minted DecryptionTicket stays valid (independent of grant TTL).
const TICKET_TTL_MS: u64 = 5 * 60 * 1000; // 5 minutes

const MIN_TTL_MS: u64 = 60_000;              // 1 minute
const MAX_TTL_MS: u64 = 30 * 24 * 60 * 60 * 1000; // 30 days
const TOKEN_HASH_LEN: u64 = 32;

// === Structs ===

/// Shared object so any address holding the token preimage can consume it.
/// Authorization is enforced by hash(preimage) == grantee_token_hash, not by ownership.
public struct AccessGrant has key {
    id: UID,
    record_id: ID,
    issuer: address,
    /// sha3_256 of the one-time token; preimage travels via QR, never on-chain.
    grantee_token_hash: vector<u8>,
    /// Reserved for v2: link to a HospitalRegistry::DoctorCap object.
    grantee_doctor_cap: Option<ID>,
    /// 0 = single visit, 1 = time period, 2 = disease scope.
    scope: u8,
    expires_at_ms: u64,
    used: bool,
    revoked: bool,
}

// === Events ===

public struct GrantIssued has copy, drop {
    grant_id: ID,
    record_id: ID,
    issuer: address,
    scope: u8,
    expires_at_ms: u64,
    issued_at_ms: u64,
}

public struct GrantConsumed has copy, drop {
    grant_id: ID,
    record_id: ID,
    consumer: address,
    consumed_at_ms: u64,
}

public struct GrantRevoked has copy, drop {
    grant_id: ID,
    record_id: ID,
    revoked_at_ms: u64,
}

// === Public functions ===

/// Patient issues a one-time access grant for one of their records.
/// `token_hash` must be sha3_256 of a high-entropy preimage held by the patient.
public fun issue_grant(
    record: &RecordAnchor,
    token_hash: vector<u8>,
    scope: u8,
    ttl_ms: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(record_anchor::patient(record) == ctx.sender(), ENotRecordOwner);
    assert!(record_anchor::is_active(record), ERecordTombstoned);
    assert!(scope <= SCOPE_DISEASE, EInvalidScope);
    assert!(ttl_ms >= MIN_TTL_MS && ttl_ms <= MAX_TTL_MS, ETtlOutOfRange);
    assert!(token_hash.length() == TOKEN_HASH_LEN, EInvalidTokenHashLen);

    let now = clock.timestamp_ms();
    let expires_at_ms = now + ttl_ms;

    let grant = AccessGrant {
        id: object::new(ctx),
        record_id: record_anchor::id(record),
        issuer: ctx.sender(),
        grantee_token_hash: token_hash,
        grantee_doctor_cap: option::none(),
        scope,
        expires_at_ms,
        used: false,
        revoked: false,
    };

    event::emit(GrantIssued {
        grant_id: object::id(&grant),
        record_id: grant.record_id,
        issuer: grant.issuer,
        scope,
        expires_at_ms,
        issued_at_ms: now,
    });

    transfer::share_object(grant);
}

/// Doctor (or any holder of the preimage) consumes the grant.
/// Atomically: verify record cascade → preimage → expiry/used/revoked → mark used.
/// `record` MUST be the shared RecordAnchor referenced by `grant.record_id`.
/// This enforces tombstone cascade: revoking the record kills all live grants
/// (R6 hardening from red-team report).
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

/// Patient revokes a grant before it is consumed (or even after — Seal will refuse
/// future decryption attempts that race past consumption).
public fun revoke_grant(
    grant: &mut AccessGrant,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert!(grant.issuer == ctx.sender(), ENotIssuer);
    assert!(!grant.revoked, EGrantRevoked);
    assert!(!grant.used, EGrantUsed);

    grant.revoked = true;
    let now = clock.timestamp_ms();

    event::emit(GrantRevoked {
        grant_id: object::id(grant),
        record_id: grant.record_id,
        revoked_at_ms: now,
    });
}

// === Read accessors ===

public fun record_id(grant: &AccessGrant): ID { grant.record_id }
public fun issuer(grant: &AccessGrant): address { grant.issuer }
public fun scope(grant: &AccessGrant): u8 { grant.scope }
public fun expires_at_ms(grant: &AccessGrant): u64 { grant.expires_at_ms }
public fun is_used(grant: &AccessGrant): bool { grant.used }
public fun is_revoked(grant: &AccessGrant): bool { grant.revoked }

#[test_only]
public fun scope_single(): u8 { SCOPE_SINGLE }
#[test_only]
public fun scope_period(): u8 { SCOPE_PERIOD }
#[test_only]
public fun scope_disease(): u8 { SCOPE_DISEASE }
#[test_only]
public fun min_ttl_ms(): u64 { MIN_TTL_MS }
#[test_only]
public fun max_ttl_ms(): u64 { MAX_TTL_MS }
