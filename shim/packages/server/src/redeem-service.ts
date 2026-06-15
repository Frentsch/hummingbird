import { createClient } from '@connectrpc/connect';
import { createGrpcTransport } from '@connectrpc/connect-node';
import { RedemptionService } from './rpc/gen/hummingbird/v1/redemption_connect.js';
import {
  RedeemAssetFromASResponse,
  RedeemAssetFromASRequest,
  ReservationInfo,
} from './rpc/gen/hummingbird/v1/redemption_pb.js';

export async function startRedeemService(grpcPort: number): Promise<void> {
  const transport = createGrpcTransport({
    baseUrl: `http://localhost:${grpcPort}`,
    httpVersion: '2',
  });
  const client = createClient(RedemptionService, transport);

  let resId = BigInt(0);
  // Delivers each incoming request into the outgoing generator so it can reply immediately.
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
        resInfo: new ReservationInfo({
          resId: resId++,
          bwRounded: BigInt(1),
          bwDataplaneEncoding: 0xff,
        }),
        ak: 'plaintext-ak',
        requestId: req.requestId,
      });
    }
  }

  // Cast needed: Client<T> conditional-type inference widens the bidi method to
  // Promise<unknown> when the transport is unresolved. See redeem-service comments.
  const redeemBiDi = client.redeemASAsset as unknown as (
    req: AsyncIterable<RedeemAssetFromASResponse>
  ) => AsyncIterable<RedeemAssetFromASRequest>;

  try {
    for await (const req of redeemBiDi(outgoing())) {
      console.log(`[RedeemService] handling request ${req.requestId}`);
      // Cast needed: TypeScript narrows deliverRequest to null because the async-generator
      // assignment isn't visible to the outer control-flow graph. Using typeof would
      // evaluate the already-narrowed type; cast to the full declared type instead.
      (deliverRequest as ((req: RedeemAssetFromASRequest | null) => void) | null)?.(req);
    }
  } finally {
    (deliverRequest as ((req: RedeemAssetFromASRequest | null) => void) | null)?.(null);
  }
}
