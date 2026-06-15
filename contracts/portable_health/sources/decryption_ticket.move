/// Owned capability minted by `access_grant::consume_grant` and used by
/// `record_anchor::seal_approve` as proof the holder consumed a valid grant.
/// Has `key` only (no `store`) so it cannot be transferred by users.
module portable_health::decryption_ticket;

// === Errors ===

#[error]
const EExpired: vector<u8> = b"DecryptionTicket has expired";

// === Structs ===

public struct DecryptionTicket has key {
    id: UID,
    record_id: ID,
    grant_id: ID,
    holder: address,
    expires_at_ms: u64,
}

// === Package-internal mint ===

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

// === Read accessors ===

public fun record_id(t: &DecryptionTicket): ID { t.record_id }
public fun grant_id(t: &DecryptionTicket): ID { t.grant_id }
public fun holder(t: &DecryptionTicket): address { t.holder }
public fun expires_at_ms(t: &DecryptionTicket): u64 { t.expires_at_ms }

// === Validation ===

public fun assert_fresh(t: &DecryptionTicket, now_ms: u64) {
    assert!(now_ms < t.expires_at_ms, EExpired);
}

// === Test helpers ===

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
