import { Transaction } from '@mysten/sui/transactions';
import { moveTarget } from './manifest.js';

export interface RegisterAsForParams {
  packageId: string;
  /** Object ID of the MarketAdminCap owned by the auth server. */
  marketAdminCapId: string;
  /** Object ID of the GlobalRegistry shared object. */
  globalRegistryId: string;
  /** ISD-AS identifier (u64). */
  isdAsId: bigint;
  /** Sui address that will receive the AsAuthCap. */
  recipient: string;
}

/**
 * Build a PTB that calls registry::register_as_for.
 * Requires the signer to own the MarketAdminCap.
 * Transfers AsAuthCap to `recipient` on success.
 */
export function buildRegisterAsFor(params: RegisterAsForParams): Transaction {
  throw new Error("Register AS has been deprecated. To create and register a new AS, create a new account");
  /*const tx = new Transaction();
  tx.moveCall({
    target: moveTarget(params.packageId, 'registerAsFor'),
    arguments: [
      tx.object(params.marketAdminCapId),
      tx.object(params.globalRegistryId),
      tx.pure.u64(params.isdAsId),
      tx.pure.address(params.recipient),
    ],
  });
  return tx;*/
}
