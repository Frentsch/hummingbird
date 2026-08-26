import { Transaction } from '@mysten/sui/transactions';
import { moveTarget } from './manifest.js';

export interface RegisterSellerParams {
  packageId: string;
  paymentAddress: string;
}

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
