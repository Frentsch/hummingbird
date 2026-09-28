/**
 * Open-loop load generator against the shared Interface object.
 *
 * Workloads (one "op" = one Move call on &mut Interface):
 *   create     create_listing on a pre-issued asset
 *   buy        buy_and_take of a whole pre-created listing (no split, bag shrinks)
 *   buy-split  buy_and_take of the next time slot of a long listing (split path, remainder re-added)
 *
 * For each target rate (tx/s) the generator fires transactions on a fixed schedule for
 * --duration seconds. Each lane owns its gas coin/assets and has at most one tx in
 * flight; if no lane is free when a tx is due it is counted as `skipped` (the
 * generator, not the chain, was the bottleneck — add lanes via setup.ts).
 *
 * Usage: npm run run -- --workload create --rates 10,25,50,100 --duration 30 [--interfaces 1] [--batch 1]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Inputs, Transaction, TransactionDataBuilder } from '@mysten/sui/transactions';
import type { SuiClientTypes } from '@mysten/sui/client';
import {
  CLOCK,
  SUI_TYPE,
  applyEffects,
  createClient,
  fetchRefs,
  keypairFromState,
  loadState,
  mapLimit,
  parseArgs,
  sleep,
  type InterfaceInfo,
  type ObjRef,
} from './common.js';

type Workload = 'create' | 'buy' | 'buy-split';

const { values: args } = parseArgs({
  options: {
    state: { type: 'string', default: 'state.json' },
    workload: { type: 'string', default: 'create' },
    rates: { type: 'string', default: '5,10,20,40' },
    duration: { type: 'string', default: '30' },
    warmup: { type: 'string', default: '5' },
    pause: { type: 'string', default: '5' },
    interfaces: { type: 'string', default: '1' },
    lanes: { type: 'string' },
    batch: { type: 'string', default: '1' },
    'gas-budget': { type: 'string' }, // per tx, MIST; default 0.05 SUI per op
    'inventory-factor': { type: 'string', default: '1.3' },
    'max-lane-tps': { type: 'string', default: '10' },
    out: { type: 'string', default: 'results' },
    'no-checkpoints': { type: 'boolean', default: false },
    'checkpoint-timeout': { type: 'string', default: '120' }, // s per step
  },
});

const workload = args.workload as Workload;
if (!['create', 'buy', 'buy-split'].includes(workload)) throw new Error(`unknown workload ${workload}`);
const rates = args.rates!.split(',').map(Number);
const durationS = Number(args.duration);
const warmupS = Number(args.warmup);
const pauseS = Number(args.pause);
const batch = Number(args.batch);
const gasBudget = args['gas-budget'] ? BigInt(args['gas-budget']) : 50_000_000n * BigInt(batch);

const state = loadState(args.state!);
const { client } = createClient(state.network, state.grpcHost);
const keypair = keypairFromState(state);
const address = state.address;
const pkg = state.packageId;

const numIfaces = Number(args.interfaces);
const numLanes = Number(args.lanes ?? state.lanes.length);
if (numIfaces > state.interfaces.length) throw new Error(`only ${state.interfaces.length} interfaces provisioned`);
if (numLanes > state.lanes.length) throw new Error(`only ${state.lanes.length} lanes provisioned`);
if (numLanes < numIfaces) throw new Error('need at least one lane per interface');

// Asset parameters. Times are unix seconds, bandwidth in kbps; 1 kbps keeps buys cheap.
const PRICE = 1n;
const BW = 1;
const SLOT_S = 10n;
const now = BigInt(Math.floor(Date.now() / 1000));
const LISTING_START = now;
const LISTING_EXP = now + 3600n;

// --- Lanes ---

interface Lane {
  idx: number;
  iface: InterfaceInfo;
  refs: Map<string, ObjRef>; // every owned object this lane uses
  gasId: string;
  tokenId: string;
  capId: string;
  assets: string[]; // create: unlisted assets
  listings: string[]; // buy: whole listings to buy
  split?: { listingId: string; next: bigint; end: bigint }; // buy-split
}

const lanes: Lane[] = [];
{
  const laneObjs = state.lanes.slice(0, numLanes);
  const refs = await fetchRefs(client, laneObjs.flatMap((l) => [l.gasCoin, l.sellerToken, l.asAuthCap]));
  laneObjs.forEach((l, idx) => {
    const own = new Map<string, ObjRef>();
    for (const id of [l.gasCoin, l.sellerToken, l.asAuthCap]) {
      const r = refs.get(id);
      if (!r) throw new Error(`lane ${idx}: object ${id} missing`);
      own.set(id, r);
    }
    lanes.push({
      idx,
      iface: state.interfaces[idx % numIfaces],
      refs: own,
      gasId: l.gasCoin,
      tokenId: l.sellerToken,
      capId: l.asAuthCap,
      assets: [],
      listings: [],
    });
  });
}

const gasPrice = await client.getReferenceGasPrice();

function ifaceArg(iface: InterfaceInfo) {
  return Inputs.SharedObjectRef({
    objectId: iface.objectId,
    initialSharedVersion: iface.initialSharedVersion,
    mutable: true,
  });
}

function ref(lane: Lane, id: string) {
  const r = lane.refs.get(id);
  if (!r) throw new Error(`lane ${lane.idx}: no ref for ${id}`);
  return Inputs.ObjectRef(r);
}

/** Build fully offline (all refs known), so no RPC happens on the hot path. */
async function buildBytes(lane: Lane, tx: Transaction, budget: bigint) {
  tx.setSender(address);
  tx.setGasPrice(gasPrice.referenceGasPrice);
  tx.setGasBudget(budget);
  tx.setGasPayment([lane.refs.get(lane.gasId)!]);
  return tx.build();
}

