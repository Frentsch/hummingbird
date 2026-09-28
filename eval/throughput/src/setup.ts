/**
 * One-off provisioning for the throughput benchmark:
 *   - fresh funded keypair (reused if the state file already exists)
 *   - fresh publish of ../../contracts
 *   - one AS with N interfaces (each its own shared Interface object)
 *   - L "lanes": each with its own gas coin, SellerAuthToken and AsAuthCap, so
 *     lanes never contend on owned objects and only the Interface is shared.
 *
 * Usage: npm run setup -- [--network localnet] [--lanes 32] [--interfaces 4] [--sui-per-lane 50]
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction, type TransactionObjectArgument } from '@mysten/sui/transactions';
import { getFaucetHost, requestSuiFromFaucetV2 } from '@mysten/sui/faucet';
import {
  CLOCK,
  createClient,
  createdOfType,
  executeOrThrow,
  loadState,
  parseArgs,
  parseIsdAs,
  saveState,
  sleep,
  type InterfaceInfo,
  type LaneObjects,
  type Network,
} from './common.js';

const MIST = 1_000_000_000n;
const CONTRACTS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../contracts');

const { values: args } = parseArgs({
  options: {
    network: { type: 'string', default: 'localnet' },
    grpc: { type: 'string' },
    state: { type: 'string', default: 'state.json' },
    lanes: { type: 'string', default: '32' },
    interfaces: { type: 'string', default: '4' },
    'sui-per-lane': { type: 'string', default: '50' },
    'isd-as': { type: 'string', default: '1-ff00:0:110' },
  },
});

const network = args.network as Network;
const numLanes = Number(args.lanes);
const numInterfaces = Number(args.interfaces);
const perLane = BigInt(args['sui-per-lane']!) * MIST;
const isdAsId = parseIsdAs(args['isd-as']!);

const { client, host } = createClient(network, args.grpc);

const keypair = existsSync(args.state!)
  ? Ed25519Keypair.fromSecretKey(loadState(args.state!).secretKey)
  : Ed25519Keypair.generate();
const address = keypair.toSuiAddress();
console.log(`address: ${address}`);

// --- Funding ---

const needed = perLane * BigInt(numLanes) + 20n * MIST;
async function balance() {
  const { balance } = await client.getBalance({ owner: address });
  return BigInt(balance.coinBalance);
}
while ((await balance()) < needed) {
  console.log(`balance ${(await balance()) / MIST} SUI < ${needed / MIST} SUI, requesting faucet...`);
  try {
    await requestSuiFromFaucetV2({ host: getFaucetHost(network), recipient: address });
    await sleep(1000);
  } catch (e) {
    console.error(`faucet failed (${(e as Error).message}). Fund ${address} with ${needed / MIST} SUI manually and rerun.`);
    process.exit(1);
  }
}

// Merge everything into one coin (faucet coins, lane coins of a previous setup, buy
// payments). Otherwise automatic gas selection drags hundreds of coins into setup txs.
for (;;) {
  const { objects: coins } = await client.listCoins({ owner: address });
  if (coins.length <= 1) break;
  const tx = new Transaction();
  tx.setGasPayment(coins.slice(0, 200).map((c) => ({ objectId: c.objectId, version: c.version, digest: c.digest })));
  tx.transferObjects([tx.gas], address);
  await executeOrThrow(client, keypair, tx);
}

// --- Publish ---

console.log('building + publishing contracts...');
const build = JSON.parse(
  execFileSync('sui', ['move', 'build', '--dump-bytecode-as-base64', '--path', CONTRACTS_DIR], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }),
) as { modules: string[]; dependencies: string[] };

const publishTx = new Transaction();
const upgradeCap = publishTx.publish({ modules: build.modules, dependencies: build.dependencies });
publishTx.transferObjects([upgradeCap], address);
const published = await executeOrThrow(client, keypair, publishTx);

const packageId = published.effects.changedObjects.find((c) => c.outputState === 'PackageWrite')!.objectId;
const globalRegistry = createdOfType(published, '::registry::GlobalRegistry')[0];
const adminCap = createdOfType(published, '::registry::MarketAdminCap')[0];
console.log(`package: ${packageId}`);

const exp = BigInt(Math.floor(Date.now() / 1000) + 90 * 24 * 3600);

// --- AS + interfaces ---

const regTx = new Transaction();
regTx.moveCall({
  target: `${packageId}::registry::register_as_for`,
  arguments: [
    regTx.object(adminCap.objectId),
    regTx.object(globalRegistry.objectId),
    regTx.pure.u64(isdAsId),
    regTx.pure.u64(exp),
    regTx.pure.address(address),
  ],
});
const reg = await executeOrThrow(client, keypair, regTx);
const asRegistry = createdOfType(reg, '::registry::AsRegistry')[0];
const setupCap = createdOfType(reg, '::registry::AsAuthCap')[0];

const interfaces: InterfaceInfo[] = [];
for (let i = 1; i <= numInterfaces; i++) {
  const tx = new Transaction();
  tx.moveCall({
    target: `${packageId}::marketplace::create_interface`,
    arguments: [tx.object(asRegistry.objectId), tx.object(setupCap.objectId), tx.pure.u32(i), tx.object(CLOCK)],
  });
  const res = await executeOrThrow(client, keypair, tx);
  const iface = createdOfType(res, '::registry::Interface')[0];
  if (iface.owner?.$kind !== 'Shared') throw new Error('Interface not shared?');
  interfaces.push({
    objectId: iface.objectId,
    initialSharedVersion: iface.owner.Shared.initialSharedVersion,
    interfaceId: i,
  });
  console.log(`interface ${i}: ${iface.objectId}`);
}

// --- Lanes ---

// Tokens and caps first, gas coins last: automatic gas selection would otherwise pick up
// (and merge away) lane coins created by earlier chunks.
const tokens: string[] = [];
const caps: string[] = [];
const CHUNK = 100;
for (let start = 0; start < numLanes; start += CHUNK) {
  const n = Math.min(CHUNK, numLanes - start);
  const tx = new Transaction();
  const toTransfer: TransactionObjectArgument[] = [];
  for (let i = 0; i < n; i++) {
    toTransfer.push(
      tx.moveCall({ target: `${packageId}::marketplace::register_seller`, arguments: [tx.pure.address(address)] }),
    );
    tx.moveCall({
      target: `${packageId}::registry::register_as_for`,
      arguments: [
        tx.object(adminCap.objectId),
        tx.object(globalRegistry.objectId),
        tx.pure.u64(isdAsId),
        tx.pure.u64(exp),
        tx.pure.address(address),
      ],
    });
  }
  tx.transferObjects(toTransfer, address);
  const res = await executeOrThrow(client, keypair, tx);
  tokens.push(...createdOfType(res, '::marketplace::SellerAuthToken').map((o) => o.objectId));
  caps.push(...createdOfType(res, '::registry::AsAuthCap').map((o) => o.objectId));
}

// Gas coins, paying explicitly with coins that are not lane coins.
const gasCoins: string[] = [];
const SPLIT_CHUNK = 500;
for (let start = 0; start < numLanes; start += SPLIT_CHUNK) {
  const n = Math.min(SPLIT_CHUNK, numLanes - start);
  const laneCoins = new Set(gasCoins);
  const { objects: owned } = await client.listCoins({ owner: address, limit: 1000 });
  // Largest non-lane coins first; a tx accepts at most 256 gas payment objects.
  const payment = owned
    .filter((c) => !laneCoins.has(c.objectId))
    .sort((a, b) => (BigInt(b.balance) > BigInt(a.balance) ? 1 : -1))
    .slice(0, 200)
    .map((c) => ({ objectId: c.objectId, version: c.version, digest: c.digest }));
  const tx = new Transaction();
  tx.setGasPayment(payment);
  const amount = tx.pure.u64(perLane);
  const coins = tx.splitCoins(tx.gas, Array.from({ length: n }, () => amount));
  tx.transferObjects(Array.from({ length: n }, (_, i) => coins[i]), address);
  const res = await executeOrThrow(client, keypair, tx);
  gasCoins.push(...createdOfType(res, '::coin::Coin<').map((o) => o.objectId));
}

if (gasCoins.length !== numLanes || tokens.length !== numLanes || caps.length !== numLanes) {
  throw new Error(`lane provisioning mismatch: ${gasCoins.length}/${tokens.length}/${caps.length} != ${numLanes}`);
}
const lanes: LaneObjects[] = gasCoins.map((gasCoin, i) => ({ gasCoin, sellerToken: tokens[i], asAuthCap: caps[i] }));
console.log(`${lanes.length} lanes provisioned with ${perLane / MIST} SUI each`);

saveState(args.state!, {
  network,
  grpcHost: host,
  secretKey: keypair.getSecretKey(),
  address,
  packageId,
  isdAsId: isdAsId.toString(),
  interfaces,
  lanes,
});
console.log(`wrote ${args.state}`);
