#[test_only]
module hummingbird::marketplace_tests {
    use hummingbird::registry::{Self, GlobalRegistry, AsRegistry, AsAuthCap};
    use hummingbird::marketplace::{
        Self, Router,
        EInsufficientPayment, EInvalidInterval, EInvalidBandwidth,
        EInvalidTimeGranularity, EInvalidMinBandwidth, ENotSeller, EUnauthorized,
        SellerAuthToken,
    };
    use hummingbird::hummingbird_asset::{Self, HummingbirdAsset};
    use sui::test_scenario::{Self, Scenario};
    use sui::transfer;
    use sui::sui::SUI;
    use sui::coin::{Self, Coin};
    use sui::object::ID;

    const INGRESS: u8 = 0;
    const EGRESS:  u8 = 1;

    const AS_ADDR:   address = @0xA5;
    const USER_ADDR: address = @0xB0;

    const ISD_AS:    u64 = 1_001;
    const ROUTER_ID: u64 = 7;
    const IFACE_ID:  u16 = 42;

    const BANDWIDTH:       u64 = 1_000_000;   // 1 Gbps in kbps units
    const START_TIME:      u64 = 1_700_000_000_000; // ms epoch
    const EXP_TIME:        u64 = 1_700_000_000_000 + 3_600_000; // +1 hour
    const TIME_GRAN:       u64 = 300_000; // 5 minutes
    const MIN_BW:          u64 = 10_000;  // 10 Mbps
    const PRICE:           u64 = 1_000;
    const COIN_VAL:        u64 = 2_000;

    // ---- Helpers ----

    fun setup(): Scenario {
        let scenario = test_scenario::begin(AS_ADDR);
        registry::create_and_share_global_registry(test_scenario::ctx(&mut scenario));
        test_scenario::next_tx(&mut scenario, AS_ADDR);
        {
            let mut global = test_scenario::take_shared<GlobalRegistry>(&scenario);
            registry::register_as_to_sender(&mut global, ISD_AS, test_scenario::ctx(&mut scenario));
            test_scenario::return_shared(global);
        };
        test_scenario::next_tx(&mut scenario, AS_ADDR);
        {
            let mut as_reg = test_scenario::take_shared<AsRegistry>(&scenario);
            let cap = test_scenario::take_from_sender<AsAuthCap>(&scenario);
            marketplace::create_router<SUI>(&mut as_reg, &cap, ROUTER_ID, IFACE_ID, INGRESS, test_scenario::ctx(&mut scenario));
            test_scenario::return_to_sender(&mut scenario, cap);
            test_scenario::return_shared(as_reg);
        };
        test_scenario::next_tx(&mut scenario, AS_ADDR);
        marketplace::register_seller_to_sender(AS_ADDR, test_scenario::ctx(&mut scenario));
        test_scenario::next_tx(&mut scenario, AS_ADDR);
        // mint buyer coin
        let coin = coin::mint_for_testing<SUI>(COIN_VAL, test_scenario::ctx(&mut scenario));
        transfer::public_transfer(coin, USER_ADDR);
        scenario
    }

    fun create_listing(scenario: &mut Scenario): ID {
        test_scenario::next_tx(scenario, AS_ADDR);
        let mut router = test_scenario::take_shared<Router<SUI>>(scenario);
        let cap = test_scenario::take_from_sender<AsAuthCap>(scenario);
        let seller_token = test_scenario::take_from_sender<SellerAuthToken>(scenario);
        let listing_id = marketplace::create_listing<SUI>(
            &mut router, &cap,
            BANDWIDTH, START_TIME, EXP_TIME, TIME_GRAN, MIN_BW, PRICE,
            &seller_token,
            test_scenario::ctx(scenario),
        );
        test_scenario::return_shared(router);
        test_scenario::return_to_sender(scenario, cap);
        test_scenario::return_to_sender(scenario, seller_token);
        listing_id
    }

