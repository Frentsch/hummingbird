# Interface throughput benchmark

Measures how many `create_listing` / `buy` transactions per second can go through a single
shared `Interface` object (whose `listings: ObjectBag` every call mutates), and how that
changes when the load is spread over several interfaces or batched inside one PTB.

Evaluation-only code; it does not depend on the shim. It publishes its own copy of
`../../contracts`.

## Quick start (localnet)

```bash
# terminal 1: fresh local network with faucet; long epochs avoid epoch-change stalls mid-step
sui start --with-faucet --force-regenesis --epoch-duration-ms 3600000

# terminal 2
cd eval/throughput
npm install
npm run setup -- --lanes 64 --interfaces 8 --sui-per-lane 50
npm run run -- --workload create --rates 10,25,50,100,150 --duration 30
```

`--force-regenesis` wipes the chain, so delete `state.json` and rerun `setup` after every
restart of the network.

## How it works

**setup.ts** creates a keypair funded from the faucet and publishes the package. It then
registers one AS, creates `--interfaces` shared `Interface` objects, and provisions `--lanes`
*lanes*. Each lane has its own gas coin, `SellerAuthToken` and `AsAuthCap`. Everything is
stored in `state.json`.

Every owned input to a transaction is version-locked, including objects passed by `&`. Two
in-flight transactions sharing a gas coin or seller token would therefore block each other.
Lanes rule that out: each lane has at most one transaction in flight, so the only contention
left is on the `Interface`.

**run.ts**

1. **Prepare (untimed).** Gives every lane enough inventory for the whole run: issued assets
   for `create`, or pre-created listings for the buy workloads.
2. **Timed steps.** Fires transactions *open-loop* at each rate in `--rates` (tx/s) for
   `--duration` s, with a `--warmup` step first and a `--pause` between steps. A transaction
   that comes due while every lane is busy is counted as `skipped_no_free_lane` and is not
   sent. That column tells you the **generator** was the bottleneck, not the chain; add lanes
   when it is non-zero. As a rule of thumb, max rate ≈ lanes / latency.
3. **Hot-path build.** Transactions are built fully offline from locally tracked object refs,
   updated from each transaction's effects. No RPC happens besides `executeTransaction`.
4. **Checkpoint lookup.** After the run, every digest is looked up to get its checkpoint and
   checkpoint timestamp. This gives an on-chain throughput figure that doesn't depend on
   client timing.

### Workloads (`--workload`)

| workload    | one op =                                                                          | notes                                                            |
|-------------|-----------------------------------------------------------------------------------|------------------------------------------------------------------|
| `create`    | `create_listing<SUI>` of a pre-issued asset                                       | bag grows                                                        |
| `buy`       | `buy_and_take<SUI>` of a whole pre-created listing                                | no split, bag shrinks                                            |
| `buy-split` | `buy_and_take<SUI>` of the next 10 s slot of a long listing owned by the lane     | split path: remainder is re-added to the bag under the same ID   |

Payment uses the gas coin, so `COIN = SUI`. USDC doesn't exist on localnet, and the
coin type doesn't affect contention on the `Interface`.

### Useful flags

| flag                    | default     | meaning                                                                    |
|-------------------------|-------------|----------------------------------------------------------------------------|
| `--interfaces M`        | 1           | lane *i* targets interface *i mod M* (sharding experiment)                 |
| `--batch k`             | 1           | ops per PTB; rates stay in tx/s, and ops/s = tx/s × k                      |
| `--lanes L`             | all         | use only the first L provisioned lanes                                     |
| `--gas-budget`          | 0.05 SUI × k | per-tx gas budget in MIST                                                 |
| `--no-checkpoints`      | off         | skip the post-run checkpoint lookup                                        |
| `--state`               | state.json  | e.g. keep a `state-testnet.json` alongside the localnet one                |

## Output

`results/<timestamp>_<workload>_if<M>_l<L>_b<k>/`:

- **`summary.csv`**: one row per step:
  - `ok`, `congested` (`ExecutionCancelledDueToSharedObjectCongestion`), `failed_other`, `rpc_error`
  - `skipped_no_free_lane`
  - `ok_tps_client`: ok ÷ step duration
  - `ok_tps_checkpoint_*`: from checkpoint timestamps; use `median_sec` for steady state
  - latency p50/p95/p99 (submit → effects)
- **`txs.csv`**: one row per transaction, with lane, interface, submit time, latency, status,
  checkpoint, gas and digest.
- **`meta.json`**: arguments, protocol version, gas price and budget, and the protocol-config
  congestion-control parameters of the network the run was measured on. Cite these next to
  the numbers.

## Suggested experiments

1. **Single-interface ceiling.** Run `create`, `buy` and `buy-split` with `--interfaces 1`,
   stepping the rate up until `ok_tps_checkpoint_median_sec` flattens and `congested` or
   latency climbs.
2. **Sharding.** Repeat the saturating rate with `--interfaces` set to 1, 2, 4 and 8 in separate runs
   (needs at least that many provisioned). If throughput scales roughly linearly, the per-object limit is the bottleneck.
3. **Batching.** Vary `--batch 1,5,10,20` at a fixed tx/s and compare ops/s. Sui's congestion
   control charges per transaction against a per-object budget
   (`max_accumulated_txn_cost_per_object_in_mysticeti_commit` in `meta.json`). How a
   transaction's cost is estimated depends on the protocol's congestion-control mode, so check
   the config before attributing the effect.

## Caveats

- **Restart localnet before a measurement session.** A long-running localnet degrades: after
  ~3 h on a 4-core / 8 GB machine it used ~5 GB RAM and 200 % CPU while idle, and p50 latency
  at 100 tx/s grew from ~0.2 s to ~30 s.
- **Checkpoint lookups run after each step.** The fullnode indexes transactions a few seconds
  after returning their effects (much longer under load) and prunes old ones. Lookups are
  polled for `--checkpoint-timeout` seconds (default 120) per step.
- **Localnet** is a single machine running all validators, so absolute numbers are
  optimistic and noisy (occasional ~1–2 s stalls). Repeat runs, report medians, and ideally
  confirm the ceiling on testnet. Setup there needs manual funding: it prints the address
  when the faucet refuses.
- **Buyer and seller are the same address**, and lanes share one sender address. Neither
  affects object locking.
- **The prepare phase can be congestion-cancelled itself.** It creates large PTBs on the
  shared interface, so it retries with backoff.
