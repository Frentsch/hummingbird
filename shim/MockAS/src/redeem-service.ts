import { createClient } from '@connectrpc/connect';
import { createGrpcTransport } from '@connectrpc/connect-node';
import { RedemptionService } from './gen/hummingbird/v1/redemption_connect.js';
import {
  RedeemAssetFromASResponse,
  RedeemAssetFromASRequest,
  ReservationInfo,
} from './gen/hummingbird/v1/redemption_pb.js';

const MAX_BACKOFF_MS = 60_000;

export async function startRedeemService(grpcPort: number): Promise<void> {
  let backoffMs = 0;
  while (true) {
    const connectedAt = Date.now();
    try {
      await connectRedeemService(grpcPort);
    } catch (err) {
      console.error('[RedeemService] connection error:', err);
    }
    backoffMs = Date.now() - connectedAt > MAX_BACKOFF_MS ? 0 : Math.min(backoffMs === 0 ? 1000 : backoffMs * 2, MAX_BACKOFF_MS);
    console.log(`[RedeemService] disconnected, reconnecting in ${backoffMs}ms`);
    if (backoffMs > 0) {
      await new Promise(resolve => setTimeout(resolve, backoffMs));
    }
  }
}

async function connectRedeemService(grpcPort: number): Promise<void> {
  const transport = createGrpcTransport({
    baseUrl: `http://localhost:${grpcPort}`,
    httpVersion: '2',
  });
  const client = createClient(RedemptionService, transport);

  let resId = 0;
  let deliverRequest: ((req: RedeemAssetFromASRequest | null) => void) | null = null;

  async function* outgoing(): AsyncIterable<RedeemAssetFromASResponse> {
    yield new RedeemAssetFromASResponse({});
    while (true) {
      const req = await new Promise<RedeemAssetFromASRequest | null>(resolve => {
        deliverRequest = resolve;
      });
      if (req === null) return;
      console.log(`[RedeemService] sending response for ${req.requestId}`)
      yield new RedeemAssetFromASResponse({
        requestId: req.requestId,
        result: {
          case: "resInfo",
          value: new ReservationInfo({
          reservationId: resId++,
          bandwithRounded: req.bandwidth,
          bwDataplaneEncoding: 0xff,
          authenticationKey: new TextEncoder().encode('plaintext-ak'),
          })
      }
    });
    }
  }

  const redeemBiDi = client.redeemASAsset as unknown as (
    req: AsyncIterable<RedeemAssetFromASResponse>
  ) => AsyncIterable<RedeemAssetFromASRequest>;

  try {
    for await (const req of redeemBiDi(outgoing())) {
      console.log(`[RedeemService] handling request ${req.requestId}`);
      (deliverRequest as ((req: RedeemAssetFromASRequest | null) => void) | null)?.(req);
    }
  } finally {
    (deliverRequest as ((req: RedeemAssetFromASRequest | null) => void) | null)?.(null);
  }
}
