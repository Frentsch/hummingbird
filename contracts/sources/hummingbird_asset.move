module hummingbird::hummingbird_asset {
    use sui::object::{Self, ID, UID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::event;
    use std::u64;
    use std::option::{Self,Option};
    use hummingbird::registry::{AsAuthCap, cap_isd_as_id};


    const EInvalidTimeInterval: u64 = 0;
    const EInvalidBandwidth: u64 = 1;
    const EInvalidTimeGranularity: u64 = 2;
    const EAssetMismatch: u64 = 3;
    const EUnauthorized: u64 = 7;
    const EWrongInterfaceFuse: u64 = 4;
    const EInsufficientFuseBandwidth: u64 = 5;
    const ENonOverlappingAssets: u64 = 6;
    const EAssetError: u64 = 8;

    /// Bandwidth reservation token for a single router interface.
    /// Bandwidth is in multiples of 1 kbps.
    public struct HummingbirdAsset has key, store {
        id: UID,
        isd_as_id: u64,
        if_ingress_id: Option<u16>,
        if_egress_id: Option<u16>,
        bandwidth: u64,
        start_time: u64,
        exp_time: u64,
        time_granularity: u64,
        time_min_duration: u64,
        min_bandwidth: u64,
        issuer: address,
    }

    /// Wraps an ingress+egress pair sent to the AS for data-plane key delivery.
    public struct RedeemRequest has key {
        id: UID,
        ingress_egress_asset: HummingbirdAsset,
        public_key: vector<u8>,
        buyer: address,
    }

    /// Proof-of-reservation delivered to the buyer after the AS fulfils the redeem request.
    public struct Reservation has key, store {
        id: UID,
        isd_as_id: u64,
        ingress_id: u16,
        egress_id: u16,
        start_time: u64,
        end_time: u64,
        bandwidth: u64,
        encrypted_reservation: vector<u8>,
    }

    public struct RedeemRequestReceived has copy, drop {
        redeem_request_id: ID,
        issuer: address,
    }

    public struct ReservationDelivered has copy, drop {
        isd_as_id: u64,
        redeem_request_id: ID,
        public_key: vector<u8>,
        encrypted_reservation: vector<u8>,
        res_id: u64,
        bw_rounded: u64,
        bw_dataplane_encoding: u16,
    }

    // --- Getters ---

    public fun get_isd_as_id(a: &HummingbirdAsset): u64 { a.isd_as_id }
    public fun get_ingress_id(a: &HummingbirdAsset): Option<u16> { a.if_ingress_id }
    public fun get_egress_id(a: &HummingbirdAsset): Option<u16> { a.if_egress_id }
    public fun get_bandwidth(a: &HummingbirdAsset): u64 { a.bandwidth }
    public fun get_start_time(a: &HummingbirdAsset): u64 { a.start_time }
    public fun get_exp_time(a: &HummingbirdAsset): u64 { a.exp_time }
    public fun get_time_granularity(a: &HummingbirdAsset): u64 { a.time_granularity }
    public fun get_time_min_duration(a: &HummingbirdAsset): u64 { a.time_min_duration }
    public fun get_min_bandwidth(a: &HummingbirdAsset): u64 { a.min_bandwidth }
    public fun get_issuer(a: &HummingbirdAsset): address { a.issuer }

    // --- Issue / destroy ---

    public fun issue(
        cap: &AsAuthCap,
        isd_as_id: u64,
        if_ingress_id: Option<u16>,
        if_egress_id: Option<u16>,
        bandwidth: u64,
        start_time: u64,
        exp_time: u64,
        time_granularity: u64,
        time_min_duration: u64,
        min_bandwidth: u64,
        issuer: address,
        ctx: &mut TxContext,
    ): HummingbirdAsset {
        assert!(cap_isd_as_id(cap) == isd_as_id, EUnauthorized);
        assert!(exp_time > start_time, EInvalidTimeInterval);
        assert!(bandwidth >= min_bandwidth && min_bandwidth > 0, EInvalidBandwidth);
        assert!(
            time_granularity > 0
                && (exp_time - start_time) % time_granularity == 0,
            EInvalidTimeGranularity
        );
        assert!(option::is_some(&if_ingress_id) || option::is_some(&if_egress_id), EAssetError);
        HummingbirdAsset {
            id: object::new(ctx),
            isd_as_id,
            if_ingress_id,
            if_egress_id,
            bandwidth,
            start_time,
            exp_time,
            time_granularity,
            time_min_duration,
            min_bandwidth,
            issuer,
        }
    }

    public fun destroy(a: HummingbirdAsset) {
        let HummingbirdAsset {
            id, isd_as_id: _, if_ingress_id: _, if_egress_id: _,
            bandwidth: _, start_time: _, exp_time: _,
            time_granularity: _, 
            time_min_duration: _, min_bandwidth: _, issuer: _,
        } = a;
        object::delete(id);
    }

    // --- Split ---

    /// Original keeps [start_time, split_time); returned asset covers [split_time, exp_time).
    public fun split_time(
        a: &mut HummingbirdAsset,
        split_time: u64,
        ctx: &mut TxContext,
    ): HummingbirdAsset {
        assert!(
            split_time > a.start_time
                && split_time < a.exp_time
                && (split_time - a.start_time) % a.time_granularity == 0,
            EInvalidTimeInterval
        );
        assert!(split_time - a.start_time >= a.time_min_duration 
                && a.exp_time - split_time >= a.time_min_duration, 
                EInvalidTimeInterval);
        let right = HummingbirdAsset {
            id: object::new(ctx),
            isd_as_id: a.isd_as_id,
            if_ingress_id: a.if_ingress_id,
            if_egress_id: a.if_egress_id,
            bandwidth: a.bandwidth,
            start_time: split_time,
            exp_time: a.exp_time,
            time_granularity: a.time_granularity,
            time_min_duration: a.time_min_duration,
            min_bandwidth: a.min_bandwidth,
            issuer: a.issuer,
        };
        a.exp_time = split_time;
        right
    }

    /// Original keeps [0, split_bw]; returned asset covers (split_bw, B].
    public fun split_bandwidth(
        a: &mut HummingbirdAsset,
        split_bw: u64,
        ctx: &mut TxContext,
    ): HummingbirdAsset {
        assert!(
            split_bw < a.bandwidth
                && split_bw >= a.min_bandwidth
                && a.bandwidth - split_bw >= a.min_bandwidth,
            EInvalidBandwidth
        );
        let upper = HummingbirdAsset {
            id: object::new(ctx),
            isd_as_id: a.isd_as_id,
            if_ingress_id: a.if_ingress_id,
            if_egress_id: a.if_egress_id,
            bandwidth: a.bandwidth - split_bw,
            start_time: a.start_time,
            exp_time: a.exp_time,
            time_granularity: a.time_granularity,
            time_min_duration: a.time_min_duration,
            min_bandwidth: a.min_bandwidth,
            issuer: a.issuer,
        };
        a.bandwidth = split_bw;
        upper
    }

    // --- Fuse (deferred use; struct ready now) ---

    /// Fuse two assets in time (contiguous or overlapping windows, same interface).
    public fun fuse_time(first: &mut HummingbirdAsset, second: HummingbirdAsset) {
        assert!(is_same_interface(first, &second), EWrongInterfaceFuse);
        assert!(
            are_overlapping(first, &second) || are_consecutive(first, &second),
            ENonOverlappingAssets
        );
        assert!(
            first.bandwidth >= second.min_bandwidth
                && second.bandwidth >= first.min_bandwidth,
            EInsufficientFuseBandwidth
        );
        let HummingbirdAsset {
            id: sid, isd_as_id: _, if_ingress_id: _, if_egress_id: _,
            bandwidth: sbw, start_time: sst, exp_time: set,
            time_granularity: _, time_min_duration: _,
            min_bandwidth: smin, issuer: _,
        } = second;
        object::delete(sid);
        first.start_time = u64::min(first.start_time, sst);
        first.exp_time   = u64::max(first.exp_time, set);
        first.bandwidth  = u64::min(first.bandwidth, sbw);
        first.min_bandwidth = u64::max(first.min_bandwidth, smin);
    }

    /// Fuse two assets in bandwidth (overlapping time windows, same interface).
    public fun fuse_bandwidth(first: &mut HummingbirdAsset, second: HummingbirdAsset) {
        assert!(is_same_interface(first, &second), EWrongInterfaceFuse);
        assert!(are_overlapping(first, &second), ENonOverlappingAssets);
        let HummingbirdAsset {
            id: sid, isd_as_id: _, if_ingress_id: _, if_egress_id: _,
            bandwidth: sbw, start_time: sst, exp_time: set,
            time_granularity: _, time_min_duration: _, min_bandwidth: smin, issuer: _,
        } = second;
        object::delete(sid);
        first.start_time = u64::max(first.start_time, sst);
        first.exp_time   = u64::min(first.exp_time, set);
        first.bandwidth  = first.bandwidth + sbw;
        first.min_bandwidth = u64::max(first.min_bandwidth, smin);
    }

    // --- Redeem flow ---

    /// Buyer sends ingress + egress pair to the AS for data-plane key exchange.
    public fun redeem(
        mut ingress_asset: HummingbirdAsset,
        egress_asset: HummingbirdAsset,
        public_key: vector<u8>,
        ctx: &mut TxContext,
    ) {
        assert!(
            ingress_asset.isd_as_id == egress_asset.isd_as_id
                && ingress_asset.issuer == egress_asset.issuer
                && option::is_some(&ingress_asset.if_ingress_id)
                && option::is_some(&egress_asset.if_egress_id)
                && ingress_asset.start_time == egress_asset.start_time
                && ingress_asset.exp_time == egress_asset.exp_time
                && ingress_asset.bandwidth == egress_asset.bandwidth,
            EAssetMismatch
        );
        ingress_asset.if_egress_id = egress_asset.if_egress_id;
        let issuer_addr = ingress_asset.issuer;
        let req = RedeemRequest {
            id: object::new(ctx),
            ingress_egress_asset: ingress_asset,
            public_key,
            buyer: tx_context::sender(ctx),
        };
        event::emit(RedeemRequestReceived {
            redeem_request_id: object::id(&req),
            issuer: issuer_addr,
        });
        transfer::transfer(req, issuer_addr);
        destroy(egress_asset);
    }

    public fun redeem_pair(
        ingress_egress_asset: HummingbirdAsset,
        public_key: vector<u8>,
        ctx: &mut TxContext,
    ){
        assert!(
            option::is_some(&ingress_egress_asset.if_ingress_id)
            && option::is_some(&ingress_egress_asset.if_egress_id),
            EAssetMismatch);
        assert!(ingress_egress_asset.bandwidth>=ingress_egress_asset.min_bandwidth, EInvalidBandwidth);
        assert!(ingress_egress_asset.exp_time - ingress_egress_asset.start_time>=ingress_egress_asset.time_min_duration, EInvalidTimeInterval);
            
        let issuer_addr = ingress_egress_asset.issuer;
        let req = RedeemRequest {
            id: object::new(ctx),
            ingress_egress_asset,
            public_key,
            buyer: tx_context::sender(ctx),
        };
        event::emit(RedeemRequestReceived {
            redeem_request_id: object::id(&req),
            issuer: issuer_addr,
        });
        transfer::transfer(req, issuer_addr);
        
    }

    /// AS delivers encrypted data-plane keys, destroys both assets, and transfers a Reservation to the buyer.
    public entry fun deliver_reservation(
        req: RedeemRequest,
        encrypted_reservation: vector<u8>,
        res_id: u64,
        bw_rounded: u64,
        bw_dataplane_encoding: u16,
        ctx: &mut TxContext,
    ) {
        let redeem_request_id = object::id(&req);
        let RedeemRequest { id: wid, ingress_egress_asset, public_key, buyer } = req;
        let isd_as_id = ingress_egress_asset.isd_as_id;
        object::delete(wid);
        /*let reservation = Reservation {
            id: object::new(ctx),
            isd_as_id: isd_as_id,
            ingress_id: option::extract(&mut ingress_egress_asset.if_ingress_id),
            egress_id: option::extract(&mut ingress_egress_asset.if_egress_id),
            start_time: ingress_egress_asset.start_time,
            end_time: ingress_egress_asset.exp_time,
            bandwidth: ingress_egress_asset.bandwidth,
            encrypted_reservation: encrypted_reservation,
        };*/
        destroy(ingress_egress_asset);
        event::emit(ReservationDelivered { 
            isd_as_id, 
            redeem_request_id, 
            public_key, 
            encrypted_reservation,
            res_id,
            bw_rounded,
            bw_dataplane_encoding });
        //TODO decide if Reservation recepit necessary or not
        //transfer::transfer(reservation, buyer);
    }

    // --- Private helpers ---

    fun is_same_interface(a: &HummingbirdAsset, b: &HummingbirdAsset): bool {
        a.isd_as_id == b.isd_as_id
            && a.if_ingress_id == b.if_ingress_id
            && a.if_egress_id == b.if_egress_id
            && a.issuer == b.issuer
    }

    fun are_overlapping(a: &HummingbirdAsset, b: &HummingbirdAsset): bool {
        a.exp_time > b.start_time && a.start_time < b.exp_time
    }

    fun are_consecutive(a: &HummingbirdAsset, b: &HummingbirdAsset): bool {
        a.exp_time == b.start_time || a.start_time == b.exp_time
    }
}
