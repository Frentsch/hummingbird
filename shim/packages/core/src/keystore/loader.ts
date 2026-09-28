import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fromBase64 } from '@mysten/bcs';
import { encodeSuiPrivateKey, decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Secp256k1Keypair } from '@mysten/sui/keypairs/secp256k1';
import { Secp256r1Keypair } from '@mysten/sui/keypairs/secp256r1';
import type { Keypair } from '@mysten/sui/cryptography';
import { KeystoreError } from '../errors.js';

const DEFAULT_KEYSTORE_PATH = join(homedir(), '.sui', 'sui_config', 'sui.keystore');

function getKeypair(raw: Uint8Array): Keypair {
    switch (raw[0]) {
        case 0:     return Ed25519Keypair.fromSecretKey(raw.slice(1));
        case 1:     return Secp256k1Keypair.fromSecretKey(raw.slice(1));
        case 2:     return Secp256r1Keypair.fromSecretKey(raw.slice(1));
        default:
        throw new Error(`Key scheme ${raw[0]} not supported`);
    }
}

export async function loadKeypairs(
  options: { path?: string } = {},
): Promise<Keypair[]> {
  const path = options.path ?? DEFAULT_KEYSTORE_PATH;

  let contents: string;
  try {
    contents = await readFile(path, 'utf-8');
  } catch (cause) {
    throw new KeystoreError(`Could not read keystore at ${path}`, { cause });
  }

  let entries: string[];
  try {
    const parsed: unknown = JSON.parse(contents);
    if (!Array.isArray(parsed)) throw new Error('keystore is not a JSON array');
    entries = parsed as string[];
  } catch (cause) {
    throw new KeystoreError(`Malformed keystore at ${path}`, { cause });
  }

  return entries.map((b64) => getKeypair(fromBase64(b64)));
}

