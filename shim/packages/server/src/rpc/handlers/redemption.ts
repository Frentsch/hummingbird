import { ConnectError, type ServiceImpl } from '@connectrpc/connect';
import type { RedemptionService as IRedemptionService } from '../gen/hummingbird/v1/redemption_connect.js';
import { RedeemAssetFromASRequest } from '../gen/hummingbird/v1/redemption_pb.js';
import { buildDeliverReservation, executeTransaction, sealToPublicKey } from '@sui-shim/core';
import type { AppState } from '../../state.js';

// The RedemptionService.RedeemASAsset bidi stream:
//   client sends RedeemAssetFromASResponse (reservation answers from the AS)
//   server sends RedeemAssetFromASRequest (redemption requests pushed from chain events)
//
// In practice the server-side push comes from the event listener, which calls
// pushRedeemRequest. Only one AS is ever connected at a time, so a single slot
// (rather than a keyed map) is enough to track the active session's push function.
let activeSession: ((req: RedeemAssetFromASRequest) => void) | null = null;

export function pushRedeemRequest(req: RedeemAssetFromASRequest): void {
  activeSession?.(req);
}

// How often the send loop wakes up (even without new work) to check for requests
// that have been outstanding too long and need a resend.
const RESEND_CHECK_INTERVAL_MS = 10_000;
// Resend a request once it's been outstanding this long without a matching response.
const RESEND_TIMEOUT_MS = 30_000;

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
    activeSession = enqueue;

    // Flush anything still outstanding immediately, rather than waiting for the
    // send loop's next periodic wake-up — covers the AS reconnecting after a drop.
    for (const pending of state.pendingRedemptions.values()) {
      enqueue(pending.req);
      pending.lastSentAt = Date.now();
    }

    try {
      // Drive both directions concurrently via async iteration
      const incoming = (async () => {
        for await (const _msg of stream) {
          console.log("redemption key received from AS");
          console.log(_msg);
          if(!_msg.requestId) continue; // only the initiating response should be empty and ignored
          const pending = state.pendingRedemptions.get(BigInt(_msg.requestId));
          if(!pending) continue;
          console.log("matches pending redemption");
          if (_msg.result.case === "error"){
            //TODO inform buyer about error through chain
            console.log(_msg.result.value)
          }else{
            if(!_msg.result.value) throw new ConnectError("Must Provide reservation Information (resId, bwRounded, bwDataplaneEncoding)");
            const resInfo = _msg.result.value
            console.log(pending.requestObjectId);
            const encryptedReservation = await sealToPublicKey(pending.publicKey, resInfo.authenticationKey);

            const tx = buildDeliverReservation({packageId: state.config.sui.packageId, redeemRequestId: pending.requestObjectId, encryptedReservation, resId: BigInt(resInfo.reservationId), bwRounded: BigInt(resInfo.bandwithRounded), bwDataplaneEncoding: resInfo.bwDataplaneEncoding});
            const result = await executeTransaction(
                    state.client as Parameters<typeof executeTransaction>[0],
                    state.asSigner,
                    tx,
            );
            console.log("delivered reservation")
            console.log(result);
          }
          
          state.pendingRedemptions.delete(BigInt(_msg.requestId));
        }
      })();

      // Send queued requests as they arrive, waking periodically even when idle to
      // resend anything that's been outstanding too long (dropped request/response,
      // or the AS connection having been down when it was first sent).
      while (!_ctx.signal.aborted) {
        if (sessionQueue.length === 0) {
          await new Promise<void>((resolve, reject) => {
            const onAbort = () => { clearTimeout(timer); reject(new Error('aborted')); };
            const timer = setTimeout(() => { _ctx.signal.removeEventListener('abort', onAbort); resolve(); }, RESEND_CHECK_INTERVAL_MS);
            resolver = () => { clearTimeout(timer); _ctx.signal.removeEventListener('abort', onAbort); resolve(); };
            _ctx.signal.addEventListener('abort', onAbort, { once: true });
          }).catch(() => null);
        }

        const now = Date.now();
        for (const pending of state.pendingRedemptions.values()) {
          if (now - pending.lastSentAt < RESEND_TIMEOUT_MS) continue;
          console.log(`Resending redemption request ${pending.req.requestId}`);
          sessionQueue.push(pending.req);
          pending.lastSentAt = now;
        }

        const req = sessionQueue.shift();
        if (req) yield req;
      }

      await incoming;
    } finally {
      // Don't clobber a newer session that may have already taken over this slot.
      if (activeSession === enqueue) activeSession = null;
    }
  },
}
};
