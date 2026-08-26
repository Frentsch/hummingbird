import { Transaction } from '@mysten/sui/transactions';
import { moveTarget } from './manifest.js';

export interface CreateInterfaceParams {
  packageId: string;
  asRegistryId: string;
  asAuthCapId: string;
  interfaceId: number;
}

export function buildCreateInterface(params: CreateInterfaceParams): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: moveTarget(params.packageId, 'createInterface') ,
    arguments: [
      tx.object(params.asRegistryId),
      tx.object(params.asAuthCapId),
      tx.pure.u32(params.interfaceId),
      tx.object("0x6"), //clock
    ],
  });
  return tx;
}
