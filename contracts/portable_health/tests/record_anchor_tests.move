#[test_only]
module portable_health::record_anchor_tests;

use sui::clock;
use sui::test_scenario as ts;
use portable_health::record_anchor::{Self, RecordAnchor};

const PATIENT: address = @0xA11CE;
const STRANGER: address = @0xBEEF;

fun policy_id(): ID { object::id_from_address(@0xCAFE) }
fun valid_hash(): vector<u8> {
    // 32 bytes
    b"01234567890123456789012345678901"
}

#[test]
fun create_and_read() {
    let mut s = ts::begin(PATIENT);
    let mut clk = clock::create_for_testing(s.ctx());
    clk.set_for_testing(1_000_000);

    record_anchor::create_anchor(
        valid_hash(), b"walrusblob", b"HOSP-001", 999_000, &clk, s.ctx(),
    );

    s.next_tx(PATIENT);
    let r = s.take_shared<RecordAnchor>();
    assert!(record_anchor::patient(&r) == PATIENT, 0);
    assert!(record_anchor::is_active(&r), 1);
    assert!(record_anchor::content_hash(&r) == &valid_hash(), 2);
    ts::return_shared(r);

    clock::destroy_for_testing(clk);
    s.end();
}

#[test]
fun revoke_marks_tombstone() {
    let mut s = ts::begin(PATIENT);
    let mut clk = clock::create_for_testing(s.ctx());
    clk.set_for_testing(1_000_000);

    record_anchor::create_anchor(
        valid_hash(), b"b", b"H", 0, &clk, s.ctx(),
    );

    s.next_tx(PATIENT);
    let mut r = s.take_shared<RecordAnchor>();
    record_anchor::revoke_anchor(&mut r, &clk, s.ctx());
    assert!(!record_anchor::is_active(&r), 0);
    ts::return_shared(r);

    clock::destroy_for_testing(clk);
    s.end();
}

#[test, expected_failure(abort_code = record_anchor::ENotOwner)]
fun stranger_cannot_revoke() {
    let mut s = ts::begin(PATIENT);
    let mut clk = clock::create_for_testing(s.ctx());
    clk.set_for_testing(1_000_000);

    record_anchor::create_anchor(
        valid_hash(), b"b", b"H", 0, &clk, s.ctx(),
    );

    s.next_tx(STRANGER);
    let mut r = s.take_shared<RecordAnchor>();
    record_anchor::revoke_anchor(&mut r, &clk, s.ctx());
    ts::return_shared(r);
    clock::destroy_for_testing(clk);
    s.end();
}

#[test, expected_failure(abort_code = record_anchor::ETombstoned)]
fun double_revoke_fails() {
    let mut s = ts::begin(PATIENT);
    let mut clk = clock::create_for_testing(s.ctx());
    clk.set_for_testing(1_000_000);

    record_anchor::create_anchor(
        valid_hash(), b"b", b"H", 0, &clk, s.ctx(),
    );
    s.next_tx(PATIENT);
    let mut r = s.take_shared<RecordAnchor>();
    record_anchor::revoke_anchor(&mut r, &clk, s.ctx());
    record_anchor::revoke_anchor(&mut r, &clk, s.ctx());
    ts::return_shared(r);
    clock::destroy_for_testing(clk);
    s.end();
}

#[test, expected_failure(abort_code = record_anchor::EInvalidContentHash)]
fun reject_short_content_hash() {
    let mut s = ts::begin(PATIENT);
    let mut clk = clock::create_for_testing(s.ctx());
    clk.set_for_testing(1_000_000);
    record_anchor::create_anchor(
        b"too-short", b"b", b"H", 0, &clk, s.ctx(),
    );
    clock::destroy_for_testing(clk);
    s.end();
}

#[test, expected_failure(abort_code = record_anchor::EEmptyBlobId)]
fun reject_empty_blob_id() {
    let mut s = ts::begin(PATIENT);
    let mut clk = clock::create_for_testing(s.ctx());
    clk.set_for_testing(1_000_000);
    record_anchor::create_anchor(
        valid_hash(), b"", b"H", 0, &clk, s.ctx(),
    );
    clock::destroy_for_testing(clk);
    s.end();
}

#[test, expected_failure(abort_code = record_anchor::EEmptyHospitalId)]
fun reject_empty_hospital_id() {
    let mut s = ts::begin(PATIENT);
    let mut clk = clock::create_for_testing(s.ctx());
    clk.set_for_testing(1_000_000);
    record_anchor::create_anchor(
        valid_hash(), b"b", b"", 0, &clk, s.ctx(),
    );
    clock::destroy_for_testing(clk);
    s.end();
}
