import type { SuiJsonRpcClient } from './sui-client.js';

export interface RedeemEvent {
  txDigest: string;
  eventSeq: string;
  ingressAssetId: string;
  egressAssetId: string;
  publicKey: Uint8Array;
  requestId: bigint;
}

export type RedeemEventHandler = (event: RedeemEvent) => void;

interface EventId {
  txDigest: string;
  eventSeq: string;
}

const POLL_INTERVAL_MS = 2_000;
const MAX_BACKOFF_MS = 60_000;

export class EventListener {
  readonly #client: SuiJsonRpcClient;
  readonly #onRedeem: RedeemEventHandler;
  readonly #redeemEventType: string;
  #cursor: EventId | null = null;
  #stopped = false;
  #backoff = POLL_INTERVAL_MS;

  constructor(client: SuiJsonRpcClient, packageId: string, onRedeem: RedeemEventHandler) {
    this.#client = client;
    this.#onRedeem = onRedeem;
    this.#redeemEventType = `${packageId}::hummingbird_asset::RedeemRequest`;
  }

  start(): void {
    void this.#pollLoop();
  }

  stop(): void {
    this.#stopped = true;
  }

  async #pollLoop(): Promise<void> {
    while (!this.#stopped) {
      try {
        await this.#poll();
        this.#backoff = POLL_INTERVAL_MS;
      } catch (err) {
        console.error('[EventListener] poll error:', err);
        this.#backoff = Math.min(this.#backoff * 2, MAX_BACKOFF_MS);
      }
      await sleep(this.#backoff);
    }
  }

  async #poll(): Promise<void> {
    const page = await this.#client.queryEvents({
      query: { MoveEventType: this.#redeemEventType },
      cursor: this.#cursor ?? undefined,
      limit: 50,
      order: 'ascending',
    });

    for (const raw of page.data) {
      const ev = raw as {
        id: EventId;
        parsedJson?: {
          ingress_asset_id?: string;
          egress_asset_id?: string;
          public_key?: number[];
          request_id?: string;
        };
      };
      const json = ev.parsedJson ?? {};
      this.#onRedeem({
        txDigest: ev.id.txDigest,
        eventSeq: ev.id.eventSeq,
        ingressAssetId: json.ingress_asset_id ?? '0x0',
        egressAssetId: json.egress_asset_id ?? '0x0',
        publicKey: new Uint8Array(json.public_key ?? []),
        requestId: BigInt(json.request_id ?? '0'),
      });
    }

    if (page.nextCursor) {
      this.#cursor = page.nextCursor as EventId;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
