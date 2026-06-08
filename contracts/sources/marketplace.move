module hummingbird::marketplace {
    use std::vector;
    use sui::object::{Self, ID, UID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::coin::{Self, Coin};
    use sui::object_bag::{Self, ObjectBag};
    use sui::event;
    use hummingbird::hummingbird_asset::{Self, HummingbirdAsset};
    use hummingbird::registry::{Self, AsRegistry, AsAuthCap, Interface};

    const EUnauthorized: u64 = 0;
    const EInvalidInterval: u64 = 1;
    const EInvalidBandwidth: u64 = 2;
    const EInvalidTimeGranularity: u64 = 3;
    const EInvalidMinBandwidth: u64 = 4;
    const EInsufficientPayment: u64 = 5;
    const ENotSeller: u64 = 6;

    // --- Core structs ---


    struct Seller has copy, drop, store {
        token_id: ID,
        payment_address: address,
    }

    /// Listing wrapping a HummingbirdAsset inside the interfaces's ObjectBag.
    struct AssetListing<phantom COIN> has key, store {
        id: UID,
        interface: ID,
        asset: HummingbirdAsset,
        price: u64,
        time_granularity: u64,
        min_bandwidth: u64,
        seller: Seller,
    }

    /// Owned capability identifying a seller and their payment address.
    struct SellerAuthToken has key, store {
        id: UID,
        payment_address: address,
    }

    // --- Events ---

    struct ListingCreated has copy, drop {
        listing_id: ID,
        seller: address,
        isd_as_id: u64,
        interface_id: u16,
        interface_type: u8,
        bandwidth: u64,
        start_time: u64,
        exp_time: u64,
        price: u64,
    }

    struct ListingConsumed has copy, drop {
        listing_id: ID,
        successor_ids: vector<ID>,
    }

    struct AssetIssued has copy, drop {
        asset_id: ID,
        buyer: address,
        isd_as_id: u64,
        interface_id: u16,
        interface_type: u8,
        bandwidth: u64,
        start_time: u64,
        exp_time: u64,
        issuer: address,
        total_paid: u64,
    }

    // --- Interface management ---

    public entry fun create_interface(
        as_registry: &mut AsRegistry,
        cap: &AsAuthCap,
        interface_id: u16,
        ctx: &mut TxContext,
    ) {
        registry::create_interface(as_registry, cap, interface_id, ctx);
    }

    // --- Seller registration ---

    public fun register_seller(payment_address: address, ctx: &mut TxContext): SellerAuthToken {
        SellerAuthToken { id: object::new(ctx), payment_address }
    }

    #[lint_allow(self_transfer)]
    public entry fun register_seller_to_sender(payment_address: address, ctx: &mut TxContext) {
        transfer::transfer(register_seller(payment_address, ctx), tx_context::sender(ctx));
    }

    // --- Root listing creation ---

    /// AS creates a new root listing. Issues a HummingbirdAsset internally and
    /// wraps it in a listing stored in the interface's ObjectBag.
    public fun create_listing<COIN>(
        interface: &mut Interface,
        cap: &AsAuthCap,
        interface_type: u8,
        bandwidth: u64,
        start_time: u64,
        exp_time: u64,
        time_granularity: u64,
        min_bandwidth: u64,
        price: u64,
        seller_token: &SellerAuthToken,
        ctx: &mut TxContext,
    ): ID {
        let isd_as_id = registry::interface_isd_as_id(interface);
        assert!(registry::cap_isd_as_id(cap) == isd_as_id , EUnauthorized);
        let asset_duration = exp_time - start_time;
        assert!(
            time_granularity != 0
                && asset_duration % time_granularity == 0,
            EInvalidTimeGranularity
        );
        assert!(
            min_bandwidth > 0 && min_bandwidth <= bandwidth,
            EInvalidMinBandwidth
        );
        let asset = hummingbird_asset::issue(
            registry::interface_isd_as_id(interface),
            registry::interface_id(interface),
            interface_type,
            bandwidth,
            start_time,
            exp_time,
            time_granularity,
            min_bandwidth,
            tx_context::sender(ctx),
            ctx,
        );
        let listing_id: ID = new_listing_id_and_add<COIN>(
            interface,
            asset,
            price,
            time_granularity,
            min_bandwidth,
            Seller { token_id: object::id(seller_token), payment_address: seller_token.payment_address },
            ctx,
        );
        listing_id
    }

    #[lint_allow(self_transfer)]
    public entry fun create_listing_entry<COIN>(
        interface: &mut Interface,
        cap: &AsAuthCap,
        interface_type: u8,
        bandwidth: u64,
        start_time: u64,
        exp_time: u64,
        time_granularity: u64,
        min_bandwidth: u64,
        price: u64,
        seller_token: &SellerAuthToken,
        ctx: &mut TxContext,
    ) {
        create_listing<COIN>(interface, cap, interface_type, bandwidth, start_time, exp_time, time_granularity, min_bandwidth, price, seller_token, ctx);
    }

    // --- Buy ---

    public fun buy<COIN>(
        interface: &mut Interface,
        listing_id: ID,
        start_time: u64,
        exp_time: u64,
        bandwidth: u64,
        payment: Coin<COIN>,
        ctx: &mut TxContext,
    ): (HummingbirdAsset, Coin<COIN>) {
        let parent_id = listing_id;
        let listing = object_bag::remove<ID, AssetListing<COIN>>(registry::interface_listings(interface), listing_id);
        let successor_ids = vector::empty<ID>();

        listing = extract_by_time(interface, listing, start_time, exp_time, &mut successor_ids, ctx);

        if (bandwidth != hummingbird_asset::get_bandwidth(&listing.asset)) {
            let upper = split_listing_bandwidth(&mut listing, bandwidth, ctx);
            add_child_listing(interface, upper, &mut successor_ids);
        };

        let total_paid = listing.price;
        let isd_as_id = registry::interface_isd_as_id(interface);
        let interface_id = registry::interface_id(interface);
        let interface_type = hummingbird_asset::get_interface_type(&listing.asset);
        let buyer = tx_context::sender(ctx);

        let (asset, change) = execute_payment(listing, payment, ctx);

        event::emit(ListingConsumed { listing_id: parent_id, successor_ids });
        event::emit(AssetIssued {
            asset_id: object::id(&asset),
            buyer,
            isd_as_id,
            interface_id,
            interface_type,
            bandwidth,
            start_time,
            exp_time,
            issuer: hummingbird_asset::get_issuer(&asset),
            total_paid,
        });

        (asset, change)
    }

    #[lint_allow(self_transfer)]
    public entry fun buy_and_take<COIN>(
        interface: &mut Interface,
        listing_id: ID,
        start_time: u64,
        exp_time: u64,
        bandwidth: u64,
        payment: Coin<COIN>,
        ctx: &mut TxContext,
    ) {
        let (asset, change) = buy(interface, listing_id, start_time, exp_time, bandwidth, payment, ctx);
        transfer::public_transfer(asset, tx_context::sender(ctx));
        transfer::public_transfer(change, tx_context::sender(ctx));
    }

    // --- Delist ---

    public fun delist<COIN>(
        interface: &mut Interface,
        listing_id: ID,
        seller_token: &SellerAuthToken,
    ): HummingbirdAsset {
        let AssetListing<COIN> {
            id, interface: _, asset, price: _, time_granularity: _, min_bandwidth: _, seller,
        } = object_bag::remove<ID, AssetListing<COIN>>(registry::interface_listings(interface), listing_id);
        assert!(seller.token_id == object::id(seller_token), ENotSeller);
        object::delete(id);
        asset
    }

    #[lint_allow(self_transfer)]
    public entry fun delist_and_take<COIN>(
        interface: &mut Interface,
        listing_id: ID,
        seller_token: &SellerAuthToken,
        ctx: &TxContext,
    ) {
        let asset = delist<COIN>(interface, listing_id, seller_token);
        transfer::public_transfer(asset, tx_context::sender(ctx));
    }

    // --- Internal helpers ---

    /// Price scaled proportionally, rounded up (ceiling division).
    fun proportional_price(original_price: u64, original_size: u64, new_size: u64): u64 {
        (original_price * new_size - 1) / original_size + 1
    }

    fun split_listing_time<COIN>(
        listing: &mut AssetListing<COIN>,
        split_time: u64,
        ctx: &mut TxContext,
    ): AssetListing<COIN> {
        let old_start = hummingbird_asset::get_start_time(&listing.asset);
        let old_exp   = hummingbird_asset::get_exp_time(&listing.asset);
        assert!(
            split_time > old_start
                && split_time < old_exp
                && (split_time - old_start) % listing.time_granularity == 0,
            EInvalidInterval
        );
        let right_asset = hummingbird_asset::split_time(&mut listing.asset, split_time, ctx);
        let right_price = proportional_price(listing.price, old_exp - old_start, old_exp - split_time);
        listing.price   = proportional_price(listing.price, old_exp - old_start, split_time - old_start);
        AssetListing<COIN> {
            id: object::new(ctx),
            interface: listing.interface,
            asset: right_asset,
            price: right_price,
            time_granularity: listing.time_granularity,
            min_bandwidth: listing.min_bandwidth,
            seller: listing.seller,
        }
    }

    fun split_listing_bandwidth<COIN>(
        listing: &mut AssetListing<COIN>,
        split_bw: u64,
        ctx: &mut TxContext,
    ): AssetListing<COIN> {
        let old_bw = hummingbird_asset::get_bandwidth(&listing.asset);
        assert!(
            split_bw < old_bw
                && split_bw >= listing.min_bandwidth
                && old_bw - split_bw >= listing.min_bandwidth,
            EInvalidBandwidth
        );
        let upper_asset  = hummingbird_asset::split_bandwidth(&mut listing.asset, split_bw, ctx);
        let upper_price  = proportional_price(listing.price, old_bw, old_bw - split_bw);
        listing.price    = proportional_price(listing.price, old_bw, split_bw);
        AssetListing<COIN> {
            id: object::new(ctx),
            interface: listing.interface,
            asset: upper_asset,
            price: upper_price,
            time_granularity: listing.time_granularity,
            min_bandwidth: listing.min_bandwidth,
            seller: listing.seller,
        }
    }

    /// Splits time boundaries off `listing` and adds the remainder slices to the bag.
    /// Returns `listing` trimmed to exactly [start_time, exp_time].
    fun extract_by_time<COIN>(
        interface: &mut Interface,
        listing: AssetListing<COIN>,
        start_time: u64,
        exp_time: u64,
        successor_ids: &mut vector<ID>,
        ctx: &mut TxContext,
    ): AssetListing<COIN> {
        let old_start = hummingbird_asset::get_start_time(&listing.asset);
        let old_exp   = hummingbird_asset::get_exp_time(&listing.asset);
        assert!(
            old_exp >= exp_time && old_start <= start_time && start_time < exp_time,
            EInvalidInterval
        );

        // Split right boundary first so the asset shrinks to [old_start, exp_time].
        if (exp_time < old_exp) {
            let right = split_listing_time(&mut listing, exp_time, ctx);
            add_child_listing(interface, right, successor_ids);
        };

        // Split left boundary: listing becomes left slice; new_right is [start_time, exp_time].
        if (start_time > old_start) {
            let new_right = split_listing_time(&mut listing, start_time, ctx);
            add_child_listing(interface, listing, successor_ids);
            listing = new_right;
        };

        listing
    }

    /// Read listing fields, emit ListingCreated, then add to bag.
    fun add_child_listing<COIN>(
        interface: &mut Interface,
        listing: AssetListing<COIN>,
        successor_ids: &mut vector<ID>,
    ) {
        let listing_id   = object::id(&listing);
        let interface_address    = object::id(interface);
        let isd_as_id    = registry::interface_isd_as_id(interface);
        let interface_id = registry::interface_id(interface);
        let interface_type = hummingbird_asset::get_interface_type(&listing.asset);
        let bandwidth    = hummingbird_asset::get_bandwidth(&listing.asset);
        let start_time   = hummingbird_asset::get_start_time(&listing.asset);
        let exp_time     = hummingbird_asset::get_exp_time(&listing.asset);
        let price        = listing.price;
        let seller_addr  = listing.seller.payment_address;

        vector::push_back(successor_ids, listing_id);
        event::emit(ListingCreated {
            listing_id, seller: seller_addr,
            isd_as_id, interface_id, interface_type,
            bandwidth, start_time, exp_time, price,
        });
        object_bag::add(registry::interface_listings(interface), listing_id, listing);
    }

    /// Destroy the listing wrapper, pay the seller, return the asset and coin change.
    fun execute_payment<COIN>(
        listing: AssetListing<COIN>,
        payment: Coin<COIN>,
        ctx: &mut TxContext,
    ): (HummingbirdAsset, Coin<COIN>) {
        let AssetListing<COIN> {
            id, interface: _, asset, price, time_granularity: _, min_bandwidth: _, seller,
        } = listing;
        object::delete(id);
        assert!(coin::value(&payment) >= price, EInsufficientPayment);
        let payment_coin = coin::split(&mut payment, price, ctx);
        transfer::public_transfer(payment_coin, seller.payment_address);
        (asset, payment)
    }

    /// Create an AssetListing, emit ListingCreated, add to bag, return ID.
    fun new_listing_id_and_add<COIN>(
        interface: &mut Interface,
        asset: HummingbirdAsset,
        price: u64,
        time_granularity: u64,
        min_bandwidth: u64,
        seller: Seller,
        ctx: &mut TxContext,
    ): ID {
        let id = object::new(ctx);
        let listing_id   = object::uid_to_inner(&id);
        let interface_address    = object::id(interface);
        let isd_as_id    = registry::interface_isd_as_id(interface);
        let interface_id = registry::interface_id(interface);
        let interface_type = hummingbird_asset::get_interface_type(&asset);
        let bandwidth    = hummingbird_asset::get_bandwidth(&asset);
        let start_time   = hummingbird_asset::get_start_time(&asset);
        let exp_time     = hummingbird_asset::get_exp_time(&asset);

        event::emit(ListingCreated {
            listing_id, seller: seller.payment_address,
            isd_as_id, interface_id, interface_type,
            bandwidth, start_time, exp_time, price,
        });
        object_bag::add(
            registry::interface_listings(interface),
            listing_id,
            AssetListing<COIN> { id, interface: interface_address, asset, price, time_granularity, min_bandwidth, seller },
        );
        listing_id
    }
}
