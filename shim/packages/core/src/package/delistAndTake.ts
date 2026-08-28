import { Transaction } from '@mysten/sui/transactions';
import { moveTarget } from './manifest.js';
import { crypto_pwhash_scryptsalsa208sha256_MEMLIMIT_SENSITIVE } from 'libsodium-wrappers';

export interface DelistAndTakeParams {
  packageId: string;
  interfaceObjectId: string;
  listingId: string;
  sellerAuthTokenId: string;
  coinType: string;
}

export function buildDelistAndTake(params: DelistAndTakeParams): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: moveTarget(params.packageId, 'delistAndTake'),
    typeArguments: [params.coinType],
    arguments: [
      tx.object(params.interfaceObjectId),
      tx.pure.id(params.listingId),
      tx.object(params.sellerAuthTokenId),
    ],
  });
  return tx;
}


export function buildDelistAndDestroy(params: DelistAndTakeParams): Transaction {
  const tx = new Transaction();
  const asset = tx.moveCall({
    target: moveTarget(params.packageId, 'delist'),
    typeArguments: [params.coinType],
    arguments: [
      tx.object(params.interfaceObjectId),
      tx.pure.id(params.listingId),
      tx.object(params.sellerAuthTokenId),
    ]
  });

  tx.moveCall({
    target: moveTarget(params.packageId, 'destroy'),
    arguments: [
      asset
    ]
  });
  
  return tx;
}