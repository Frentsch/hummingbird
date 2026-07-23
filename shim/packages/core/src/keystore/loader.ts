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

type Scheme = 'ED25519' | 'Secp256k1' | 'Secp256r1';

function schemeFromFlag(flag: number): Scheme {
  switch (flag) {
    case 0x00:
      return 'ED25519';
    case 0x01:
      return 'Secp256k1';
    case 0x02:
      return 'Secp256r1';
    default:
      throw new KeystoreError(`Unknown key scheme flag: 0x${flag.toString(16)}`);
  }
}

function keypairFor(scheme: Scheme, secretKey: Uint8Array): Keypair {
  switch (scheme) {
    case 'ED25519':
      return Ed25519Keypair.fromSecretKey(secretKey);
    case 'Secp256k1':
      return Secp256k1Keypair.fromSecretKey(secretKey);
    case 'Secp256r1':
      return Secp256r1Keypair.fromSecretKey(secretKey);
  }
}

/**
 * Parse a single decoded keystore entry into a Keypair.
 *
 * Handles both entry formats seen across Sui versions:
 *   - 33 bytes: flag(1) || privkey(32)              (current)
 *   - 65 bytes: flag(1) || pubkey(32) || privkey(32) (legacy)
 */
function parseEntry(bytes: Uint8Array): Keypair {
  const scheme = schemeFromFlag(bytes[0]!);

  let privkeyBytes: Uint8Array;
  if (bytes.length === 33) {
    privkeyBytes = bytes.slice(1);
  } else if (bytes.length === 65) {
    privkeyBytes = bytes.slice(33);
  } else {
    throw new KeystoreError(`Unexpected keystore entry length: ${bytes.length}`);
  }

  // Round-trip through the bech32 form so we use the SDK's canonical decoder.
  const { secretKey } = decodeSuiPrivateKey(encodeSuiPrivateKey(privkeyBytes, scheme));
  return keypairFor(scheme, secretKey);
}

/**
 * Load all keypairs from a Sui keystore file.
 */
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

  return Promise.all(
    entries.map(async (b64) => {
      const raw = fromBase64(b64);
      return parseEntry(raw);
    }),
  );
}

