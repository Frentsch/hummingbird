import { Transaction } from '@mysten/sui/transactions';

export interface CreateListingParams {
  packageId: string;
  /** Object ID of the Interface (router) shared object. */
  interfaceObjectId: string;
  /** Object ID of the AsAuthCap owned object — required for hummingbird_asset::issue. */
  asAuthCapId: string;
  /** Object ID of the SellerAuthToken owned object. */
  sellerAuthTokenId: string;
  /** ISD-AS ID (u64) — read from the Interface object before calling. */
  isdAsId: bigint;
  /** Interface ID (u16) — read from the Interface object before calling. */
  ingressId: number | undefined;
  egressId: number | undefined;
  /** Total bandwidth in kbps (u64). */
  bandwidth: bigint;
  /** Listing start time in seconds since epoch (u64). */
  startTime: bigint;
  /** Listing expiry time in seconds since epoch (u64). */
  expTime: bigint;
  /** Time granularity in seconds (u64). */
  timeGranularity: bigint;
  /** Minimum purchasable time slice in seconds (u64). */
  timeMinDuration: bigint;
  /** Minimum purchasable time slice in seconds (u64). */
  timeMaxDuration: bigint;
  /** Minimum purchasable bandwidth in kbps (u64). */
  minBandwidth: bigint;
  /** Price in base coin units (u64). */
  price: bigint;
  /** Issuer address — the transaction signer. */
  issuer: string;
  /** Coin type, e.g. "0x2::sui::SUI". */
  coinType: string;
}

/**
 * Build a PTB that:
 *   1. Calls hummingbird_asset::issue (requires AsAuthCap) to mint the asset.
 *   2. Calls marketplace::create_listing to wrap it in a listing on the interface.
 */
export function buildCreateListing( params: CreateListingParams): Transaction {
  const tx = new Transaction();

  const asset = tx.moveCall({
    target: `${params.packageId}::hummingbird_asset::issue`,
    arguments: [
      tx.object(params.asAuthCapId),
      tx.pure.u64(params.isdAsId),
      tx.pure.option('u16', params.ingressId),
      tx.pure.option('u16', params.egressId),
      tx.pure.u64(params.bandwidth),
      tx.pure.u64(params.startTime),
      tx.pure.u64(params.expTime),
      tx.pure.u64(params.timeGranularity),
      tx.pure.u64(params.timeMinDuration),
      tx.pure.u64(params.timeMaxDuration), //TODO uncomment after contract update
      tx.pure.u64(params.minBandwidth),
      tx.pure.address(params.issuer),
    ],
  });

  tx.moveCall({
    target: `${params.packageId}::marketplace::create_listing`,
    typeArguments: [params.coinType],
    arguments: [
      tx.object(params.interfaceObjectId),
      asset,
      tx.pure.u64(params.price),
      tx.object(params.sellerAuthTokenId),
    ],
  });

  return tx;
}
