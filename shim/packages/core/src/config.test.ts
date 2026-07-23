import { describe, it, expect } from 'vitest';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from './config.js';

function makeTempPath(): string {
  return join(tmpdir(), `shim-config-test-${Date.now()}.toml`);
}

const VALID_TOML = `
[network]
name = "testnet"

[keystore]
path = "/tmp/sui.keystore"

[grpc]
port = 9090

[package]
id = "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab"
`;

describe('loadConfig', () => {
  it('parses a valid TOML config', async () => {
    const path = makeTempPath();
    await writeFile(path, VALID_TOML, 'utf-8');
    try {
      const cfg = await loadConfig(path);
      expect(cfg.network.name).toBe('testnet');
      expect(cfg.grpc.port).toBe(9090);
    } finally {
      await unlink(path);
    }
  });

  it('throws on missing file', async () => {
    await expect(loadConfig('/nonexistent/shim.toml')).rejects.toThrow();
  });

  it('throws on invalid network name', async () => {
    const path = makeTempPath();
    await writeFile(path, VALID_TOML.replace('testnet', 'badnet'), 'utf-8');
    try {
      await expect(loadConfig(path)).rejects.toThrow(/Invalid config/);
    } finally {
      await unlink(path);
    }
  });
});
