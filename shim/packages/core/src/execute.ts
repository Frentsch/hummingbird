import type { Keypair } from '@mysten/sui/cryptography';
import type { Transaction } from '@mysten/sui/transactions';
import type { SuiClientTypes } from '@mysten/sui/client';
import { SuiTransactionError } from './errors.js';
import type { SuiGraphQLClient } from './sui-client.js';

export interface TxResult {
  digest: string;
  effects: SuiClientTypes.TransactionEffects;
  objectTypes: Record<string, string>;
  balanceChanges: SuiClientTypes.BalanceChange[];
}

export async function executeTransaction(
  client: SuiGraphQLClient,
  signer: Keypair,
  tx: Transaction,
): Promise<TxResult> {
  const attempts = 5;
  for(var i=0;i<attempts;i++) {
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
      console.log(`${txn.status.error.$kind}`)
      if(i==attempts-1)
        throw new SuiTransactionError(
          `Transaction failed: ${txn.status.error?.message ?? 'unknown error'}`,
          txn.digest,
        );
      continue;
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
  throw new SuiTransactionError(
    'Failed to execute transaction after 5 attempts'
  );
}

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
