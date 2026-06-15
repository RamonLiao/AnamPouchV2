#[test_only]
module portable_health::seal_approve_tests;

use sui::test_scenario as ts;
use sui::clock;
use portable_health::record_anchor::{Self, RecordAnchor};
use portable_health::decryption_ticket::{Self, DecryptionTicket};

const PATIENT: address = @0x9A7;
const DOCTOR: address = @0xD0C;
const ATTACKER: address = @0xBAD;

fun zero_hash(): vector<u8> { std::vector::tabulate!(32, |_| 0u8) }

fun setup_record(s: &mut ts::Scenario): ID {
    let clk = clock::create_for_testing(ts::ctx(s));
    record_anchor::create_anchor(
        zero_hash(),
        b"blob1",
        b"hosp1",
        1_000,
        &clk,
        ts::ctx(s),
    );
    clock::destroy_for_testing(clk);
    ts::next_tx(s, PATIENT);
    let r = ts::take_shared<RecordAnchor>(s);
    let rid = record_anchor::id(&r);
    ts::return_shared(r);
    rid
}

#[test]
fun approves_when_holder_matches_and_active_and_fresh() {
    let mut s = ts::begin(PATIENT);
    let rid = setup_record(&mut s);
    let mut clk = clock::create_for_testing(ts::ctx(&mut s));
    clock::set_for_testing(&mut clk, 1_000);
    decryption_ticket::mint_for_test(rid, object::id_from_address(@0xB), DOCTOR, 5_000, ts::ctx(&mut s));
    ts::next_tx(&mut s, DOCTOR);
    let t = ts::take_from_sender<DecryptionTicket>(&s);
    let r = ts::take_shared<RecordAnchor>(&s);
    record_anchor::seal_approve_for_test(zero_hash(), &r, &t, &clk, ts::ctx(&mut s));
    ts::return_shared(r);
    ts::return_to_sender(&s, t);
    clock::destroy_for_testing(clk);
    ts::end(s);
}

#[test]
#[expected_failure]
fun rejects_when_id_mismatch() {
    let mut s = ts::begin(PATIENT);
    let rid = setup_record(&mut s);
    let mut clk = clock::create_for_testing(ts::ctx(&mut s));
    clock::set_for_testing(&mut clk, 1_000);
    decryption_ticket::mint_for_test(rid, object::id_from_address(@0xB), DOCTOR, 5_000, ts::ctx(&mut s));
    ts::next_tx(&mut s, DOCTOR);
    let t = ts::take_from_sender<DecryptionTicket>(&s);
    let r = ts::take_shared<RecordAnchor>(&s);
    record_anchor::seal_approve_for_test(b"wrong_id", &r, &t, &clk, ts::ctx(&mut s));
    ts::return_shared(r);
    ts::return_to_sender(&s, t);
    clock::destroy_for_testing(clk);
    ts::end(s);
}

#[test]
#[expected_failure]
fun rejects_when_record_id_mismatch() {
    let mut s = ts::begin(PATIENT);
    let rid = setup_record(&mut s);
    let _ = rid;
    let mut clk = clock::create_for_testing(ts::ctx(&mut s));
    clock::set_for_testing(&mut clk, 1_000);
    decryption_ticket::mint_for_test(object::id_from_address(@0xDEAD), object::id_from_address(@0xB), DOCTOR, 5_000, ts::ctx(&mut s));
    ts::next_tx(&mut s, DOCTOR);
    let t = ts::take_from_sender<DecryptionTicket>(&s);
    let r = ts::take_shared<RecordAnchor>(&s);
    record_anchor::seal_approve_for_test(zero_hash(), &r, &t, &clk, ts::ctx(&mut s));
    ts::return_shared(r);
    ts::return_to_sender(&s, t);
    clock::destroy_for_testing(clk);
    ts::end(s);
}

#[test]
#[expected_failure]
fun rejects_when_sender_is_not_holder() {
    let mut s = ts::begin(PATIENT);
    let rid = setup_record(&mut s);
    let mut clk = clock::create_for_testing(ts::ctx(&mut s));
    clock::set_for_testing(&mut clk, 1_000);
    decryption_ticket::mint_for_test(rid, object::id_from_address(@0xB), DOCTOR, 5_000, ts::ctx(&mut s));
    ts::next_tx(&mut s, DOCTOR);
    let t = ts::take_from_sender<DecryptionTicket>(&s);
    ts::next_tx(&mut s, ATTACKER);
    let r = ts::take_shared<RecordAnchor>(&s);
    record_anchor::seal_approve_for_test(zero_hash(), &r, &t, &clk, ts::ctx(&mut s));
    ts::return_shared(r);
    ts::next_tx(&mut s, DOCTOR);
    ts::return_to_sender(&s, t);
    clock::destroy_for_testing(clk);
    ts::end(s);
}

