import type { Keypair } from '@mysten/sui/cryptography';
import { KeystoreError } from '../errors.js';

/**
 * Resolve a signing keypair from the loaded set.
 *
 * If `address` is provided, returns the keypair whose Sui address matches.
 * Falls back to the first keypair in the file when address is omitted or empty.
 */
export function resolveSigner(keypairs: Keypair[], address?: string): Keypair {
  if (keypairs.length === 0) {
    throw new KeystoreError('Keystore contains no keypairs');
  }

  if (!address) {
    return keypairs[0]!;
  }

  const normalised = address.toLowerCase();
  const match = keypairs.find(
    (kp) => kp.toSuiAddress().toLowerCase() === normalised,
  );
  if (!match) {
    throw new KeystoreError(
      `No keypair found for address ${address}`,
    );
  }
  return match;
}
