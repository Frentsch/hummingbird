import { Transaction } from '@mysten/sui/transactions';
import { moveTarget } from './manifest.js';

export interface RedeemParams {
  packageId: string;
  /** Object ID of the ingress HummingbirdAsset owned object. */
  ingressAssetId: string;
  /** Object ID of the egress HummingbirdAsset owned object. */
  egressAssetId: string;
  /** Buyer's public key bytes, passed to the AS for encryption. */
  publicKey: Uint8Array;
}

/**
 * Build a PTB that calls hummingbird_asset::redeem.
 * Consumes both assets and creates a RedeemRequest transferred to the AS issuer.
 * Emits RedeemRequestReceived.
 */
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