#[test]
#[expected_failure]
fun rejects_when_ticket_expired() {
    let mut s = ts::begin(PATIENT);
    let rid = setup_record(&mut s);
    let mut clk = clock::create_for_testing(ts::ctx(&mut s));
    clock::set_for_testing(&mut clk, 1_000);
    decryption_ticket::mint_for_test(rid, object::id_from_address(@0xB), DOCTOR, 500, ts::ctx(&mut s));
    ts::next_tx(&mut s, DOCTOR);
    let t = ts::take_from_sender<DecryptionTicket>(&s);
    let r = ts::take_shared<RecordAnchor>(&s);
    record_anchor::seal_approve_for_test(zero_hash(), &r, &t, &clk, ts::ctx(&mut s));
    ts::return_shared(r);
    ts::return_to_sender(&s, t);
    clock::destroy_for_testing(clk);
    ts::end(s);
}

#[test]
#[expected_failure]
fun rejects_at_exact_expiry_boundary() {
    let mut s = ts::begin(PATIENT);
    let rid = setup_record(&mut s);
    let mut clk = clock::create_for_testing(ts::ctx(&mut s));
    clock::set_for_testing(&mut clk, 1_000);
    decryption_ticket::mint_for_test(rid, object::id_from_address(@0xB), DOCTOR, 1_000, ts::ctx(&mut s));
    ts::next_tx(&mut s, DOCTOR);
    let t = ts::take_from_sender<DecryptionTicket>(&s);
    let r = ts::take_shared<RecordAnchor>(&s);
    record_anchor::seal_approve_for_test(zero_hash(), &r, &t, &clk, ts::ctx(&mut s));
    ts::return_shared(r);
    ts::return_to_sender(&s, t);
    clock::destroy_for_testing(clk);
    ts::end(s);
}

// === seal_approve_owner (patient self-decrypt) ===

#[test]
fun owner_approves_when_sender_is_patient() {
    let mut s = ts::begin(PATIENT);
    let _rid = setup_record(&mut s);
    ts::next_tx(&mut s, PATIENT);
    let r = ts::take_shared<RecordAnchor>(&s);
    record_anchor::seal_approve_owner_for_test(zero_hash(), &r, ts::ctx(&mut s));
    ts::return_shared(r);
    ts::end(s);
}

#[test]
#[expected_failure]
fun owner_rejects_when_sender_is_not_patient() {
    let mut s = ts::begin(PATIENT);
    let _rid = setup_record(&mut s);
    ts::next_tx(&mut s, ATTACKER);
    let r = ts::take_shared<RecordAnchor>(&s);
    record_anchor::seal_approve_owner_for_test(zero_hash(), &r, ts::ctx(&mut s));
    ts::return_shared(r);
    ts::end(s);
}

#[test]
#[expected_failure]
fun owner_rejects_when_id_mismatch() {
    let mut s = ts::begin(PATIENT);
    let _rid = setup_record(&mut s);
    ts::next_tx(&mut s, PATIENT);
    let r = ts::take_shared<RecordAnchor>(&s);
    record_anchor::seal_approve_owner_for_test(b"wrong_id", &r, ts::ctx(&mut s));
    ts::return_shared(r);
    ts::end(s);
}

#[test]
fun owner_approves_even_when_record_revoked() {
    let mut s = ts::begin(PATIENT);
    let _rid = setup_record(&mut s);
    let clk = clock::create_for_testing(ts::ctx(&mut s));
    ts::next_tx(&mut s, PATIENT);
    {
        let mut r = ts::take_shared<RecordAnchor>(&s);
        record_anchor::revoke_anchor(&mut r, &clk, ts::ctx(&mut s));
        ts::return_shared(r);
    };
    ts::next_tx(&mut s, PATIENT);
    let r = ts::take_shared<RecordAnchor>(&s);
    record_anchor::seal_approve_owner_for_test(zero_hash(), &r, ts::ctx(&mut s));
    ts::return_shared(r);
    clock::destroy_for_testing(clk);
    ts::end(s);
}

#[test]
#[expected_failure]
fun rejects_when_record_revoked() {
    let mut s = ts::begin(PATIENT);
    let rid = setup_record(&mut s);
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
    record_anchor::seal_approve_for_test(zero_hash(), &r, &t, &clk, ts::ctx(&mut s));
    ts::return_shared(r);
    ts::return_to_sender(&s, t);
    clock::destroy_for_testing(clk);
    ts::end(s);
}
