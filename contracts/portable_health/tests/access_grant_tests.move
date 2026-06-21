#[test_only]
module portable_health::access_grant_tests;

use std::hash;
use sui::clock;
use sui::test_scenario as ts;
use portable_health::record_anchor::{Self, RecordAnchor};
use portable_health::access_grant::{Self, AccessGrant};

const PATIENT: address = @0xA11CE;
const DOCTOR: address = @0xD0C;

fun valid_hash(): vector<u8> { b"01234567890123456789012345678901" }
fun preimage(): vector<u8> { b"super-secret-token-2026" }

fun mk_record(s: &mut ts::Scenario, clk: &clock::Clock) {
    record_anchor::create_anchor(
        valid_hash(), b"walrusblob",
        b"HOSP-001", 999_000, 0, b"", 0, clk, s.ctx(),
    );
}

#[test]
fun issue_and_consume_happy_path() {
    let mut s = ts::begin(PATIENT);
    let mut clk = clock::create_for_testing(s.ctx());
    clk.set_for_testing(1_000_000);

    mk_record(&mut s, &clk);
    s.next_tx(PATIENT);
    let r = s.take_shared<RecordAnchor>();

    let token_hash = hash::sha3_256(preimage());
    access_grant::issue_grant(
        &r, token_hash, access_grant::scope_single(),
        access_grant::min_ttl_ms() * 10, &clk, s.ctx(),
    );
    ts::return_shared(r);

    s.next_tx(DOCTOR);
    let r2 = s.take_shared<RecordAnchor>();
    let mut g = s.take_shared<AccessGrant>();
    access_grant::consume_grant(&mut g, &r2, preimage(), &clk, s.ctx());
    assert!(access_grant::is_used(&g), 0);
    ts::return_shared(g);
    ts::return_shared(r2);

    clock::destroy_for_testing(clk);
    s.end();
}

#[test, expected_failure(abort_code = access_grant::EInvalidToken)]
fun wrong_preimage_fails() {
    let mut s = ts::begin(PATIENT);
    let mut clk = clock::create_for_testing(s.ctx());
    clk.set_for_testing(1_000_000);

    mk_record(&mut s, &clk);
    s.next_tx(PATIENT);
    let r = s.take_shared<RecordAnchor>();
    access_grant::issue_grant(&r, hash::sha3_256(preimage()), 0, 600_000, &clk, s.ctx());
    ts::return_shared(r);

    s.next_tx(DOCTOR);
    let r2 = s.take_shared<RecordAnchor>();
    let mut g = s.take_shared<AccessGrant>();
    access_grant::consume_grant(&mut g, &r2, b"wrong-token", &clk, s.ctx());
    ts::return_shared(g);
    ts::return_shared(r2);
    clock::destroy_for_testing(clk);
    s.end();
}

#[test, expected_failure(abort_code = access_grant::EGrantUsed)]
fun replay_fails() {
    let mut s = ts::begin(PATIENT);
    let mut clk = clock::create_for_testing(s.ctx());
    clk.set_for_testing(1_000_000);

    mk_record(&mut s, &clk);
    s.next_tx(PATIENT);
    let r = s.take_shared<RecordAnchor>();
    access_grant::issue_grant(&r, hash::sha3_256(preimage()), 0, 600_000, &clk, s.ctx());
    ts::return_shared(r);

    s.next_tx(DOCTOR);
    let r2 = s.take_shared<RecordAnchor>();
    let mut g = s.take_shared<AccessGrant>();
    access_grant::consume_grant(&mut g, &r2, preimage(), &clk, s.ctx());
    access_grant::consume_grant(&mut g, &r2, preimage(), &clk, s.ctx());
    ts::return_shared(g);
    ts::return_shared(r2);
    clock::destroy_for_testing(clk);
    s.end();
}

#[test, expected_failure(abort_code = access_grant::EGrantExpired)]
fun expired_fails() {
    let mut s = ts::begin(PATIENT);
    let mut clk = clock::create_for_testing(s.ctx());
    clk.set_for_testing(1_000_000);

    mk_record(&mut s, &clk);
    s.next_tx(PATIENT);
    let r = s.take_shared<RecordAnchor>();
    access_grant::issue_grant(&r, hash::sha3_256(preimage()), 0, 60_000, &clk, s.ctx());
    ts::return_shared(r);

    clk.set_for_testing(1_000_000 + 60_001);

    s.next_tx(DOCTOR);
    let r2 = s.take_shared<RecordAnchor>();
    let mut g = s.take_shared<AccessGrant>();
    access_grant::consume_grant(&mut g, &r2, preimage(), &clk, s.ctx());
    ts::return_shared(g);
    ts::return_shared(r2);
    clock::destroy_for_testing(clk);
    s.end();
}

#[test, expected_failure(abort_code = access_grant::EGrantRevoked)]
fun revoked_fails() {
    let mut s = ts::begin(PATIENT);
    let mut clk = clock::create_for_testing(s.ctx());
    clk.set_for_testing(1_000_000);

    mk_record(&mut s, &clk);
    s.next_tx(PATIENT);
    let r = s.take_shared<RecordAnchor>();
    access_grant::issue_grant(&r, hash::sha3_256(preimage()), 0, 600_000, &clk, s.ctx());
    ts::return_shared(r);

    s.next_tx(PATIENT);
    let mut g = s.take_shared<AccessGrant>();
    access_grant::revoke_grant(&mut g, &clk, s.ctx());

    s.next_tx(DOCTOR);
    let r2 = s.take_shared<RecordAnchor>();
    access_grant::consume_grant(&mut g, &r2, preimage(), &clk, s.ctx());
    ts::return_shared(g);
    ts::return_shared(r2);
    clock::destroy_for_testing(clk);
    s.end();
}

