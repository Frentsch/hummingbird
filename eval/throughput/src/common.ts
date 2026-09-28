import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { ChannelCredentials } from '@grpc/grpc-js';
import { GrpcTransport } from '@protobuf-ts/grpc-transport';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Inputs, Transaction } from '@mysten/sui/transactions';
import type { SuiClientTypes } from '@mysten/sui/client';

export type Network = 'localnet' | 'devnet' | 'testnet';

export const SUI_TYPE = '0x2::sui::SUI';
export const CLOCK = Inputs.SharedObjectRef({ objectId: '0x6', initialSharedVersion: 1, mutable: false });

const DEFAULT_GRPC: Record<Network, string> = {
  localnet: '127.0.0.1:9000',
  devnet: 'fullnode.devnet.sui.io:443',
  testnet: 'fullnode.testnet.sui.io:443',
};

export interface ObjRef {
  objectId: string;
  version: string;
  digest: string;
}

export interface InterfaceInfo {
  objectId: string;
  initialSharedVersion: string;
  interfaceId: number;
}

/** Per-lane owned objects. Every lane can have exactly one tx in flight. */
export interface LaneObjects {
  gasCoin: string;
  sellerToken: string;
  asAuthCap: string;
}

/** Written by setup.ts, read by run.ts. Only IDs are stored; versions are re-fetched on every run. */
export interface State {
  network: Network;
  grpcHost: string;
  secretKey: string;
  address: string;
  packageId: string;
  isdAsId: string;
  interfaces: InterfaceInfo[];
  lanes: LaneObjects[];
}

export function loadState(path: string): State {
  return JSON.parse(readFileSync(path, 'utf8')) as State;
}

export function saveState(path: string, state: State) {
  writeFileSync(path, JSON.stringify(state, null, 2));
}

export function createClient(network: Network, grpcHost?: string): { client: SuiGrpcClient; host: string } {
  const host = grpcHost ?? DEFAULT_GRPC[network];
  const creds = host.endsWith(':443') ? ChannelCredentials.createSsl() : ChannelCredentials.createInsecure();
  const transport = new GrpcTransport({ host, channelCredentials: creds });
  return { client: new SuiGrpcClient({ network, transport }), host };
}

export function keypairFromState(state: State): Ed25519Keypair {
  return Ed25519Keypair.fromSecretKey(state.secretKey);
}

/** "1-ff00:0:110" -> (isd << 48) | as. Plain decimal u64 is passed through. */
export function parseIsdAs(s: string): bigint {
  if (/^\d+$/.test(s)) return BigInt(s);
  const [isd, as] = s.split('-');
  const groups = as.split(':').map((g) => BigInt('0x' + g));
  const asNum = (groups[0] << 32n) | (groups[1] << 16n) | groups[2];
  return (BigInt(isd) << 48n) | asNum;
}

export type TxOutcome =
  | { kind: 'ok'; txn: SuiClientTypes.Transaction<{ effects: true; objectTypes: true }> }
  | { kind: 'failed'; txn: SuiClientTypes.Transaction<{ effects: true; objectTypes: true }> };

export async function execute(
  client: SuiGrpcClient,
  signer: Ed25519Keypair,
  tx: Transaction | Uint8Array,
): Promise<TxOutcome> {
  const res = await client.signAndExecuteTransaction({
    signer,
    transaction: tx,
    include: { effects: true, objectTypes: true },
  });
  return res.$kind === 'Transaction'
    ? { kind: 'ok', txn: res.Transaction }
    : { kind: 'failed', txn: res.FailedTransaction };
}

/** Execute during setup/prepare: must succeed, and wait until the fullnode has indexed it. */
export async function executeOrThrow(client: SuiGrpcClient, signer: Ed25519Keypair, tx: Transaction) {
  const out = await execute(client, signer, tx);
  if (out.kind !== 'ok') {
    throw new Error(`tx ${out.txn.digest} failed: ${out.txn.status.error?.message}`);
  }
  await client.waitForTransaction({ digest: out.txn.digest });
  return out.txn;
}

/** Created objects whose Move type contains `typeFragment`, as fresh refs. */
export function createdOfType(
  txn: SuiClientTypes.Transaction<{ effects: true; objectTypes: true }>,
  typeFragment: string,
): (ObjRef & { owner: SuiClientTypes.ObjectOwner | null })[] {
  return txn.effects.changedObjects
    .filter((c) => c.idOperation === 'Created' && (txn.objectTypes[c.objectId] ?? '').includes(typeFragment))
    .map((c) => ({ objectId: c.objectId, version: c.outputVersion!, digest: c.outputDigest!, owner: c.outputOwner }));
}

/** Update every ref in `refs` that the effects touched. Deleted/wrapped objects are removed. */
export function applyEffects(refs: Map<string, ObjRef>, effects: SuiClientTypes.TransactionEffects) {
  for (const c of effects.changedObjects) {
    if (!refs.has(c.objectId)) continue;
    if (c.outputState === 'ObjectWrite' && c.outputVersion && c.outputDigest) {
      refs.set(c.objectId, { objectId: c.objectId, version: c.outputVersion, digest: c.outputDigest });
    } else {
      refs.delete(c.objectId);
    }
  }
}

/** Fetch current refs for `ids`; ids that no longer exist are omitted. */
export async function fetchRefs(client: SuiGrpcClient, ids: string[]): Promise<Map<string, ObjRef>> {
  const out = new Map<string, ObjRef>();
  for (let i = 0; i < ids.length; i += 50) {
    const { objects } = await client.getObjects({ objectIds: ids.slice(i, i + 50) });
    for (const o of objects) {
      if (o instanceof Error) continue;
      out.set(o.objectId, { objectId: o.objectId, version: o.version, digest: o.digest });
    }
  }
  return out;
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export { parseArgs };
