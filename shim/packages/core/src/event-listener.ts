import { bcs } from '@mysten/sui/bcs';
import type { SuiGraphQLClient } from './sui-client.js';
import type { SuiGrpcClient } from './sui-client.js';

export interface RedeemEvent {
  txDigest: string;
  eventSeq: string;
  requestId: bigint;
  requestObjectId: string;
  ingressAssetId: string;
  egressAssetId: string;
  publicKey: Uint8Array;
  buyer: string;
  bandwidth: number;
  startTime: bigint;
  expTime: bigint;
}

export type RedeemEventHandler = (event: RedeemEvent) => void;

// BCS layout of RedeemRequestReceived { redeem_request_id: ID, issuer: address }
const RedeemRequestReceivedBCS = bcs.struct('RedeemRequestReceived', {
  redeem_request_id: bcs.Address,
  issuer: bcs.Address,
});

const RECONNECT_INITIAL_MS = 2_000;
const RECONNECT_MAX_MS = 30_000;

// GraphQL query for paginating past events by Move event type.
const EVENTS_QUERY = `
  query EventCatchUp($eventType: String!, $cursor: String, $limit: Int) {
    events(filter: { type: $eventType }, first: $limit, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        contents { json }
        sequenceNumber
        transaction { digest }
      }
    }
  }
`;

export class EventListener {
  readonly #graphql: SuiGraphQLClient;
  readonly #grpc: SuiGrpcClient;
  readonly #myAddress: string;
  readonly #onRedeem: RedeemEventHandler;
  readonly #eventType: string;
  //TODO persist the cursor so that old events don't get looked at again. 
  // This shouldn't be causing any issues because processed reservations 
  // release the ReservationReqeust object, so they are only processed once, 
  // but it could become a large overhead.
  #cursor: string | null = null;
  #stopped = false;

  constructor(
    graphqlClient: SuiGraphQLClient,
    grpcClient: SuiGrpcClient,
    packageId: string,
    myAddress: string,
    onRedeem: RedeemEventHandler,
  ) {
    this.#graphql = graphqlClient;
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

  // ----- catch-up (GraphQL) ------------------------------------------------

  async #catchUp(): Promise<void> {
    for (;;) {
      const res = await this.#graphql.query({
        query: EVENTS_QUERY,
        variables: {
          eventType: this.#eventType,
          cursor: this.#cursor ?? null,
          limit: 50,
        },
      });

      const events = (res as any)?.data?.events;
      if (!events) break;

      for (const node of events.nodes as any[]) {
        const json = node.contents?.json ?? {};
        if ((json.issuer ?? '').toLowerCase() !== this.#myAddress) continue;
        if (!json.redeem_request_id) continue;
        this.#processRequest(
          node.transaction?.digest ?? '',
          String(node.sequenceNumber),
          json.redeem_request_id as string,
        );
      }

      if (events.pageInfo?.endCursor) {
        this.#cursor = events.pageInfo.endCursor as string;
      }
      if (!events.pageInfo?.hasNextPage) break;
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
            this.#processRequest(txDigest, eventSeq, decoded.redeem_request_id);
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
    console.log(redeemRequestObjectId);

    // The GraphQL indexer lags behind the gRPC checkpoint stream. Retry until
    // the object appears, to handle the window between chain commit and indexing.
    let json: Record<string, unknown> | null = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      if (attempt > 0) await sleep(1_000 * attempt);
      try{
        const obj = await this.#graphql.getObject({
          objectId: redeemRequestObjectId,
          include: { json: true },
        });
        if (obj.object.json) { json = obj.object.json; break; }
      }catch{
        console.warn(`[EventListener] RedeemRequest ${redeemRequestObjectId} not yet indexed (attempt ${attempt + 1})`);
      }
    }
    if (!json) {
      console.warn(`[EventListener] RedeemRequest ${redeemRequestObjectId} not found after retries`);
      return;
    }

    const assetFields = json['ingress_egress_asset'] as Record<string, unknown>;

    const pkRaw = json['public_key'];
    const publicKey = typeof pkRaw === 'string'
      ? Uint8Array.from(Buffer.from(pkRaw, 'base64'))
      : new Uint8Array(pkRaw as number[]);

    // Derive a uint64 request correlator from the low 8 bytes of the object ID
    const hex = redeemRequestObjectId.replace(/^0x/, '');
    const requestId = BigInt('0x' + hex.slice(-16));

    this.#onRedeem({
      txDigest,
      eventSeq,
      requestId,
      requestObjectId: redeemRequestObjectId,
      ingressAssetId: Number(assetFields['if_ingress_id']).toString(16),
      egressAssetId:  Number(assetFields['if_egress_id']).toString(16),
      publicKey,
      buyer: json['buyer'] as string,
      bandwidth: Number(assetFields['bandwidth'] as string),
      startTime: BigInt(assetFields['start_time'] as string),
      expTime:   BigInt(assetFields['exp_time']   as string),
    });
  }

  // ----- main loop ----------------------------------------------------------

  async #mainLoop(): Promise<void> {
    let backoff = RECONNECT_INITIAL_MS;
    while (!this.#stopped) {
      // catch up on missed events since last cursor
      try {
        await this.#catchUp();
      } catch (err) {
        console.error('[EventListener] catch-up error:', err);
      }

      // stream new events in real time
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