#[test, expected_failure(abort_code = access_grant::ENotIssuer)]
fun stranger_cannot_revoke() {
    let mut s = ts::begin(PATIENT);
    let mut clk = clock::create_for_testing(s.ctx());
    clk.set_for_testing(1_000_000);

    mk_record(&mut s, &clk);
    s.next_tx(PATIENT);
    let r = s.take_shared<RecordAnchor>();
    access_grant::issue_grant(&r, hash::sha3_256(preimage()), 0, 600_000, &clk, s.ctx());
    ts::return_shared(r);

    s.next_tx(DOCTOR);
    let mut g = s.take_shared<AccessGrant>();
    access_grant::revoke_grant(&mut g, &clk, s.ctx());
    ts::return_shared(g);
    clock::destroy_for_testing(clk);
    s.end();
}

#[test, expected_failure(abort_code = access_grant::ETtlOutOfRange)]
fun ttl_too_short_fails() {
    let mut s = ts::begin(PATIENT);
    let mut clk = clock::create_for_testing(s.ctx());
    clk.set_for_testing(1_000_000);

    mk_record(&mut s, &clk);
    s.next_tx(PATIENT);
    let r = s.take_shared<RecordAnchor>();
    access_grant::issue_grant(&r, hash::sha3_256(preimage()), 0, 1000, &clk, s.ctx());
    ts::return_shared(r);
    clock::destroy_for_testing(clk);
    s.end();
}

#[test, expected_failure(abort_code = access_grant::EInvalidScope)]
fun invalid_scope_fails() {
    let mut s = ts::begin(PATIENT);
    let mut clk = clock::create_for_testing(s.ctx());
    clk.set_for_testing(1_000_000);

    mk_record(&mut s, &clk);
    s.next_tx(PATIENT);
    let r = s.take_shared<RecordAnchor>();
    access_grant::issue_grant(&r, hash::sha3_256(preimage()), 9, 600_000, &clk, s.ctx());
    ts::return_shared(r);
    clock::destroy_for_testing(clk);
    s.end();
}

// === Helpers for compose_mints_ticket test ===

#[test_only]
fun setup_issued_grant(): (ts::Scenario, clock::Clock, ID, ID, vector<u8>) {
    let preimage_bytes = preimage();
    let token_hash = hash::sha3_256(preimage_bytes);

    let mut s = ts::begin(PATIENT);
    let mut clk = clock::create_for_testing(s.ctx());
    clk.set_for_testing(1_000_000);

    mk_record(&mut s, &clk);
    s.next_tx(PATIENT);
    let r = s.take_shared<RecordAnchor>();
    let record_id = record_anchor::id(&r);
    access_grant::issue_grant(
        &r, token_hash, access_grant::scope_single(),
        access_grant::min_ttl_ms() * 10, &clk, s.ctx(),
    );
    ts::return_shared(r);

    s.next_tx(PATIENT);
    let g = s.take_shared<AccessGrant>();
    let grant_id = object::id(&g);
    ts::return_shared(g);

    (s, clk, record_id, grant_id, preimage_bytes)
}

#[test_only]
fun teardown(s: ts::Scenario, clk: clock::Clock) {
    clock::destroy_for_testing(clk);
    s.end();
}

#[test, expected_failure(abort_code = access_grant::ERecordTombstoned)]
fun cannot_grant_on_tombstoned() {
    let mut s = ts::begin(PATIENT);
    let mut clk = clock::create_for_testing(s.ctx());
    clk.set_for_testing(1_000_000);

    mk_record(&mut s, &clk);
    s.next_tx(PATIENT);
    let mut r = s.take_shared<RecordAnchor>();
    record_anchor::revoke_anchor(&mut r, &clk, s.ctx());
    access_grant::issue_grant(&r, hash::sha3_256(preimage()), 0, 600_000, &clk, s.ctx());
    ts::return_shared(r);
    clock::destroy_for_testing(clk);
    s.end();
}

#[test]
fun consume_mints_ticket_to_doctor() {
    use portable_health::decryption_ticket::{Self, DecryptionTicket};
    let (mut s, clk, record_id, grant_id, preimage_bytes) = setup_issued_grant();

    ts::next_tx(&mut s, DOCTOR);
    {
        let mut grant = ts::take_shared_by_id<AccessGrant>(&s, grant_id);
        let record = ts::take_shared_by_id<RecordAnchor>(&s, record_id);
        access_grant::consume_grant(
            &mut grant, &record, preimage_bytes, &clk, ts::ctx(&mut s)
        );
        ts::return_shared(grant);
        ts::return_shared(record);
    };
    ts::next_tx(&mut s, DOCTOR);
    let ticket = ts::take_from_sender<DecryptionTicket>(&s);
    assert!(decryption_ticket::record_id(&ticket) == record_id, 0);
    assert!(decryption_ticket::grant_id(&ticket) == grant_id, 1);
    assert!(decryption_ticket::holder(&ticket) == DOCTOR, 2);
    ts::return_to_sender(&s, ticket);

    teardown(s, clk);
}
