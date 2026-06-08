import type { ServiceImpl } from '@connectrpc/connect';
import type { RedemptionService as IRedemptionService } from '../gen/hummingbird/v1/redemption_connect.js';
import { RedeemAssetFromASRequest } from '../gen/hummingbird/v1/redemption_pb.js';

// The RedemptionService.RedeemASAsset bidi stream:
//   client sends RedeemAssetFromASResponse (reservation answers from the AS)
//   server sends RedeemAssetFromASRequest (redemption requests pushed from chain events)
//
// In practice the server-side push comes from the event listener. The pending request
// queue is a module-level Map so the event listener can enqueue work.
export const pendingRedeemRequests = new Map<bigint, (req: RedeemAssetFromASRequest) => void>();

export const redemptionServiceImpl: Partial<ServiceImpl<typeof IRedemptionService>> = {
  async *redeemASAsset(stream, _ctx) {
    // Register this AS session so the event listener can push requests to it.
    const sessionQueue: RedeemAssetFromASRequest[] = [];
    let resolver: (() => void) | null = null;

    const enqueue = (req: RedeemAssetFromASRequest) => {
      sessionQueue.push(req);
      resolver?.();
      resolver = null;
    };
    const sessionId = BigInt(Date.now());
    pendingRedeemRequests.set(sessionId, enqueue);

    try {
      // Drive both directions concurrently via async iteration
      const incoming = (async () => {
        for await (const _msg of stream) {
          // AS acknowledges each request with matching request_id — no further action needed
        }
      })();

      // Send queued requests as they arrive
      while (!_ctx.signal.aborted) {
        if (sessionQueue.length === 0) {
          await new Promise<void>((resolve, reject) => {
            resolver = resolve;
            _ctx.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
          }).catch(() => null);
        }
        const req = sessionQueue.shift();
        if (req) yield req;
      }

      await incoming;
    } finally {
      pendingRedeemRequests.delete(sessionId);
    }
  },
};
