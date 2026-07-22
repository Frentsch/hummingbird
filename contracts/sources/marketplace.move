module hummingbird::marketplace {
    use std::vector;
    use sui::object::{Self, ID, UID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::coin::{Self, Coin};
    use sui::object_bag::{Self, ObjectBag};
    use sui::event;
    use sui::clock::{Self, Clock};
    use std::option::{Self, Option};
    use hummingbird::hummingbird_asset::{Self, HummingbirdAsset};
    use hummingbird::registry::{Self, AsRegistry, AsAuthCap, Interface};

    const EUnauthorized: u64 = 0;
    const EInvalidInterval: u64 = 1;
    const EInvalidBandwidth: u64 = 2;
    const EAuthExpired: u64 = 3;
    const EInsufficientPayment: u64 = 5;
    const ENotSeller: u64 = 6;
    const EListingNotExpired: u64 = 7;

    // --- Core structs ---


    public struct Seller has copy, drop, store {
        token_id: ID,
        payment_address: address,
    }

    /// Listing wrapping a HummingbirdAsset inside the interfaces's ObjectBag.
    public struct AssetListing<phantom COIN> has key, store {
        id: UID,
        interface: ID,
        asset: HummingbirdAsset,
        price: u64,
        seller: Seller,
    }

    /// Owned capability identifying a seller and their payment address.
    public struct SellerAuthToken has key, store {
        id: UID,
        payment_address: address,
    }


    // --- Interface management ---

    public entry fun create_interface(
        as_registry: &mut AsRegistry,
        cap: &AsAuthCap,
        interface_id: u16,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        registry::create_interface(as_registry, cap, interface_id,clock, ctx);
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

    /// Wraps an already-issued HummingbirdAsset into a listing stored in the
    /// interface's ObjectBag. Open to anyone; validates that the asset belongs
    /// to this interface (matching isd_as_id and interface_id).
    public fun create_listing<COIN>(
        interface: &mut Interface,
        asset: HummingbirdAsset,
        price: u64,
        seller_token: &SellerAuthToken,
        ctx: &mut TxContext,
    ): ID {
        let mut ingress_id = hummingbird_asset::get_ingress_id(&asset);
        let mut egress_id = hummingbird_asset::get_egress_id(&asset);
        assert!(
            hummingbird_asset::get_isd_as_id(&asset) == registry::interface_isd_as_id(interface)
                && (
                    (option::is_some(&ingress_id)&& option::extract(&mut ingress_id) == registry::interface_id(interface))
                    ||(option::is_some(&egress_id)&& option::extract(&mut egress_id)==registry::interface_id(interface))
                ),
            EUnauthorized
        );

        let id = object::new(ctx);
        let listing_id   = object::uid_to_inner(&id);
        let interface_address    = object::id(interface);
        object_bag::add(
            registry::interface_listings(interface),
            listing_id,
            AssetListing<COIN> { id, interface: interface_address, asset, price, seller: Seller { token_id: object::id(seller_token), payment_address: seller_token.payment_address} },
        );
        listing_id
    }

    #[lint_allow(self_transfer)]
    public entry fun create_listing_entry<COIN>(
        interface: &mut Interface,
        asset: HummingbirdAsset,
        price: u64,
        seller_token: &SellerAuthToken,
        ctx: &mut TxContext,
    ) {
        create_listing<COIN>(interface, asset, price, seller_token, ctx);
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
        let mut listing = object_bag::remove<ID, AssetListing<COIN>>(registry::interface_listings(interface), listing_id);

        listing = extract_by_time(interface, listing, start_time, exp_time, ctx);

        if (bandwidth != hummingbird_asset::get_bandwidth(&listing.asset)) {
            let upper = split_listing_bandwidth(&mut listing, bandwidth, ctx);
            //add_child_listing(interface, upper);
            interface.interface_listings().add(object::id(&upper), upper);
        };

        let (asset, change) = execute_payment(listing, payment, ctx);
        
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
            id, interface: _, asset, price: _, seller,
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

    // --- Admin cleanup ---

    public entry fun remove_expired_listing<COIN>(
        interface: &mut Interface,
        listing_id: ID,
        cap: &AsAuthCap,
        clock: &Clock,
    ) {
        assert!(registry::cap_isd_as_id(cap) == registry::interface_isd_as_id(interface) && cap.cap_exp() >= clock.timestamp_ms() / 1000, EUnauthorized);
        let AssetListing<COIN> {
            id, interface: _, asset, price: _, seller: _,
        } = object_bag::remove<ID, AssetListing<COIN>>(registry::interface_listings(interface), listing_id);
        assert!(clock.timestamp_ms() / 1000 >= hummingbird_asset::get_exp_time(&asset), EListingNotExpired);
        object::delete(id);
        hummingbird_asset::destroy(asset);
    }

    // --- Internal helpers ---

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
                && (split_time - old_start) % hummingbird_asset::get_time_granularity(&listing.asset) == 0,
            EInvalidInterval
        );
        let right_asset = hummingbird_asset::split_time(&mut listing.asset, split_time, ctx);
        AssetListing<COIN> {
            id: object::new(ctx),
            interface: listing.interface,
            asset: right_asset,
            price: listing.price,
            seller: listing.seller,
        }
    }

    fun split_listing_bandwidth<COIN>(
        listing: &mut AssetListing<COIN>,
        split_bw: u64,
        ctx: &mut TxContext,
    ): AssetListing<COIN> {
        let old_bw = hummingbird_asset::get_bandwidth(&listing.asset);
        let min_bw = hummingbird_asset::get_min_bandwidth(&listing.asset);
        assert!(
            split_bw < old_bw
                && split_bw >= min_bw
                && old_bw - split_bw >= min_bw,
            EInvalidBandwidth
        );
        let upper_asset = hummingbird_asset::split_bandwidth(&mut listing.asset, split_bw, ctx);
        AssetListing<COIN> {
            id: object::new(ctx),
            interface: listing.interface,
            asset: upper_asset,
            price: listing.price,
            seller: listing.seller,
        }
    }

    /// Splits time boundaries off `listing` and adds the remainder slices to the bag.
    /// Returns `listing` trimmed to exactly [start_time, exp_time].
    fun extract_by_time<COIN>(
        interface: &mut Interface,
        mut listing: AssetListing<COIN>,
        start_time: u64,
        exp_time: u64,
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
            //add_child_listing(interface, right);
            interface.interface_listings().add(object::id(&right), right);
        };

        // Split left boundary: listing becomes left slice; new_right is [start_time, exp_time].
        if (start_time > old_start) {
            let new_right = split_listing_time(&mut listing, start_time, ctx);
            //add_child_listing(interface, listing);
            interface.interface_listings().add(object::id(&listing),listing);
            listing = new_right;
        };

        listing
    }

    /// Destroy the listing wrapper, pay the seller, return the asset and coin change.
    fun execute_payment<COIN>(
        listing: AssetListing<COIN>,
        mut payment: Coin<COIN>,
        ctx: &mut TxContext,
    ): (HummingbirdAsset, Coin<COIN>) {
        let AssetListing<COIN> {
            id, interface: _, asset, price, seller,
        } = listing;
        object::delete(id);
        let duration        = hummingbird_asset::get_exp_time(&asset) - hummingbird_asset::get_start_time(&asset);
        let bw              = hummingbird_asset::get_bandwidth(&asset);
        let effective_price = duration * bw * price;
        assert!(coin::value(&payment) >= effective_price, EInsufficientPayment);
        let payment_coin = coin::split(&mut payment, effective_price, ctx);
        transfer::public_transfer(payment_coin, seller.payment_address);
        (asset, payment)
    }

}