// --- Prepare (untimed): give every lane enough inventory for the whole run ---

const maxLaneTps = Number(args['max-lane-tps']);
const factor = Number(args['inventory-factor']);
const txsPerLane = [warmupS, ...rates.map(() => durationS)]
  .map((d, i) => Math.min(((i === 0 ? rates[0] : rates[i - 1]) * d * factor) / numLanes, d * maxLaneTps))
  .reduce((a, b) => a + Math.ceil(b), 0);
const opsPerLane = (txsPerLane + 2) * batch;

function issueAssets(tx: Transaction, lane: Lane, n: number, start: bigint, exp: bigint) {
  const shared = {
    cap: tx.object(ref(lane, lane.capId)),
    isd: tx.pure.u64(state.isdAsId),
    ingress: tx.pure.option('u32', null),
    egress: tx.pure.option('u32', lane.iface.interfaceId),
    bw: tx.pure.u32(BW),
    start: tx.pure.u64(start),
    exp: tx.pure.u64(exp),
    routerOnly: tx.pure.bool(false),
    gran: tx.pure.u64(1),
    minDur: tx.pure.u64(1),
    maxDur: tx.pure.u64(exp - start),
    bwMin: tx.pure.u32(1),
    bwMax: tx.pure.u32(BW),
    issuer: tx.pure.address(address),
    clock: tx.object(CLOCK),
  };
  const s = shared;
  return Array.from({ length: n }, () =>
    tx.moveCall({
      target: `${pkg}::hummingbird_asset::issue`,
      arguments: [s.cap, s.isd, s.ingress, s.egress, s.bw, s.start, s.exp, s.routerOnly, s.gran, s.minDur, s.maxDur, s.bwMin, s.bwMax, s.issuer, s.clock],
    }),
  );
}

/** Prepare txs are large and may themselves be cancelled for congestion; rebuild and retry. */
async function prepareExec(lane: Lane, fill: (tx: Transaction) => void) {
  for (let attempt = 0; ; attempt++) {
    const tx = new Transaction();
    fill(tx);
    const bytes = await buildBytes(lane, tx, 5_000_000_000n);
    const res = await client.signAndExecuteTransaction({
      signer: keypair,
      transaction: bytes,
      include: { effects: true, objectTypes: true },
    });
    const txn = res.$kind === 'Transaction' ? res.Transaction : res.FailedTransaction;
    applyEffects(lane.refs, txn.effects);
    if (txn.status.success) return txn;
    if (txn.status.error.$kind !== 'CongestedObjects' || attempt >= 20) {
      throw new Error(`prepare tx failed on lane ${lane.idx}: ${txn.status.error.message}`);
    }
    await sleep(200 + Math.random() * 800);
  }
}

