import { bcs } from '@mysten/sui/bcs';
import type { SuiGrpcClient } from './sui-client.js';

export interface DeliveryResult {
  encryptedReservation: Uint8Array;
  resId: bigint,
  bwRounded: bigint,
  bwDataplaneEncoding: number,
}

export class DeliveryTimeoutError extends Error {
  constructor() {
    super('Timed out waiting for ReservationDelivered');
    this.name = 'DeliveryTimeoutError';
  }
}

// BCS layout of ReservationDelivered { isd_as_id: u64, public_key: vector<u8>, encrypted_reservation: vector<u8> }
const ReservationDeliveredBCS = bcs.struct('ReservationDelivered', {
  isd_as_id: bcs.u64(),
  redeem_request_id: bcs.Address,
  public_key: bcs.vector(bcs.u8()),
  encrypted_reservation: bcs.vector(bcs.u8()),
  res_id: bcs.u64().transform({ input: (v: bigint) => v, output: (v) => BigInt(v) }), //per default bcs parses u64 to strings
  bw_rounded: bcs.u64().transform({ input: (v: bigint) => v, output: (v) => BigInt(v) }),
  bw_dataplane_encoding: bcs.u16(),
});

// ChangedObject_IdOperation.DELETED = 3 (from @mysten/sui grpc proto enum)
const DELETED = 3;

export class DeliveryListener {
  readonly #grpc: SuiGrpcClient;

  constructor(grpcClient: SuiGrpcClient) {
    this.#grpc = grpcClient;
  }

  /**
   * Watch checkpoints until a ReservationDelivered event appears in a transaction
   * that also deletes redeemRequestObjectId (proving it is the matching delivery).
   * Rejects with DeliveryTimeoutError on timeout.
   */
  async waitForDelivery(
    redeemRequestObjectId: string,
    packageId: string,
    timeoutMs: number,
  ): Promise<DeliveryResult> {
    const deliveryEventType = `${packageId}::hummingbird_asset::ReservationDelivered`;
    const normalizedId = redeemRequestObjectId.toLowerCase();

    return new Promise<DeliveryResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new DeliveryTimeoutError());
      }, timeoutMs);

      const stream = this.#grpc.subscriptionService.subscribeCheckpoints({
        // Include both events and effects so we can check object deletions
        readMask: { paths: ['transactions.events', 'transactions.effects'] },
      });

      (async () => {
        try {
          for await (const response of stream.responses) {
            const checkpoint = response.checkpoint;
            if (!checkpoint) continue;

            for (const tx of checkpoint.transactions) {
              /*
              // Confirm this tx deletes the expected RedeemRequest object
              const deletesRequest = (tx.effects?.changedObjects ?? []).some(
                (c: { idOperation?: number; objectId?: string }) =>
                  c.idOperation === DELETED &&
                  (c.objectId ?? '').toLowerCase() === normalizedId,
              );
              if (!deletesRequest) continue;*/

              // Find the matching ReservationDelivered event in the same tx
              for (const event of tx.events?.events ?? []) {
                if (event.eventType !== deliveryEventType) continue;
                if (!event.contents?.value) continue;
                
                let decoded: { redeem_request_id: string; encrypted_reservation: number[]; res_id: bigint, bw_rounded: bigint; bw_dataplane_encoding: number };
                try {
                  const fullDecode = ReservationDeliveredBCS.parse(event.contents.value);
                  console.log(fullDecode);
                  decoded = ReservationDeliveredBCS.parse(event.contents.value);
                } catch (err) {
                  console.error('[DeliveryListener] BCS decode error:', err);
                  continue;
                }
                console.log(decoded);
                
                if (decoded.redeem_request_id.toLowerCase() !== normalizedId) continue;

                clearTimeout(timer);
                resolve({ encryptedReservation: new Uint8Array(decoded.encrypted_reservation), resId: decoded.res_id, bwRounded: decoded.bw_rounded, bwDataplaneEncoding: decoded.bw_dataplane_encoding });
                return;
              }
            }
          }
          clearTimeout(timer);
          reject(new Error('gRPC stream ended before ReservationDelivered'));
        } catch (err) {
          clearTimeout(timer);
          reject(err);
        }
      })();
    });
  }
}
