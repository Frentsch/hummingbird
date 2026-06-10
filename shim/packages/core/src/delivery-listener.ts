import { bcs } from '@mysten/sui/bcs';
import type { SuiGrpcClient } from './sui-client.js';

export interface DeliveryResult {
  encryptedReservation: Uint8Array;
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
  public_key: bcs.vector(bcs.u8()),
  encrypted_reservation: bcs.vector(bcs.u8()),
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
              // Confirm this tx deletes the expected RedeemRequest object
              const deletesRequest = (tx.effects?.changedObjects ?? []).some(
                (c: { idOperation?: number; objectId?: string }) =>
                  c.idOperation === DELETED &&
                  (c.objectId ?? '').toLowerCase() === normalizedId,
              );
              if (!deletesRequest) continue;

              // Find the matching ReservationDelivered event in the same tx
              for (const event of tx.events?.events ?? []) {
                if (event.eventType !== deliveryEventType) continue;
                if (!event.contents?.value) continue;

                try {
                  const decoded = ReservationDeliveredBCS.parse(event.contents.value);
                  clearTimeout(timer);
                  resolve({ encryptedReservation: new Uint8Array(decoded.encrypted_reservation) });
                  return;
                } catch (err) {
                  console.error('[DeliveryListener] BCS decode error:', err);
                }
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