function created(txn: SuiClientTypes.Transaction<{ effects: true; objectTypes: true }>, frag: string) {
  return txn.effects.changedObjects.filter(
    (c) => c.idOperation === 'Created' && (txn.objectTypes[c.objectId] ?? '').includes(frag),
  );
}

async function prepareLane(lane: Lane) {
  if (workload === 'create') {
    for (let have = 0; have < opsPerLane; ) {
      const n = Math.min(100, opsPerLane - have);
      const txn = await prepareExec(lane, (tx) =>
        tx.transferObjects(issueAssets(tx, lane, n, LISTING_START, LISTING_EXP), address),
      );
      for (const c of created(txn, '::hummingbird_asset::HummingbirdAsset')) {
        lane.refs.set(c.objectId, { objectId: c.objectId, version: c.outputVersion!, digest: c.outputDigest! });
        lane.assets.push(c.objectId);
      }
      have += n;
    }
  } else if (workload === 'buy') {
    for (let have = 0; have < opsPerLane; ) {
      const n = Math.min(50, opsPerLane - have);
      const txn = await prepareExec(lane, (tx) => {
        const iface = tx.object(ifaceArg(lane.iface));
        const token = tx.object(ref(lane, lane.tokenId));
        const price = tx.pure.u64(PRICE);
        for (const asset of issueAssets(tx, lane, n, LISTING_START, LISTING_EXP)) {
          tx.moveCall({
            target: `${pkg}::marketplace::create_listing`,
            typeArguments: [SUI_TYPE],
            arguments: [iface, asset, price, token],
          });
        }
      });
      lane.listings.push(...created(txn, '::marketplace::AssetListing<').map((c) => c.objectId));
      have += n;
    }
  } else {
    // One long listing; each op buys the next SLOT_S seconds off its front.
    const end = LISTING_START + BigInt(opsPerLane + 1) * SLOT_S;
    const txn = await prepareExec(lane, (tx) => {
      const [asset] = issueAssets(tx, lane, 1, LISTING_START, end);
      tx.moveCall({
        target: `${pkg}::marketplace::create_listing`,
        typeArguments: [SUI_TYPE],
        arguments: [tx.object(ifaceArg(lane.iface)), asset, tx.pure.u64(PRICE), tx.object(ref(lane, lane.tokenId))],
      });
    });
    const [listing] = created(txn, '::marketplace::AssetListing<');
    lane.split = { listingId: listing.objectId, next: LISTING_START, end };
  }
}

console.log(
  `preparing ${workload}: ${numLanes} lanes x ${opsPerLane} ops over ${numIfaces} interface(s)...`,
);
const prepStart = Date.now();
await mapLimit(lanes, 16, prepareLane);
console.log(`prepared in ${((Date.now() - prepStart) / 1000).toFixed(1)}s`);

// --- Timed ops ---

function available(lane: Lane): boolean {
  if (workload === 'create') return lane.assets.length >= batch;
  if (workload === 'buy') return lane.listings.length >= batch;
  return lane.split!.next + BigInt(batch) * SLOT_S < lane.split!.end;
}

