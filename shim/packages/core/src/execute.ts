import type { Keypair } from '@mysten/sui/cryptography';
import type { Transaction } from '@mysten/sui/transactions';
import type { SuiClientTypes } from '@mysten/sui/client';
import { SuiTransactionError } from './errors.js';
import type { SuiGraphQLClient } from './sui-client.js';

export interface TxResult {
  /** Transaction digest. */
  digest: string;
  /** Full execution effects. */
  effects: SuiClientTypes.TransactionEffects;
  /** Map of objectId → Move type string for all objects touched by the transaction. */
  objectTypes: Record<string, string>;
  /** Balance changes caused by the transaction. */
  balanceChanges: SuiClientTypes.BalanceChange[];
}

/**
 * Build → sign → submit → wait for execution effects → return TxResult.
 * Throws SuiTransactionError if the chain reports a non-success status.
 */
export async function executeTransaction(
  client: SuiGraphQLClient,
  signer: Keypair,
  tx: Transaction,
): Promise<TxResult> {
  const result = await client.signAndExecuteTransaction({
    signer,
    transaction: tx,
    include: {
      effects: true,
      balanceChanges: true,
      objectTypes: true,
    },
  });

  const txn = result.$kind === 'Transaction' ? result.Transaction : result.FailedTransaction;

  if (!txn.status.success) {
    throw new SuiTransactionError(
      `Transaction failed: ${txn.status.error?.message ?? 'unknown error'}`,
      txn.digest,
    );
  }

  const effects = txn.effects;
  if (!effects) {
    throw new SuiTransactionError(
      'Transaction executed but no effects returned',
      txn.digest,
    );
  }

  return {
    digest: txn.digest,
    effects,
    objectTypes: txn.objectTypes ?? {},
    balanceChanges: txn.balanceChanges ?? [],
  };
}

/**
 * Dry-run a transaction without submitting it to the network.
 * Useful for building and verifying a transaction before execution.
 * Returns effects from simulation; throws SuiTransactionError on simulated failure.
 */
export async function dryRunTransaction(
  client: SuiGraphQLClient,
  signer: Keypair,
  tx: Transaction,
): Promise<{ effects: SuiClientTypes.TransactionEffects }> {
  tx.setSenderIfNotSet(signer.toSuiAddress());
  const result = await client.simulateTransaction({
    transaction: tx,
    include: { effects: true },
  });

  const txn = result.$kind === 'Transaction' ? result.Transaction : result.FailedTransaction;

  if (!txn.status.success) {
    throw new SuiTransactionError(
      `Dry-run failed: ${txn.status.error?.message ?? 'unknown error'}`,
    );
  }

  if (!txn.effects) {
    throw new SuiTransactionError('Simulation returned no effects');
  }

  return { effects: txn.effects };
}
