import { ConnectError, type ServiceImpl } from '@connectrpc/connect';
import type { RedemptionService as IRedemptionService } from '../gen/hummingbird/v1/redemption_connect.js';
import { RedeemAssetFromASRequest } from '../gen/hummingbird/v1/redemption_pb.js';
import { buildDeliverReservation, executeTransaction } from '@sui-shim/core';
import { StatementSync } from 'node:sqlite';
import type { AppState } from '../../state.js';
import { BigIntToUID } from '../helpers.js';

// The RedemptionService.RedeemASAsset bidi stream:
//   client sends RedeemAssetFromASResponse (reservation answers from the AS)
//   server sends RedeemAssetFromASRequest (redemption requests pushed from chain events)
//
// In practice the server-side push comes from the event listener. The pending request
// queue is a module-level Map so the event listener can enqueue work.
export const pendingRedeemRequests = new Map<bigint, (req: RedeemAssetFromASRequest) => void>();

export function createRedemptionServiceImpl(state: AppState): Partial<ServiceImpl<typeof IRedemptionService>> {
  return { async *redeemASAsset(stream, _ctx) {
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
          console.log("redemption key received from AS");
          if(!_msg.ak || !_msg.requestId) continue;
          console.log(_msg);
          if(!state.pendingRedemptions.has(BigInt(_msg.requestId))) continue;
          console.log("matches pending redemption");
          if(!_msg.resInfo) throw new ConnectError("Must Provide reservation Information (resId, bwRounded, bwDataplaneEncoding)");
          const redeemRequestId = state.pendingRedemptions.get(BigInt(_msg.requestId))!;
          console.log(redeemRequestId);

          // AS acknowledges each request with matching request_id and authentication key. Send delivery transaction on-chain
          const tx = buildDeliverReservation({packageId: state.packageId, redeemRequestId, encryptedReservation: new TextEncoder().encode( _msg.ak), resId: _msg.resInfo!.resId, bwRounded: _msg.resInfo!.bwRounded, bwDataplaneEncoding: _msg.resInfo!.bwDataplaneEncoding});
          const result = await executeTransaction(
                  state.client as Parameters<typeof executeTransaction>[0],
                  state.signer,
                  tx,
          );
          console.log(result);
        }
      })();

      // Send queued requests as they arrive
      while (!_ctx.signal.aborted) {
        if (sessionQueue.length === 0) {
          console.log("send redeem request to AS")
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
}
};
