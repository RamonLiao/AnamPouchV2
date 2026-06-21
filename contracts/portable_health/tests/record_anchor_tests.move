#[test_only]
module portable_health::record_anchor_tests;

use sui::clock;
use sui::test_scenario as ts;
use portable_health::record_anchor::{Self, RecordAnchor};
use portable_health::decryption_ticket;

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
        valid_hash(), b"walrusblob", b"HOSP-001", 999_000, 0, b"", 0, &clk, s.ctx(),
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
        valid_hash(), b"b", b"H", 0, 0, b"", 0, &clk, s.ctx(),
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
        valid_hash(), b"b", b"H", 0, 0, b"", 0, &clk, s.ctx(),
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
        valid_hash(), b"b", b"H", 0, 0, b"", 0, &clk, s.ctx(),
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
        b"too-short", b"b", b"H", 0, 0, b"", 0, &clk, s.ctx(),
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
        valid_hash(), b"", b"H", 0, 0, b"", 0, &clk, s.ctx(),
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
        valid_hash(), b"b", b"", 0, 0, b"", 0, &clk, s.ctx(),
    );
    clock::destroy_for_testing(clk);
    s.end();
}

#[test]
fun test_create_summary_anchor_fields() {
    let mut ts = ts::begin(@0xCA11);
    let clock = clock::create_for_testing(ts.ctx());
    {
        record_anchor::create_anchor(
            b"01234567890123456789012345678901", // 32-byte content_hash
            b"summary-blob",
            b"hospital-x",
            1000,
            1,                 // kind = summary
            b"",               // image_blob_id empty for summary
            7,                 // covered_count
            &clock,
            ts.ctx(),
        );
    };
    ts.next_tx(@0xCA11);
    {
        let anchor = ts.take_shared<RecordAnchor>();
        assert!(record_anchor::kind(&anchor) == 1, 0);
        assert!(record_anchor::covered_count(&anchor) == 7, 1);
        assert!(record_anchor::image_blob_id(&anchor).length() == 0, 2);
        ts::return_shared(anchor);
    };
    clock::destroy_for_testing(clock);
    ts.end();
}

#[test, expected_failure(abort_code = record_anchor::ENoAccess)]
fun summary_anchor_revoked_seal_approve_aborts() {
    let mut s = ts::begin(PATIENT);
    let mut clk = clock::create_for_testing(s.ctx());
    clk.set_for_testing(1_000);
    // Create kind=1 summary anchor
    record_anchor::create_anchor(
        valid_hash(), b"summary-blob", b"HOSP-001", 999_000,
        1, b"", 7,
        &clk, s.ctx(),
    );
    // Mint a ticket before revoke so rid is valid
    s.next_tx(PATIENT);
    let anchor = s.take_shared<RecordAnchor>();
    let rid = record_anchor::id(&anchor);
    ts::return_shared(anchor);
    decryption_ticket::mint_for_test(rid, object::id_from_address(@0xB), PATIENT, 5_000, s.ctx());
    // Revoke the anchor
    s.next_tx(PATIENT);
    {
        let mut r = s.take_shared<RecordAnchor>();
        record_anchor::revoke_anchor(&mut r, &clk, s.ctx());
        ts::return_shared(r);
    };
    // seal_approve must abort with ENoAccess
    s.next_tx(PATIENT);
    let t = s.take_from_sender<portable_health::decryption_ticket::DecryptionTicket>();
    let r = s.take_shared<RecordAnchor>();
    record_anchor::seal_approve_for_test(valid_hash(), &r, &t, &clk, s.ctx());
    ts::return_shared(r);
    ts::return_to_sender(&s, t);
    clock::destroy_for_testing(clk);
    s.end();
}
