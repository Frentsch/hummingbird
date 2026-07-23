import { Code, ConnectError, type ServiceImpl } from '@connectrpc/connect';
import type { RedemptionService as IRedemptionService } from '../gen/hummingbird/v1/redemption_connect.js';
import { RedeemAssetFromASRequest } from '../gen/hummingbird/v1/redemption_pb.js';
import { buildDeliverReservation, executeTransaction, sealToPublicKey } from '@sui-shim/core';
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
          const publicKey = state.pendingRedemptionKeys.get(BigInt(_msg.requestId));
          if (!publicKey) { 
            //This should in theory not happen since each response is triggered by a request, but in practice an AS could crash and resend a reservation.
            console.error(`No public key on file for request ${_msg.requestId}`);
            state.pendingRedemptions.delete(BigInt(_msg.requestId));
            state.pendingRedemptionKeys.delete(BigInt(_msg.requestId));
            continue;
          }
          const encryptedReservation = await sealToPublicKey(publicKey, new TextEncoder().encode(_msg.ak));
          
          const tx = buildDeliverReservation({packageId: state.packageId, redeemRequestId, encryptedReservation, resId: _msg.resInfo!.resId, bwRounded: _msg.resInfo!.bwRounded, bwDataplaneEncoding: _msg.resInfo!.bwDataplaneEncoding});
          const result = await executeTransaction(
                  state.client as Parameters<typeof executeTransaction>[0],
                  state.signer,
                  tx,
          );
          console.log(result);
          state.pendingRedemptions.delete(BigInt(_msg.requestId));
          state.pendingRedemptionKeys.delete(BigInt(_msg.requestId));
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
}
};
