import { Transaction } from '@mysten/sui/transactions';
import { moveTarget } from './manifest.js';

export interface BuyAndTakeParams {
  packageId: string;
  /** Object ID of the Interface (router) shared object. */
  interfaceObjectId: string;
  /**
   * Listing ID — an ObjectBag key, NOT a direct object reference.
   * Must be passed as tx.pure.id() so it is BCS-encoded as a pure u256 value.
   */
  listingId: string;
  /** Desired start time in ms since epoch (u64). */
  startTime: bigint;
  /** Desired expiry time in ms since epoch (u64). */
  expTime: bigint;
  /** Desired bandwidth in kbps (u64). */
  bandwidth: bigint;
  maxPrice: bigint;
  /**
   * Object ID of the Coin<COIN> owned object used for payment.
   * When undefined the gas coin (tx.gas) is used — necessary when the user
   * holds only a single SUI coin, since using it as an explicit object input
   * would leave no coin available for gas.
   */
  paymentCoinId?: string;
  /** Coin type, e.g. "0x2::sui::SUI". */
  coinType: string;
}

/**
 * Build a PTB that calls marketplace::buy_and_take<COIN>.
 * Transfers the HummingbirdAsset and coin change to the signer on success.
 */
export function buildBuyAndTake(params: BuyAndTakeParams): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: moveTarget(params.packageId, 'buyAndTake'),
    typeArguments: [params.coinType],
    arguments: [
      tx.object(params.interfaceObjectId),
      // listingId is an ObjectBag key, not an object input — pass as pure ID.
      tx.pure.id(params.listingId),
      tx.pure.u64(params.startTime),
      tx.pure.u64(params.expTime),
      tx.pure.u64(params.bandwidth),
      params.paymentCoinId ? tx.object(params.paymentCoinId) : tx.splitCoins(tx.gas,[tx.pure.u64(params.maxPrice)]),
    ],
  });
  return tx;
}