/** Adds `batch` ops to `tx`; returns a callback to run once the outcome is known. */
function addOps(tx: Transaction, lane: Lane): (success: boolean) => void {
  const iface = tx.object(ifaceArg(lane.iface));
  if (workload === 'create') {
    const ids = lane.assets.splice(0, batch);
    const token = tx.object(ref(lane, lane.tokenId));
    const price = tx.pure.u64(PRICE);
    for (const id of ids) {
      tx.moveCall({
        target: `${pkg}::marketplace::create_listing`,
        typeArguments: [SUI_TYPE],
        arguments: [iface, tx.object(ref(lane, id)), price, token],
      });
    }
    // On failure the assets are untouched (only their version bumped, tracked via refs).
    return (ok) => {
      if (!ok) lane.assets.unshift(...ids.filter((id) => lane.refs.has(id)));
    };
  }
  if (workload === 'buy') {
    const ids = lane.listings.splice(0, batch);
    for (const id of ids) {
      tx.moveCall({
        target: `${pkg}::marketplace::buy_and_take`,
        typeArguments: [SUI_TYPE],
        arguments: [iface, tx.pure.id(id), tx.pure.u64(LISTING_START), tx.pure.u64(LISTING_EXP), tx.pure.u32(BW), tx.gas],
      });
    }
    return (ok) => {
      if (!ok) lane.listings.unshift(...ids);
    };
  }
  const split = lane.split!;
  const listing = tx.pure.id(split.listingId);
  for (let j = 0n; j < BigInt(batch); j++) {
    const start = split.next + j * SLOT_S;
    tx.moveCall({
      target: `${pkg}::marketplace::buy_and_take`,
      typeArguments: [SUI_TYPE],
      arguments: [iface, listing, tx.pure.u64(start), tx.pure.u64(start + SLOT_S), tx.pure.u32(BW), tx.gas],
    });
  }
  return (ok) => {
    if (ok) split.next += BigInt(batch) * SLOT_S;
  };
}

interface TxRecord {
  step: string;
  targetTps: number;
  lane: number;
  iface: number;
  ops: number;
  submitMs: number; // relative to run start
  latencyMs: number;
  status: string; // ok | congested | abort:<code> | <error kind> | rpc_error
  error: string;
  digest: string;
  computationCost: string;
  storageCost: string;
  checkpoint?: string;
  checkpointTsMs?: number;
}

const records: TxRecord[] = [];
const runStart = performance.now();
const runStartEpochMs = Date.now();

