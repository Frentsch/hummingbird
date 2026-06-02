import { Transaction } from '@mysten/sui/transactions';
import { moveTarget } from './manifest.js';

export interface RegisterSellerParams {
  packageId: string;
  /** Address that will receive payments. Defaults to the signer's own address. */
  paymentAddress: string;
}

/**
 * Build a PTB that calls marketplace::register_seller_to_sender.
 * Transfers SellerAuthToken to the signer's address on success.
 */
export function buildRegisterSeller(params: RegisterSellerParams): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: moveTarget(params.packageId, 'registerSeller'),
    arguments: [
      tx.pure.address(params.paymentAddress),
    ],
  });
  return tx;
}
