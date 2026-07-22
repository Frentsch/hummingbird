import { Transaction } from '@mysten/sui/transactions';
import type { TransactionArgument } from '@mysten/sui/transactions';
import { DEFAULT_COIN_TYPE, moveTarget } from './manifest.js';

export interface BuyAndTakeParams {
  packageId: string;
  /** Object ID of the Interface (router) shared object. */
  interfaceObjectId: string;
  /**
   * Listing ID — an ObjectBag key, NOT a direct object reference.
   * Must be passed as tx.pure.id() so it is BCS-encoded as a pure u256 value.
   */
  listingId: string;
  /** Desired start time in seconds since epoch (u64). */
  startTime: bigint;
  /** Desired expiry time in seconds since epoch (u64). */
  expTime: bigint;
  /** Desired bandwidth in kbps (u64). */
  bandwidth: bigint;
  /** Upper bound on payment for this single-asset call (only used by buildBuyAndTake). */
  maxPrice: bigint;
  /** Coin type, e.g. "0x2::sui::SUI". */
  coinType: string;
}

/**
 * Build a PTB that calls marketplace::buy_and_take<COIN>.
 * Transfers the HummingbirdAsset and coin change to the signer on success.
 */
export function buildBuyAndTake(params: BuyAndTakeParams): Transaction {
  const tx = new Transaction();
  const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(params.maxPrice)]);
  addBuyAndTake(tx, params, coin);
  return tx;
}

/**
 * Add a buy_and_take move call to an existing transaction block.
 * `coin` must be a pre-split coin result (e.g. from tx.splitCoins).
 * Use this to batch multiple purchases into a single atomic PTB.
 */
export function addBuyAndTake(
  tx: Transaction,
  params: Omit<BuyAndTakeParams, 'maxPrice'>,
  coin: TransactionArgument,
): void {
  tx.moveCall({
    target: moveTarget(params.packageId, 'buyAndTake'),
    typeArguments: [params.coinType ?? DEFAULT_COIN_TYPE],
    arguments: [
      tx.object(params.interfaceObjectId),
      // listingId is an ObjectBag key, not an object input — pass as pure ID.
      tx.pure.id(params.listingId),
      tx.pure.u64(params.startTime),
      tx.pure.u64(params.expTime),
      tx.pure.u64(params.bandwidth),
      coin,
    ],
  });
}
