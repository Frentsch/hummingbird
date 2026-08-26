import { Transaction } from '@mysten/sui/transactions';
import { moveTarget } from './manifest.js';

export interface RedeemParams {
  packageId: string;
  ingressAssetId: string;
  egressAssetId: string;
  publicKey: Uint8Array;
}

export interface RedeemPairParams {
  packageId: string;
  interfacePairId: string;
  publicKey: Uint8Array;
}

export function buildRedeem(params: RedeemParams): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: moveTarget(params.packageId, 'redeem'),
    arguments: [
      tx.object(params.ingressAssetId),
      tx.object(params.egressAssetId),
      tx.pure.vector('u8', Array.from(params.publicKey)),
    ],
  });
  return tx;
}

export function buildRedeemPair(params: RedeemPairParams): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: moveTarget(params.packageId, 'redeemPair'),
      arguments: [
        tx.object(params.interfacePairId),
        tx.pure.vector('u8', Array.from(params.publicKey)),
      ],
  });
  return tx;
}
