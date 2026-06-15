#[test_only]
module portable_health::red_team;

use std::hash;
use sui::clock;
use sui::test_scenario as ts;
use portable_health::record_anchor::{Self, RecordAnchor};
use portable_health::access_grant::{Self, AccessGrant};

const PATIENT: address = @0xA11CE;
const DOCTOR: address = @0xD0C;
const ATTACKER: address = @0xBAD;

fun policy_id(): ID { object::id_from_address(@0xCAFE) }
fun valid_hash(): vector<u8> { b"01234567890123456789012345678901" }
fun preimage(): vector<u8> { b"super-secret-token-2026" }
fun token_hash(): vector<u8> { hash::sha3_256(preimage()) }

fun mk_record(s: &mut ts::Scenario, clk: &clock::Clock) {
    record_anchor::create_anchor(
        valid_hash(), b"walrusblob",
        b"HOSP-001", 999_000, clk, s.ctx(),
    );
}

// R1 — DEFENDED: Move u64 arithmetic auto-aborts on overflow
#[test, expected_failure(arithmetic_error, location = portable_health::access_grant)]
fun red_team_round_1_ttl_overflow() {
    let mut s = ts::begin(PATIENT);
    let mut clk = clock::create_for_testing(s.ctx());
    clk.set_for_testing(0xFFFFFFFFFFFFFFFFu64 - 1000);

    mk_record(&mut s, &clk);
    s.next_tx(PATIENT);
    let r = s.take_shared<RecordAnchor>();
    access_grant::issue_grant(&r, token_hash(), 0, access_grant::max_ttl_ms(), &clk, s.ctx());
    ts::return_shared(r);
    clock::destroy_for_testing(clk);
    s.end();
}

// R2 — PARTIAL fix: empty vector now rejected by length check.
// CAVEAT: sha3_256(b"") is still 32 bytes and would pass length check.
// Predictable-preimage attack must be prevented in patient app.
#[test, expected_failure(abort_code = access_grant::EInvalidTokenHashLen)]
fun red_team_round_2_short_token_hash_rejected() {
    let mut s = ts::begin(PATIENT);
    let mut clk = clock::create_for_testing(s.ctx());
    clk.set_for_testing(1_000_000);

    mk_record(&mut s, &clk);
    s.next_tx(PATIENT);
    let r = s.take_shared<RecordAnchor>();
    access_grant::issue_grant(&r, b"too-short", 0, 600_000, &clk, s.ctx());
    ts::return_shared(r);
    clock::destroy_for_testing(clk);
    s.end();
}

// R3 — DEFENDED: TTL upper bound
#[test, expected_failure(abort_code = access_grant::ETtlOutOfRange)]
fun red_team_round_3_ttl_above_max() {
    let mut s = ts::begin(PATIENT);
    let mut clk = clock::create_for_testing(s.ctx());
    clk.set_for_testing(1_000_000);

    mk_record(&mut s, &clk);
    s.next_tx(PATIENT);
    let r = s.take_shared<RecordAnchor>();
    access_grant::issue_grant(&r, token_hash(), 0, access_grant::max_ttl_ms() + 1, &clk, s.ctx());
    ts::return_shared(r);
    clock::destroy_for_testing(clk);
    s.end();
}

// R4 — DEFENDED: now == expires_at_ms boundary
#[test, expected_failure(abort_code = access_grant::EGrantExpired)]
fun red_team_round_4_consume_at_exact_expiry() {
    let mut s = ts::begin(PATIENT);
    let mut clk = clock::create_for_testing(s.ctx());
    let t0: u64 = 1_000_000;
    let ttl: u64 = 60_000;
    clk.set_for_testing(t0);

    mk_record(&mut s, &clk);
    s.next_tx(PATIENT);
    let r = s.take_shared<RecordAnchor>();
    access_grant::issue_grant(&r, token_hash(), 0, ttl, &clk, s.ctx());
    ts::return_shared(r);

    clk.set_for_testing(t0 + ttl);
    s.next_tx(DOCTOR);
    let r2 = s.take_shared<RecordAnchor>();
    let mut g = s.take_shared<AccessGrant>();
    access_grant::consume_grant(&mut g, &r2, preimage(), &clk, s.ctx());
    ts::return_shared(g);
    ts::return_shared(r2);
    clock::destroy_for_testing(clk);
    s.end();
}

// R5 — DEFENDED: double revoke grant
#[test, expected_failure(abort_code = access_grant::EGrantRevoked)]
fun red_team_round_5_double_revoke_grant() {
    let mut s = ts::begin(PATIENT);
    let mut clk = clock::create_for_testing(s.ctx());
    clk.set_for_testing(1_000_000);

    mk_record(&mut s, &clk);
    s.next_tx(PATIENT);
    let r = s.take_shared<RecordAnchor>();
    access_grant::issue_grant(&r, token_hash(), 0, 600_000, &clk, s.ctx());
    ts::return_shared(r);

    s.next_tx(PATIENT);
    let mut g = s.take_shared<AccessGrant>();
    access_grant::revoke_grant(&mut g, &clk, s.ctx());
    access_grant::revoke_grant(&mut g, &clk, s.ctx());
    ts::return_shared(g);
    clock::destroy_for_testing(clk);
    s.end();
}

