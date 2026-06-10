import type { Keypair } from '@mysten/sui/cryptography';
import type { Transaction } from '@mysten/sui/transactions';
import { SuiTransactionError } from './errors.js';
import type { SuiJsonRpcClient } from './sui-client.js';

export interface TxResult {
  /** Transaction digest. */
  digest: string;
  /** Raw effects (always present — showEffects is forced true). */
  effects: NonNullable<Awaited<ReturnType<SuiJsonRpcClient['signAndExecuteTransaction']>>['effects']>;
  /** Object changes (always present — showObjectChanges is forced true). */
  objectChanges: NonNullable<Awaited<ReturnType<SuiJsonRpcClient['signAndExecuteTransaction']>>['objectChanges']>;
  balanceChanges: NonNullable<Awaited<ReturnType<SuiJsonRpcClient['signAndExecuteTransaction']>>['balanceChanges']>;
}

/**
 * Build → sign → submit → wait for execution effects → return TxResult.
 * Throws SuiTransactionError if the chain reports a non-success status.
 */
export async function executeTransaction(
  client: SuiJsonRpcClient,
  signer: Keypair,
  tx: Transaction,
): Promise<TxResult> {
  const response = await client.signAndExecuteTransaction({
    signer,
    transaction: tx,
    options: {
      showEffects: true,
      showEvents: true,
      showObjectChanges: true,
      showBalanceChanges: true
    },
  });
  
  const effects = response.effects;
  if (!effects) {
    throw new SuiTransactionError(
      'Transaction executed but no effects returned',
      response.digest,
    );
  }

  if (effects.status.status !== 'success') {
    throw new SuiTransactionError(
      `Transaction failed: ${effects.status.error ?? 'unknown error'}`,
      response.digest,
    );
  }

  return { digest: response.digest, effects, objectChanges: response.objectChanges ?? [], balanceChanges: response.balanceChanges ?? []};
}

/**
 * Dry-run a transaction without submitting it to the network.
 * Useful for building and verifying a transaction before execution.
 * Returns effects from simulation; throws SuiTransactionError on simulated failure.
 */
export async function dryRunTransaction(
  client: SuiJsonRpcClient,
  signer: Keypair,
  tx: Transaction,
): Promise<{ effects: Awaited<ReturnType<SuiJsonRpcClient['dryRunTransactionBlock']>>['effects'] }> {
  tx.setSenderIfNotSet(signer.toSuiAddress());
  const txBytes = await tx.build({ client });
  const result = await client.dryRunTransactionBlock({ transactionBlock: txBytes });

  if (result.effects.status.status !== 'success') {
    throw new SuiTransactionError(
      `Dry-run failed: ${result.effects.status.error ?? 'unknown error'}`,
    );
  }

  return { effects: result.effects };
}
