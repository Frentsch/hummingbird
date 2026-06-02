import { describe, it, expect } from 'vitest';
import { toBase64 } from '@mysten/bcs';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { loadKeypairs } from './loader.js';
import { PlaintextUnlocker } from './unlocker.js';
import { resolveSigner } from './signer.js';
import { KeystoreError } from '../errors.js';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

/**
 * Build a 33-byte keystore entry (flag || privkey) from a raw 32-byte secret.
 * Returns both the base64 entry and the keypair, so tests can verify addresses.
 */
function makeEntry(secretKey: Uint8Array): { entry: string; keypair: Ed25519Keypair } {
  const bytes = new Uint8Array(33);
  bytes[0] = 0x00; // ED25519 flag
  bytes.set(secretKey, 1);
  return {
    entry: toBase64(bytes),
    keypair: Ed25519Keypair.fromSecretKey(secretKey),
  };
}

describe('loadKeypairs', () => {
  it('loads a single 33-byte entry through PlaintextUnlocker', async () => {
    const secret = new Uint8Array(randomBytes(32));
    const { entry, keypair } = makeEntry(secret);
    const path = join(tmpdir(), `sui-shim-test-${Date.now()}.keystore`);
    await writeFile(path, JSON.stringify([entry]), 'utf-8');

    try {
      const keypairs = await loadKeypairs({ path, unlocker: new PlaintextUnlocker() });
      expect(keypairs).toHaveLength(1);
      expect(keypairs[0]!.toSuiAddress()).toBe(keypair.toSuiAddress());
    } finally {
      await unlink(path);
    }
  });

  it('loads multiple entries', async () => {
    const { entry: e1 } = makeEntry(new Uint8Array(randomBytes(32)));
    const { entry: e2 } = makeEntry(new Uint8Array(randomBytes(32)));
    const path = join(tmpdir(), `sui-shim-test-${Date.now()}.keystore`);
    await writeFile(path, JSON.stringify([e1, e2]), 'utf-8');

    try {
      const keypairs = await loadKeypairs({ path });
      expect(keypairs).toHaveLength(2);
    } finally {
      await unlink(path);
    }
  });

  it('throws KeystoreError for missing file', async () => {
    await expect(
      loadKeypairs({ path: '/nonexistent/path/sui.keystore' }),
    ).rejects.toBeInstanceOf(KeystoreError);
  });

  it('throws KeystoreError for malformed JSON', async () => {
    const path = join(tmpdir(), `sui-shim-test-${Date.now()}.keystore`);
    await writeFile(path, 'not json', 'utf-8');
    try {
      await expect(loadKeypairs({ path })).rejects.toBeInstanceOf(KeystoreError);
    } finally {
      await unlink(path);
    }
  });
});

describe('resolveSigner', () => {
  it('returns the first keypair when no address given', () => {
    const kp1 = new Ed25519Keypair();
    const kp2 = new Ed25519Keypair();
    const result = resolveSigner([kp1, kp2]);
    expect(result.toSuiAddress()).toBe(kp1.toSuiAddress());
  });

  it('returns the matching keypair by address', () => {
    const kp1 = new Ed25519Keypair();
    const kp2 = new Ed25519Keypair();
    const result = resolveSigner([kp1, kp2], kp2.toSuiAddress());
    expect(result.toSuiAddress()).toBe(kp2.toSuiAddress());
  });

  it('throws KeystoreError when address not found', () => {
    const kp = new Ed25519Keypair();
    expect(() =>
      resolveSigner([kp], '0x0000000000000000000000000000000000000000000000000000000000000001'),
    ).toThrowError(KeystoreError);
  });

  it('throws KeystoreError for empty keystore', () => {
    expect(() => resolveSigner([])).toThrowError(KeystoreError);
  });
});