// R6 — NOW DEFENDED: tombstone cascade enforced via consume_grant(&record)
#[test, expected_failure(abort_code = access_grant::ERecordRevoked)]
fun red_team_round_6_tombstone_cascade() {
    let mut s = ts::begin(PATIENT);
    let mut clk = clock::create_for_testing(s.ctx());
    clk.set_for_testing(1_000_000);

    mk_record(&mut s, &clk);
    s.next_tx(PATIENT);
    let mut r = s.take_shared<RecordAnchor>();
    access_grant::issue_grant(&r, token_hash(), 0, 600_000, &clk, s.ctx());
    record_anchor::revoke_anchor(&mut r, &clk, s.ctx());
    ts::return_shared(r);

    s.next_tx(DOCTOR);
    let r2 = s.take_shared<RecordAnchor>();
    let mut g = s.take_shared<AccessGrant>();
    access_grant::consume_grant(&mut g, &r2, preimage(), &clk, s.ctx()); // now blocked
    ts::return_shared(g);
    ts::return_shared(r2);
    clock::destroy_for_testing(clk);
    s.end();
}

// R7 — STILL EXPLOITED: duplicate token_hash across grants.
// Documented as client-side responsibility; per-record hash uniqueness
// would require a registry (overkill for hackathon).
#[test]
fun red_team_round_7_duplicate_token_hash_documented() {
    let mut s = ts::begin(PATIENT);
    let mut clk = clock::create_for_testing(s.ctx());
    clk.set_for_testing(1_000_000);

    mk_record(&mut s, &clk);
    s.next_tx(PATIENT);
    let r = s.take_shared<RecordAnchor>();
    access_grant::issue_grant(&r, token_hash(), 0, 600_000, &clk, s.ctx());
    access_grant::issue_grant(&r, token_hash(), 0, 600_000, &clk, s.ctx());
    ts::return_shared(r);

    s.next_tx(ATTACKER);
    let r2 = s.take_shared<RecordAnchor>();
    let mut g1 = s.take_shared<AccessGrant>();
    access_grant::consume_grant(&mut g1, &r2, preimage(), &clk, s.ctx());
    ts::return_shared(g1);
    let mut g2 = s.take_shared<AccessGrant>();
    access_grant::consume_grant(&mut g2, &r2, preimage(), &clk, s.ctx());
    ts::return_shared(g2);
    ts::return_shared(r2);

    clock::destroy_for_testing(clk);
    s.end();
}

// R8 — DEFENDED: cross-account grant issuance
#[test, expected_failure(abort_code = access_grant::ENotRecordOwner)]
fun red_team_round_8_cross_account_grant_issuance() {
    let mut s = ts::begin(PATIENT);
    let mut clk = clock::create_for_testing(s.ctx());
    clk.set_for_testing(1_000_000);

    mk_record(&mut s, &clk);
    s.next_tx(ATTACKER);
    let r = s.take_shared<RecordAnchor>();
    access_grant::issue_grant(&r, token_hash(), 0, 600_000, &clk, s.ctx());
    ts::return_shared(r);
    clock::destroy_for_testing(clk);
    s.end();
}

// R9 — NOW DEFENDED: revoke after consume blocked by !used assertion
#[test, expected_failure(abort_code = access_grant::EGrantUsed)]
fun red_team_round_9_revoke_after_consume_blocked() {
    let mut s = ts::begin(PATIENT);
    let mut clk = clock::create_for_testing(s.ctx());
    clk.set_for_testing(1_000_000);

    mk_record(&mut s, &clk);
    s.next_tx(PATIENT);
    let r = s.take_shared<RecordAnchor>();
    access_grant::issue_grant(&r, token_hash(), 0, 600_000, &clk, s.ctx());
    ts::return_shared(r);

    s.next_tx(DOCTOR);
    let r2 = s.take_shared<RecordAnchor>();
    let mut g = s.take_shared<AccessGrant>();
    access_grant::consume_grant(&mut g, &r2, preimage(), &clk, s.ctx());
    ts::return_shared(r2);

    s.next_tx(PATIENT);
    access_grant::revoke_grant(&mut g, &clk, s.ctx()); // now blocked
    ts::return_shared(g);

    clock::destroy_for_testing(clk);
    s.end();
}

// R10 — NOW DEFENDED: empty fields rejected by input validation
#[test, expected_failure(abort_code = record_anchor::EEmptyHospitalId)]
fun red_team_round_10_empty_hospital_id_rejected() {
    let mut s = ts::begin(PATIENT);
    let mut clk = clock::create_for_testing(s.ctx());
    clk.set_for_testing(1_000_000);
    record_anchor::create_anchor(
        valid_hash(), b"blob", b"", 0, &clk, s.ctx(),
    );
    clock::destroy_for_testing(clk);
    s.end();
}