    fun do_buy(scenario: &mut Scenario, listing_id: ID, start: u64, exp: u64, bw: u64) {
        test_scenario::next_tx(scenario, USER_ADDR);
        let mut router  = test_scenario::take_shared<Router<SUI>>(scenario);
        let payment = test_scenario::take_from_sender<Coin<SUI>>(scenario);
        marketplace::buy_and_take<SUI>(
            &mut router, listing_id, start, exp, bw, payment,
            test_scenario::ctx(scenario),
        );
        test_scenario::return_shared(router);
    }

    // ---- Tests ----

    #[test]
    fun test_buy_full_listing() {
        let mut scenario = setup();
        let id = create_listing(&mut scenario);
        do_buy(&mut scenario, id, START_TIME, EXP_TIME, BANDWIDTH);
        test_scenario::next_tx(&mut scenario, USER_ADDR);
        {
            let asset = test_scenario::take_from_sender<HummingbirdAsset>(&scenario);
            assert!(hummingbird_asset::get_bandwidth(&asset) == BANDWIDTH, 0);
            assert!(hummingbird_asset::get_start_time(&asset) == START_TIME, 1);
            assert!(hummingbird_asset::get_exp_time(&asset) == EXP_TIME, 2);
            test_scenario::return_to_sender(&mut scenario, asset);
        };
        // Seller received PRICE
        test_scenario::next_tx(&mut scenario, AS_ADDR);
        {
            let coin = test_scenario::take_from_sender<Coin<SUI>>(&scenario);
            assert!(coin::value(&coin) == PRICE, 3);
            test_scenario::return_to_sender(&mut scenario, coin);
        };
        // Buyer got change
        test_scenario::next_tx(&mut scenario, USER_ADDR);
        {
            let change = test_scenario::take_from_sender<Coin<SUI>>(&scenario);
            assert!(coin::value(&change) == COIN_VAL - PRICE, 4);
            test_scenario::return_to_sender(&mut scenario, change);
        };
        test_scenario::end(scenario);
    }

    #[test]
    fun test_split_time_start() {
        let mut scenario = setup();
        let id = create_listing(&mut scenario);
        // Buy from start+5min onward — left slice should be created
        let buy_start = START_TIME + TIME_GRAN;
        do_buy(&mut scenario, id, buy_start, EXP_TIME, BANDWIDTH);
        test_scenario::next_tx(&mut scenario, USER_ADDR);
        {
            let asset = test_scenario::take_from_sender<HummingbirdAsset>(&scenario);
            assert!(hummingbird_asset::get_start_time(&asset) == buy_start, 0);
            assert!(hummingbird_asset::get_exp_time(&asset) == EXP_TIME, 1);
            test_scenario::return_to_sender(&mut scenario, asset);
        };
        test_scenario::end(scenario);
    }

    #[test]
    fun test_split_time_end() {
        let mut scenario = setup();
        let id = create_listing(&mut scenario);
        let buy_exp = EXP_TIME - TIME_GRAN;
        do_buy(&mut scenario, id, START_TIME, buy_exp, BANDWIDTH);
        test_scenario::next_tx(&mut scenario, USER_ADDR);
        {
            let asset = test_scenario::take_from_sender<HummingbirdAsset>(&scenario);
            assert!(hummingbird_asset::get_start_time(&asset) == START_TIME, 0);
            assert!(hummingbird_asset::get_exp_time(&asset) == buy_exp, 1);
            test_scenario::return_to_sender(&mut scenario, asset);
        };
        test_scenario::end(scenario);
    }

    #[test]
    fun test_split_time_both_ends() {
        let mut scenario = setup();
        let id = create_listing(&mut scenario);
        let buy_start = START_TIME + TIME_GRAN;
        let buy_exp   = EXP_TIME   - TIME_GRAN;
        do_buy(&mut scenario, id, buy_start, buy_exp, BANDWIDTH);
        test_scenario::next_tx(&mut scenario, USER_ADDR);
        {
            let asset = test_scenario::take_from_sender<HummingbirdAsset>(&scenario);
            assert!(hummingbird_asset::get_start_time(&asset) == buy_start, 0);
            assert!(hummingbird_asset::get_exp_time(&asset) == buy_exp, 1);
            test_scenario::return_to_sender(&mut scenario, asset);
        };
        test_scenario::end(scenario);
    }

