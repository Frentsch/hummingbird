import { Transaction } from '@mysten/sui/transactions';
import type { TransactionArgument } from '@mysten/sui/transactions';
import { DEFAULT_COIN_TYPE, moveTarget } from './manifest.js';

export interface BuyAndTakeParams {
  packageId: string;
  interfaceObjectId: string;
  listingId: string;
  startTime: bigint;
  expTime: bigint;
  bandwidth: number;
  maxPrice: bigint;
  coinType: string;
}

export function buildBuyAndTake(params: BuyAndTakeParams): Transaction {
  const tx = new Transaction();
  const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(params.maxPrice)]);
  addBuyAndTake(tx, params, coin);
  return tx;
}

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
      tx.pure.id(params.listingId),
      tx.pure.u64(params.startTime),
      tx.pure.u64(params.expTime),
      tx.pure.u32(params.bandwidth),
      coin,
    ],
  });
}
