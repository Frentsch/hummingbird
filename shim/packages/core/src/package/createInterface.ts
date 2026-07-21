import { Transaction } from '@mysten/sui/transactions';
import { moveTarget } from './manifest.js';

/**
 * Params for marketplace::create_interface<COIN>.
 * An Interface object represents a per-(isd_as_id, interface_id, interface_type) slot.
 */
export interface CreateInterfaceParams {
  packageId: string;
  /** Object ID of the AsRegistry shared object for this AS. */
  asRegistryId: string;
  /** Object ID of the AsAuthCap owned object. */
  asAuthCapId: string;
  /** Interface ID (u16). */
  interfaceId: number;
}

/**
 * Build a PTB that calls marketplace::create_interface<COIN>.
 * Creates a shared Interface object for the given interface.
 */
export function buildCreateInterface(params: CreateInterfaceParams): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: moveTarget(params.packageId, 'createInterface') ,
    arguments: [
      tx.object(params.asRegistryId),
      tx.object(params.asAuthCapId),
      tx.object("0x6"), //clock
      tx.pure.u16(params.interfaceId),
    ],
  });
  return tx;
}
