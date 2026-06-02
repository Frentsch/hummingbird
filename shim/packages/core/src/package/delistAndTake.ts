import { Transaction } from '@mysten/sui/transactions';
import { moveTarget } from './manifest.js';

export interface DelistAndTakeParams {
  packageId: string;
  /** Object ID of the Interface (router) shared object. */
  interfaceObjectId: string;
  /**
   * Listing ID — an ObjectBag key, NOT a direct object reference.
   * Passed as tx.pure.id() so it is BCS-encoded as a pure value.
   */
  listingId: string;
  /** Object ID of the SellerAuthToken owned object (proves seller identity). */
  sellerAuthTokenId: string;
  /** Coin type, e.g. "0x2::sui::SUI". */
  coinType: string;
}

/**
 * Build a PTB that calls marketplace::delist_and_take<COIN>.
 * Removes the listing from the Interface's ObjectBag and transfers the
 * underlying HummingbirdAsset back to the signer.
 */
export function buildDelistAndTake(params: DelistAndTakeParams): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: moveTarget(params.packageId, 'delistAndTake'),
    typeArguments: [params.coinType],
    arguments: [
      tx.object(params.interfaceObjectId),
      // listingId is an ObjectBag key — pass as pure ID value.
      tx.pure.id(params.listingId),
      tx.object(params.sellerAuthTokenId),
    ],
  });
  return tx;
}