    #[test]
    fun test_split_bandwidth() {
        let mut scenario = setup();
        let id = create_listing(&mut scenario);
        let buy_bw = BANDWIDTH / 2;
        do_buy(&mut scenario, id, START_TIME, EXP_TIME, buy_bw);
        test_scenario::next_tx(&mut scenario, USER_ADDR);
        {
            let asset = test_scenario::take_from_sender<HummingbirdAsset>(&scenario);
            assert!(hummingbird_asset::get_bandwidth(&asset) == buy_bw, 0);
            test_scenario::return_to_sender(&mut scenario, asset);
        };
        test_scenario::end(scenario);
    }

    #[test]
    fun test_split_time_and_bandwidth() {
        let mut scenario = setup();
        let id = create_listing(&mut scenario);
        let buy_start = START_TIME + TIME_GRAN;
        let buy_exp   = EXP_TIME   - TIME_GRAN;
        let buy_bw    = BANDWIDTH  / 2;
        do_buy(&mut scenario, id, buy_start, buy_exp, buy_bw);
        test_scenario::next_tx(&mut scenario, USER_ADDR);
        {
            let asset = test_scenario::take_from_sender<HummingbirdAsset>(&scenario);
            assert!(hummingbird_asset::get_bandwidth(&asset)  == buy_bw, 0);
            assert!(hummingbird_asset::get_start_time(&asset) == buy_start, 1);
            assert!(hummingbird_asset::get_exp_time(&asset)   == buy_exp, 2);
            test_scenario::return_to_sender(&mut scenario, asset);
        };
        test_scenario::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = EInsufficientPayment)]
    fun test_insufficient_payment() {
        let mut scenario = test_scenario::begin(AS_ADDR);
        registry::create_and_share_global_registry(test_scenario::ctx(&mut scenario));
        test_scenario::next_tx(&mut scenario, AS_ADDR);
        {
            let mut global = test_scenario::take_shared<GlobalRegistry>(&scenario);
            registry::register_as_to_sender(&mut global, ISD_AS, test_scenario::ctx(&mut scenario));
            test_scenario::return_shared(global);
        };
        test_scenario::next_tx(&mut scenario, AS_ADDR);
        {
            let mut as_reg = test_scenario::take_shared<AsRegistry>(&scenario);
            let cap = test_scenario::take_from_sender<AsAuthCap>(&scenario);
            marketplace::create_router<SUI>(&mut as_reg, &cap, ROUTER_ID, IFACE_ID, INGRESS, test_scenario::ctx(&mut scenario));
            test_scenario::return_to_sender(&mut scenario, cap);
            test_scenario::return_shared(as_reg);
        };
        test_scenario::next_tx(&mut scenario, AS_ADDR);
        marketplace::register_seller_to_sender(AS_ADDR, test_scenario::ctx(&mut scenario));
        // Give buyer less than PRICE
        test_scenario::next_tx(&mut scenario, AS_ADDR);
        let coin = coin::mint_for_testing<SUI>(PRICE / 2, test_scenario::ctx(&mut scenario));
        transfer::public_transfer(coin, USER_ADDR);

        let id = create_listing(&mut scenario);
        do_buy(&mut scenario, id, START_TIME, EXP_TIME, BANDWIDTH);
        test_scenario::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = EInvalidInterval)]
    fun test_unaligned_start_time() {
        let mut scenario = setup();
        let id = create_listing(&mut scenario);
        do_buy(&mut scenario, id, START_TIME + 1, EXP_TIME, BANDWIDTH);
        test_scenario::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = EInvalidInterval)]
    fun test_unaligned_end_time() {
        let mut scenario = setup();
        let id = create_listing(&mut scenario);
        do_buy(&mut scenario, id, START_TIME, EXP_TIME - 1, BANDWIDTH);
        test_scenario::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = EInvalidBandwidth)]
    fun test_below_min_bandwidth() {
        let mut scenario = setup();
        let id = create_listing(&mut scenario);
        do_buy(&mut scenario, id, START_TIME, EXP_TIME, MIN_BW / 2);
        test_scenario::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = EInvalidBandwidth)]
    fun test_exceeding_bandwidth() {
        let mut scenario = setup();
        let id = create_listing(&mut scenario);
        do_buy(&mut scenario, id, START_TIME, EXP_TIME, BANDWIDTH + MIN_BW);
        test_scenario::end(scenario);
    }

    #[test]
    fun test_delist() {
        let mut scenario = setup();
        let id = create_listing(&mut scenario);
        test_scenario::next_tx(&mut scenario, AS_ADDR);
        {
            let mut router       = test_scenario::take_shared<Router<SUI>>(&scenario);
            let seller_token = test_scenario::take_from_sender<SellerAuthToken>(&scenario);
            marketplace::delist_and_take<SUI>(&mut router, id, &seller_token, test_scenario::ctx(&mut scenario));
            test_scenario::return_to_sender(&mut scenario, seller_token);
            test_scenario::return_shared(router);
        };
        test_scenario::next_tx(&mut scenario, AS_ADDR);
        assert!(test_scenario::has_most_recent_for_sender<HummingbirdAsset>(&scenario), 0);
        test_scenario::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = ENotSeller)]
    fun test_delist_wrong_token() {
        let mut scenario = setup();
        let id = create_listing(&mut scenario);
        // Register a second seller token for USER_ADDR
        test_scenario::next_tx(&mut scenario, USER_ADDR);
        marketplace::register_seller_to_sender(USER_ADDR, test_scenario::ctx(&mut scenario));
        test_scenario::next_tx(&mut scenario, USER_ADDR);
        {
            let mut router       = test_scenario::take_shared<Router<SUI>>(&scenario);
            let wrong_token  = test_scenario::take_from_sender<SellerAuthToken>(&scenario);
            marketplace::delist_and_take<SUI>(&mut router, id, &wrong_token, test_scenario::ctx(&mut scenario));
            test_scenario::return_to_sender(&mut scenario, wrong_token);
            test_scenario::return_shared(router);
        };
        test_scenario::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = EInvalidTimeGranularity)]
    fun test_listing_unaligned_duration() {
        let mut scenario = setup();
        test_scenario::next_tx(&mut scenario, AS_ADDR);
        let mut router      = test_scenario::take_shared<Router<SUI>>(&scenario);
        let cap         = test_scenario::take_from_sender<AsAuthCap>(&scenario);
        let seller_token = test_scenario::take_from_sender<SellerAuthToken>(&scenario);
        // duration = 1 hour, granularity = 7 minutes — 60 % 7 != 0
        marketplace::create_listing<SUI>(
            &mut router, &cap,
            BANDWIDTH, START_TIME, EXP_TIME,
            7 * 60_000, MIN_BW, PRICE,
            &seller_token, test_scenario::ctx(&mut scenario),
        );
        test_scenario::return_shared(router);
        test_scenario::return_to_sender(&mut scenario, cap);
        test_scenario::return_to_sender(&mut scenario, seller_token);
        test_scenario::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = EUnauthorized)]
    fun test_create_listing_wrong_cap() {
        let mut scenario = setup();
        // Register a second AS and use its cap on the first AS's router
        test_scenario::next_tx(&mut scenario, USER_ADDR);
        {
            let mut global = test_scenario::take_shared<GlobalRegistry>(&scenario);
            registry::register_as_to_sender(&mut global, ISD_AS + 1, test_scenario::ctx(&mut scenario));
            test_scenario::return_shared(global);
        };
        test_scenario::next_tx(&mut scenario, USER_ADDR);
        {
            let wrong_cap = test_scenario::take_from_sender<AsAuthCap>(&scenario);
            let mut router    = test_scenario::take_shared<Router<SUI>>(&scenario);
            let seller_token = marketplace::register_seller(USER_ADDR, test_scenario::ctx(&mut scenario));
            marketplace::create_listing<SUI>(
                &mut router, &wrong_cap,
                BANDWIDTH, START_TIME, EXP_TIME, TIME_GRAN, MIN_BW, PRICE,
                &seller_token, test_scenario::ctx(&mut scenario),
            );
            sui::transfer::public_transfer(seller_token, USER_ADDR);
            test_scenario::return_to_sender(&mut scenario, wrong_cap);
            test_scenario::return_shared(router);
        };
        test_scenario::end(scenario);
    }
}
