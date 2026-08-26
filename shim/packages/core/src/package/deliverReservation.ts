import { Transaction } from '@mysten/sui/transactions';
import { moveTarget } from './manifest.js';

export interface DeliverReservationParams {
  packageId: string;
  redeemRequestId: string;
  encryptedReservation: Uint8Array;
  resId: bigint,
  bwRounded: bigint,
  bwDataplaneEncoding: number,
}

export function buildDeliverReservation(params: DeliverReservationParams): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: moveTarget(params.packageId, 'deliverReservation'),
    arguments: [
      tx.object(params.redeemRequestId),
      tx.pure.vector('u8', Array.from(params.encryptedReservation)),
      tx.pure.u64(params.resId),
      tx.pure.u64(params.bwRounded),
      tx.pure.u32(params.bwDataplaneEncoding),
    ],
  });
  return tx;
}
