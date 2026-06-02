import { Transaction } from '@mysten/sui/transactions';
import { moveTarget } from './manifest.js';

export interface DeliverReservationParams {
  packageId: string;
  /** Object ID of the RedeemRequest owned object (received by the AS issuer). */
  redeemRequestId: string;
  /**
   * Pre-encrypted reservation bytes.
   * The AS caller is responsible for encrypting with the buyer's public key
   * (provided in RedeemAssetFromASRequest.public_key from the on-chain RedeemRequest).
   */
  encryptedReservation: Uint8Array;
}

/**
 * Build a PTB that calls hummingbird_asset::deliver_reservation.
 * Consumes the RedeemRequest, destroys both embedded assets, and emits
 * ReservationDelivered with the encrypted reservation bytes.
 */
export function buildDeliverReservation(params: DeliverReservationParams): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: moveTarget(params.packageId, 'deliverReservation'),
    arguments: [
      tx.object(params.redeemRequestId),
      tx.pure.vector('u8', Array.from(params.encryptedReservation)),
    ],
  });
  return tx;
}
