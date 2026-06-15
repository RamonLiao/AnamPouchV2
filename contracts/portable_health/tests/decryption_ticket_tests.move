#[test_only]
module portable_health::decryption_ticket_tests;

use sui::test_scenario as ts;
use sui::clock;
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
