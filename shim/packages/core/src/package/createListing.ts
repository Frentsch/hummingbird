import { Transaction } from '@mysten/sui/transactions';
import { moveTarget } from './manifest.js';

export interface CreateListingParams {
  packageId: string;
  /** Object ID of the Interface (router) shared object. */
  interfaceObjectId: string;
  interfaceType: number;
  /** Object ID of the AsAuthCap owned object. */
  asAuthCapId: string;
  /** Object ID of the SellerAuthToken owned object. */
  sellerAuthTokenId: string;
  /** Total bandwidth in kbps (u64). */
  bandwidth: bigint;
  /** Listing start time in ms since epoch (u64). */
  startTime: bigint;
  /** Listing expiry time in ms since epoch (u64). */
  expTime: bigint;
  /** Time granularity in ms (u64). */
  timeGranularity: bigint;
  /** Minimum purchasable bandwidth in kbps (u64). */
  minBandwidth: bigint;
  /** Price in base coin units (u64). */
  price: bigint;
  /** Coin type, e.g. "0x2::sui::SUI". */
  coinType: string;
}

/**
 * Build a PTB that calls marketplace::create_listing_entry<COIN>.
 * Issues a HummingbirdAsset internally and stores it in the Interface's ObjectBag.
 */
export function buildCreateListing(params: CreateListingParams): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: moveTarget(params.packageId, 'createListing'),
    typeArguments: [params.coinType],
    arguments: [
      tx.object(params.interfaceObjectId),
      tx.object(params.asAuthCapId),
      tx.pure.u8(params.interfaceType),
      tx.pure.u64(params.bandwidth),
      tx.pure.u64(params.startTime),
      tx.pure.u64(params.expTime),
      tx.pure.u64(params.timeGranularity),
      tx.pure.u64(params.minBandwidth),
      tx.pure.u64(params.price),
      tx.object(params.sellerAuthTokenId),
    ],
  });
  return tx;
}
