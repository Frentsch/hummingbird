import {
  createSuiClient,
  loadKeypairs,
  resolveSigner,
  PlaintextUnlocker,
  executeTransaction,
  loadConfig,
} from '@sui-shim/core';
import type { SuiJsonRpcClient, TxResult, Config } from '@sui-shim/core';
import type { Transaction } from '@mysten/sui/transactions';
import type { Keypair } from '@mysten/sui/cryptography';

export interface CliCtx {
  client: SuiJsonRpcClient;
  signer: Keypair;
  config: Config;
  keypairs: Array<Keypair>;
}

export async function makeCtx(configPath: string): Promise<CliCtx> {
  const config = await loadConfig(configPath);
  const client = createSuiClient(config.network.name);
  const keypairs = await loadKeypairs({ path: config.keystore.path, unlocker: new PlaintextUnlocker() });
  const signer = resolveSigner(keypairs, config.keystore.address);
  return { client, signer, config, keypairs};
}

export async function runTx(ctx: CliCtx, tx: Transaction): Promise<TxResult> {
  const result = await executeTransaction(
    ctx.client as Parameters<typeof executeTransaction>[0],
    ctx.signer,
    tx,
  );
  console.log(`✓ digest: ${result.digest}`);
  console.log(`  status: ${result.effects.status.status}`);
  return result;
}
