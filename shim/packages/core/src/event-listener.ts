import { bcs } from '@mysten/sui/bcs';
import type { SuiJsonRpcClient } from './sui-client.js';
import type { SuiGrpcClient } from './sui-client.js';

export interface RedeemEvent {
  txDigest: string;
  eventSeq: string;
  /** Low 8 bytes of the RedeemRequest object ID as uint64, for proto correlation. */
  requestId: bigint;
  /** Full hex object ID of the RedeemRequest, for DeliveryListener correlation. */
  requestObjectId: string;
  /** interface_id of the ingress HummingbirdAsset as hex string. */
  ingressAssetId: string;
  /** interface_id of the egress HummingbirdAsset as hex string. */
  egressAssetId: string;
  publicKey: Uint8Array;
  buyer: string;
  bandwidth: bigint;
  startTime: bigint;
  expTime: bigint;
}

export type RedeemEventHandler = (event: RedeemEvent) => void;

interface EventCursor { txDigest: string; eventSeq: string }

// BCS layout of RedeemRequestReceived { redeem_request_id: ID, issuer: address }
const RedeemRequestReceivedBCS = bcs.struct('RedeemRequestReceived', {
  redeem_request_id: bcs.Address,
  issuer: bcs.Address,
});

const RECONNECT_INITIAL_MS = 2_000;
const RECONNECT_MAX_MS = 30_000;

export class EventListener {
  readonly #jsonRpc: SuiJsonRpcClient;
  readonly #grpc: SuiGrpcClient;
  readonly #myAddress: string;
  readonly #onRedeem: RedeemEventHandler;
  readonly #eventType: string;
  #cursor: EventCursor | null = null;
  #stopped = false;

  constructor(
    jsonRpcClient: SuiJsonRpcClient,
    grpcClient: SuiGrpcClient,
    packageId: string,
    myAddress: string,
    onRedeem: RedeemEventHandler,
  ) {
    this.#jsonRpc = jsonRpcClient;
    this.#grpc = grpcClient;
    this.#myAddress = myAddress.toLowerCase();
    this.#onRedeem = onRedeem;
    this.#eventType = `${packageId}::hummingbird_asset::RedeemRequestReceived`;
  }

  start(): void {
    void this.#mainLoop();
  }

  stop(): void {
    this.#stopped = true;
  }

  // ----- catch-up (JSON RPC) -----------------------------------------------

  async #catchUp(): Promise<void> {
    for (;;) {
      const page = await this.#jsonRpc.queryEvents({
        query: { MoveEventType: this.#eventType },
        cursor: this.#cursor ?? undefined,
        limit: 50,
        order: 'ascending',
      });

      for (const raw of page.data) {
        const ev = raw as {
          id: EventCursor;
          parsedJson?: { redeem_request_id?: string; issuer?: string };
        };
        const json = ev.parsedJson ?? {};
        if ((json.issuer ?? '').toLowerCase() !== this.#myAddress) continue;
        if (!json.redeem_request_id) continue;
        await this.#processRequest(
          ev.id.txDigest,
          ev.id.eventSeq,
          json.redeem_request_id,
        );
      }

      if (page.nextCursor) {
        this.#cursor = page.nextCursor as EventCursor;
      }
      if (!page.hasNextPage) break;
    }
  }

  // ----- gRPC real-time subscription ----------------------------------------

  async #subscribe(): Promise<void> {
    const stream = this.#grpc.subscriptionService.subscribeCheckpoints({
      readMask: { paths: ['transactions'] },
    });

    for await (const response of stream.responses) {
      if (this.#stopped) return;
      const checkpoint = response.checkpoint;
      if (!checkpoint) continue;

      for (const tx of checkpoint.transactions) {
        const events = tx.events?.events ?? [];
        for (let i = 0; i < events.length; i++) {
          const event = events[i]!;
          if (event.eventType !== this.#eventType) continue;
          console.log(event.contents);
          if (!event.contents?.value) continue;

          let decoded: { redeem_request_id: string; issuer: string };
          try {
            decoded = RedeemRequestReceivedBCS.parse(event.contents.value);
          } catch (err) {
            console.error('[EventListener] BCS decode error:', err);
            continue;
          }

          console.log(decoded);
          if (decoded.issuer.toLowerCase() !== this.#myAddress) continue;

          const txDigest = tx.digest ?? '';
          const eventSeq = String(i);
          try {
            await this.#processRequest(txDigest, eventSeq, decoded.redeem_request_id);
          } catch (err) {
            console.error(`[EventListener] Failed to process event in tx ${txDigest}:`, err);
          }
        }
      }
    }
  }

  // ----- shared: fetch RedeemRequest object and call onRedeem ---------------

  async #processRequest(
    txDigest: string,
    eventSeq: string,
    redeemRequestObjectId: string,
  ): Promise<void> {
    console.log("process redemption");
    const obj = await this.#jsonRpc.getObject({
      id: redeemRequestObjectId,
      options: { showContent: true },
    });
    console.log(obj);
    if (!obj.data?.content || obj.data.content.dataType !== 'moveObject') {
      console.warn(`[EventListener] RedeemRequest ${redeemRequestObjectId} not found or wrong type`);
      return;
    }

    const fields = (obj.data.content as { dataType: 'moveObject'; fields: Record<string, any> }).fields;
    const ingressFields = (fields['ingress_asset'] as { fields: Record<string, any> }).fields;
    const egressFields  = (fields['egress_asset']  as { fields: Record<string, any> }).fields;

    // Derive a uint64 request correlator from the low 8 bytes of the object ID
    const hex = redeemRequestObjectId.replace(/^0x/, '');
    const requestId = BigInt('0x' + hex.slice(-16));

    this.#cursor = { txDigest, eventSeq };

    this.#onRedeem({
      txDigest,
      eventSeq,
      requestId,
      requestObjectId: redeemRequestObjectId,
      ingressAssetId: (ingressFields['interface_id'] as number).toString(16),
      egressAssetId:  (egressFields['interface_id']  as number).toString(16),
      publicKey: new Uint8Array(fields['public_key'] as number[]),
      buyer: fields['buyer'] as string,
      bandwidth: BigInt(ingressFields['bandwidth'] as string),
      startTime: BigInt(ingressFields['start_time'] as string),
      expTime:   BigInt(ingressFields['exp_time']   as string),
    });
  }

  // ----- main loop ----------------------------------------------------------

  async #mainLoop(): Promise<void> {
    let backoff = RECONNECT_INITIAL_MS;
    while (!this.#stopped) {
      // Phase 1: catch up on missed events since last cursor
      try {
        await this.#catchUp();
      } catch (err) {
        console.error('[EventListener] catch-up error:', err);
      }

      // Phase 2: stream new events in real time
      try {
        console.log('[EventListener] Connecting to gRPC subscription');
        await this.#subscribe();
        backoff = RECONNECT_INITIAL_MS;
      } catch (err) {
        if (this.#stopped) return;
        console.error(`[EventListener] gRPC stream error, reconnecting in ${backoff}ms:`, err);
        await sleep(backoff);
        backoff = Math.min(backoff * 2, RECONNECT_MAX_MS);
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