function classify(err: SuiClientTypes.ExecutionError): string {
  if (err.$kind === 'CongestedObjects') return 'congested';
  if (err.$kind === 'MoveAbort') return `abort:${err.MoveAbort.abortCode}`;
  if (err.$kind === 'Unknown') return err.message.split(/[\s{(]/)[0] || 'Unknown';
  return err.$kind;
}

async function fire(lane: Lane, step: string, targetTps: number) {
  const tx = new Transaction();
  const settle = addOps(tx, lane);
  const bytes = await buildBytes(lane, tx, gasBudget);
  const digest = TransactionDataBuilder.getDigestFromBytes(bytes);
  const { signature } = await keypair.signTransaction(bytes);

  const rec: TxRecord = {
    step,
    targetTps,
    lane: lane.idx,
    iface: lane.iface.interfaceId,
    ops: batch,
    submitMs: performance.now() - runStart,
    latencyMs: 0,
    status: '',
    error: '',
    digest,
    computationCost: '',
    storageCost: '',
  };
  records.push(rec);

  let txn: SuiClientTypes.Transaction<{ effects: true }> | undefined;
  try {
    const res = await client.executeTransaction({ transaction: bytes, signatures: [signature], include: { effects: true } });
    txn = res.$kind === 'Transaction' ? res.Transaction : res.FailedTransaction;
  } catch (e) {
    rec.error = (e as Error).message.replaceAll(/[\n,]/g, ' ').slice(0, 300);
    // The tx may still have gone through; find out before touching the lane again.
    try {
      const res = await client.waitForTransaction({ digest, include: { effects: true }, timeout: 60_000 });
      txn = res.$kind === 'Transaction' ? res.Transaction : res.FailedTransaction;
    } catch {
      /* not executed */
    }
  }
  rec.latencyMs = performance.now() - runStart - rec.submitMs;

  if (!txn) {
    rec.status = 'rpc_error';
    const fresh = await fetchRefs(client, [...lane.refs.keys()]);
    for (const id of [...lane.refs.keys()]) {
      const r = fresh.get(id);
      if (r) lane.refs.set(id, r);
      else lane.refs.delete(id);
    }
    settle(false);
    return;
  }
  applyEffects(lane.refs, txn.effects);
  rec.status = txn.status.success ? 'ok' : classify(txn.status.error);
  if (!txn.status.success) rec.error = txn.status.error.message.replaceAll(/[\n,]/g, ' ').slice(0, 300);
  rec.computationCost = txn.effects.gasUsed.computationCost;
  rec.storageCost = txn.effects.gasUsed.storageCost;
  settle(txn.status.success);
}

async function runStep(step: string, targetTps: number, seconds: number) {
  const free: Lane[] = lanes.filter(available);
  const inflight = new Set<Promise<void>>();
  let skipped = 0;
  const intervalMs = 1000 / targetTps;
  const total = Math.round(targetTps * seconds);
  const t0 = performance.now();

  for (let i = 0; i < total; ) {
    const due = Math.min(total, Math.floor((performance.now() - t0) / intervalMs) + 1);
    for (; i < due; i++) {
      const lane = free.shift();
      if (!lane) {
        skipped++;
        continue;
      }
      const p = fire(lane, step, targetTps)
        .catch((e) => console.error(`lane ${lane.idx}: ${(e as Error).message}`))
        .finally(() => {
          inflight.delete(p);
          if (available(lane)) free.push(lane);
        });
      inflight.add(p);
    }
    const nextAt = t0 + i * intervalMs;
    await sleep(Math.max(0, nextAt - performance.now()));
  }
  await Promise.all(inflight);
  return skipped;
}

// --- Checkpoint attribution (authoritative on-chain timing) ---

/**
 * Runs right after each step: localnet fullnodes prune old transactions after a few
 * (60 s) epochs, so looking everything up at the end of a long run finds nothing.
 * The fullnode indexes transactions seconds after their effects are returned (longer
 * under load), so all pending digests are polled in rounds until a deadline.
 */
async function attributeCheckpoints(step: string) {
  if (args['no-checkpoints']) return;
  let pending = records.filter((r) => r.step === step && r.status !== 'rpc_error');
  const total = pending.length;
  const deadline = Date.now() + Number(args['checkpoint-timeout']) * 1000;
  while (pending.length > 0 && Date.now() < deadline) {
    const found = await mapLimit(pending, 32, async (r) => {
      try {
        const res = await client.getTransaction({ digest: r.digest });
        const t = res.$kind === 'Transaction' ? res.Transaction : res.FailedTransaction;
        if (t.checkpoint === null) return false;
        r.checkpoint = t.checkpoint;
        r.checkpointTsMs = t.timestampMs ?? undefined;
        return true;
      } catch {
        return false; // not indexed yet
      }
    });
    pending = pending.filter((_, i) => !found[i]);
    if (pending.length > 0) await sleep(2000);
  }
  if (pending.length > 0) console.log(`  checkpoint lookup failed for ${pending.length}/${total} txs`);
}

// --- Main loop ---

const protocol = await client.getProtocolConfig();
const congestionAttrs = Object.fromEntries(
  Object.entries(protocol.protocolConfig.attributes).filter(([k]) =>
    /congestion|deferral|per_object|execution_time|max_txn_cost|consensus_gas/.test(k),
  ),
);

const skippedByStep: Record<string, number> = {};
if (warmupS > 0) {
  console.log(`warmup: ${rates[0]} tx/s for ${warmupS}s`);
  skippedByStep.warmup = await runStep('warmup', rates[0], warmupS);
  await attributeCheckpoints('warmup');
  await sleep(pauseS * 1000);
}
for (const [i, rate] of rates.entries()) {
  const step = `s${i}`;
  console.log(`step ${step}: ${rate} tx/s (${rate * batch} ops/s) for ${durationS}s`);
  skippedByStep[step] = await runStep(step, rate, durationS);
  const r = records.filter((x) => x.step === step);
  const ok = r.filter((x) => x.status === 'ok').length;
  console.log(
    `  submitted ${r.length}, ok ${ok} (${(ok / durationS).toFixed(1)} tx/s), congested ${r.filter((x) => x.status === 'congested').length}, other ${r.length - ok - r.filter((x) => x.status === 'congested').length}, skipped ${skippedByStep[step]}`,
  );
  await attributeCheckpoints(step);
  if (i < rates.length - 1) await sleep(pauseS * 1000);
}

// --- Output ---

function pct(sorted: number[], p: number) {
  if (sorted.length === 0) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

const summary = ['warmup', ...rates.map((_, i) => `s${i}`)]
  .filter((s) => s in skippedByStep)
  .map((step) => {
    const r = records.filter((x) => x.step === step);
    const ok = r.filter((x) => x.status === 'ok');
    const lat = ok.map((x) => x.latencyMs).sort((a, b) => a - b);
    const secs = step === 'warmup' ? warmupS : durationS;
    // Checkpoint throughput: successful txs per second of checkpoint time, bucketed per second;
    // the median bucket is robust against the ramp-up/tail at the step edges.
    const ts = ok.map((x) => x.checkpointTsMs).filter((t): t is number => t !== undefined);
    const buckets = new Map<number, number>();
    for (const t of ts) buckets.set(Math.floor(t / 1000), (buckets.get(Math.floor(t / 1000)) ?? 0) + 1);
    const perSec = [...buckets.values()].sort((a, b) => a - b);
    const span = ts.length > 1 ? (Math.max(...ts) - Math.min(...ts)) / 1000 : NaN;
    return {
      step,
      target_tps: r[0]?.targetTps ?? 0,
      batch,
      duration_s: secs,
      submitted: r.length,
      skipped_no_free_lane: skippedByStep[step],
      ok: ok.length,
      congested: r.filter((x) => x.status === 'congested').length,
      failed_other: r.filter((x) => x.status !== 'ok' && x.status !== 'congested' && x.status !== 'rpc_error').length,
      rpc_error: r.filter((x) => x.status === 'rpc_error').length,
      ok_tps_client: +(ok.length / secs).toFixed(2),
      ok_ops_per_s_client: +((ok.length * batch) / secs).toFixed(2),
      ok_tps_checkpoint_span: +(ts.length / span).toFixed(2),
      ok_tps_checkpoint_median_sec: pct(perSec, 50),
      ok_tps_checkpoint_max_sec: perSec.at(-1) ?? NaN,
      lat_p50_ms: Math.round(pct(lat, 50)),
      lat_p95_ms: Math.round(pct(lat, 95)),
      lat_p99_ms: Math.round(pct(lat, 99)),
    };
  });

console.table(summary);

function toCsv(rows: object[]): string {
  if (rows.length === 0) return '';
  const cols = Object.keys(rows[0]);
  return [cols.join(','), ...rows.map((r) => cols.map((c) => (r as Record<string, unknown>)[c] ?? '').join(','))].join('\n') + '\n';
}

const stamp = new Date(runStartEpochMs).toISOString().replaceAll(/[:.]/g, '-');
const dir = join(args.out!, `${stamp}_${workload}_if${numIfaces}_l${numLanes}_b${batch}`);
mkdirSync(dir, { recursive: true });
const txCols: (keyof TxRecord)[] = ['step', 'targetTps', 'lane', 'iface', 'ops', 'submitMs', 'latencyMs', 'status', 'checkpoint', 'checkpointTsMs', 'computationCost', 'storageCost', 'digest', 'error'];
writeFileSync(
  join(dir, 'txs.csv'),
  toCsv(records.map((r) => Object.fromEntries(txCols.map((c) => [c, typeof r[c] === 'number' && c.endsWith('Ms') && c !== 'checkpointTsMs' ? (r[c] as number).toFixed(1) : r[c]])))),
);
writeFileSync(join(dir, 'summary.csv'), toCsv(summary));
writeFileSync(
  join(dir, 'meta.json'),
  JSON.stringify(
    {
      args,
      network: state.network,
      packageId: pkg,
      interfaces: state.interfaces.slice(0, numIfaces),
      lanes: numLanes,
      gasPrice: gasPrice.referenceGasPrice,
      gasBudgetPerTx: gasBudget.toString(),
      runStartEpochMs,
      protocolVersion: protocol.protocolConfig.protocolVersion,
      congestionConfig: congestionAttrs,
    },
    null,
    2,
  ),
);
console.log(`results written to ${dir}`);
process.exit(0);
