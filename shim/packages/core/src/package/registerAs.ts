import { Transaction } from '@mysten/sui/transactions';
import { moveTarget } from './manifest.js';

export interface RegisterAsParams {
  packageId: string;
  /** Object ID of the GlobalRegistry shared object. */
  globalRegistryId: string;
  /** ISD-AS identifier (u64). */
  isdAsId: bigint;
}

/**
 * Build a PTB that calls registry::register_as_to_sender.
 * Transfers AsAuthCap to the signer's address on success.
 */
export function buildRegisterAs(params: RegisterAsParams): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: moveTarget(params.packageId, 'registerAs'),
    arguments: [
      tx.object(params.globalRegistryId),
      tx.pure.u64(params.isdAsId),
    ],
  });
  return tx;
}
