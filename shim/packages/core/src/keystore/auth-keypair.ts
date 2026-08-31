import sodium from 'libsodium-wrappers';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { KeystoreError } from '../errors.js';

export interface AuthKeypair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

interface StoredAuthKeypair {
  scheme: 'x25519-xsalsa20poly1305';
  publicKey: string;
  privateKey: string;
}

function fromStored(stored: StoredAuthKeypair): AuthKeypair {
  return {
    publicKey: new Uint8Array(Buffer.from(stored.publicKey, 'base64')),
    privateKey: new Uint8Array(Buffer.from(stored.privateKey, 'base64')),
  };
}

async function generateAndPersist(path: string): Promise<AuthKeypair> {
  await sodium.ready;
  const { publicKey, privateKey } = sodium.crypto_box_keypair();

  const stored: StoredAuthKeypair = {
    scheme: 'x25519-xsalsa20poly1305',
    publicKey: Buffer.from(publicKey).toString('base64'),
    privateKey: Buffer.from(privateKey).toString('base64'),
  };

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(stored, null, 2), { mode: 0o600 });

  return fromStored(stored);
}

export async function loadOrCreateEncryptionKeypair(path: string): Promise<AuthKeypair> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
      return generateAndPersist(path);
    }
    throw new KeystoreError(`Could not read auth keypair at ${path}`, { cause });
  }

  try {
    return fromStored(JSON.parse(raw) as StoredAuthKeypair);
  } catch (cause) {
    throw new KeystoreError(`Malformed auth keypair at ${path}`, { cause });
  }
}

export async function sealToPublicKey(publicKey: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  await sodium.ready;
  return sodium.crypto_box_seal(message, publicKey);
}

export async function openSealed(keypair: AuthKeypair, ciphertext: Uint8Array): Promise<Uint8Array> {
  await sodium.ready;
  return sodium.crypto_box_seal_open(ciphertext, keypair.publicKey, keypair.privateKey);
}
