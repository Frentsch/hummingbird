# AGENTS.md: throughput benchmark notes

Findings and pitfalls from the first measurement sessions (2026-09-27/28), for picking this
up again on another machine. See `README.md` for usage and the output columns.

## Goal

Measure how many `create_listing` / `buy` transactions per second one shared
`registry::Interface` can handle. Every call takes `&mut Interface`, because it mutates the
`listings: ObjectBag`. Then compare against spreading load over several interfaces
(`--interfaces`) and batching several calls per PTB (`--batch`).

## Status

- Harness works for all three workloads (`create`, `buy`, `buy-split`) on localnet.
- **No valid ceiling measured yet.** The first machine (WSL2, 4 cores, 8 GB RAM) saturated
  before the chain's per-object congestion limit did.

## Measurements so far (localnet, first machine)

These are only indicative: one machine, few repetitions, 60 s epochs.

| run (results/…) | lanes | ifaces | target tx/s → ok tx/s | notes |
|---|---|---|---|---|
| `07-06_create_if1_l64` | 64 | 1 | 10/25/50 → clean; 100 → 70; 150 → 150 | 100 tx/s step hit an epoch-change stall (see below) |
| `07-31_buy_if1_l64` | 64 | 1 | 250 → 212, 350 → 222 | clean, p95 ~330 ms; capped by 64 lanes (≈ lanes / latency) |
| `09-41_create_if1_l512` | 512 | 1 | 350 → 37 | overload collapse: latency 2 s → 40 s, 354 congestion-cancelled |
| `10-13_buy_if1_l512` | 512 | 1 | 150/250/350 → 68/77/51 | p95 20–30 s, **0 congestion cancellations** |
| `10-19_buy_if8_l512` | 512 | 8 | 150/250/350 → ~100 each | p95 16–22 s, **0 congestion cancellations** |

Interpretation:

- **8 interfaces didn't help, and nothing was congestion-cancelled.** The machine was the
  bottleneck, not the per-object limit on `Interface`. The 512-lane runs after ~09:40 were
  also on a localnet that had been running ~3 h and had degraded (see pitfalls). Treat them
  as unreliable.
- **Best clean data point:** the fresh localnet sustained ≥ 150–220 tx/s on a single
  interface with sub-second latency.
- **Congestion cancellations do happen on one interface.** They occur in *bursts* after a
  stall, when backlogged transactions hit the same consensus commit. They also occur with
  large batched PTBs: at `--batch 20` and 40 tx/s, 44 were cancelled.
- **Congestion config on localnet protocol v113** (recorded in each run's `meta.json`):
  `max_accumulated_txn_cost_per_object_in_mysticeti_commit = 37000000`,
  `max_deferral_rounds_for_congestion_control = 10`.

## Pitfalls found (and how the code handles them)

1. **Auto gas selection eats lane gas coins.** Any transaction from the benchmark address
   without an explicit `setGasPayment` may merge lane coins into its gas payment, deleting
   them. `run.ts` then fails with `lane N: object … missing`.
   - `setup.ts` merges all coins first and pays explicitly.
   - `run.ts` always pays with the lane's own coin.
   - **Never run ad-hoc scripts with the benchmark keypair** without explicit gas payment.
     If it happens, rerun setup or split new coins for the affected lanes.
2. **Gas-payment coin limit.** A transaction accepts at most 256 gas payment coins. Setup
   uses at most 200.
3. **Epoch changes stall the network ~3 s.** Localnet epochs default to 60 s. A stall
   mid-step blocks every lane, which shows as `skipped_no_free_lane`, followed by a
   congestion burst. Start localnet with `--epoch-duration-ms 3600000`.
4. **Overload collapse is open-loop behaviour.** Above capacity, latency grows to tens of
   seconds and all lanes block, so most sends are skipped. Many skips at a high rate mean
   "past capacity" (chain *or* machine), not "too few lanes". Check `lat_p95_ms` and the
   `congested` column to tell which.
5. **Checkpoint lookup.** The fullnode indexes a transaction ~4 s after returning its effects
   (much longer under load) and prunes old transactions after a few epochs. `run.ts` looks
   up checkpoints right after each step, polling in rounds for up to `--checkpoint-timeout`
   seconds. Don't move this back to the end of the run.
6. **`rpc_error` "already executed".** The response timed out but the transaction ran. The
   harness waits up to 60 s for it before resyncing the lane.
7. **Long-running localnet degrades.** After ~3 h: ~5 GB RAM, 200 % CPU idle, p50 at
   100 tx/s ~30 s. Restart (`--force-regenesis`) before every measurement session, then
   `rm state.json && npm run setup`.

## Next steps (on the new machine)

1. **Fresh localnet** with a long epoch. Record the machine's cores and RAM next to the
   results.
2. **Find the single-interface ceiling.** Run `create`, `buy` and `buy-split`,
   `--interfaces 1`, stepping the rate until `congested` becomes non-zero *while latency is
   still low*. That marks the object limit rather than machine overload.
3. **Sharding.** At that rate, run with `--interfaces` 2, 4 and 8. Congestion should vanish
   and throughput should scale if the object limit was the bottleneck.
4. **Batching.** `--batch` 1, 5, 10, 20 at a fixed tx/s; compare ops/s and cancellations.
5. **Optional.** Confirm on testnet (needs manual funding; setup prints the address), or
   run the load generator on a separate machine from the network.
