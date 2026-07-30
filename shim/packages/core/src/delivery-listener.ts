import { bcs } from '@mysten/sui/bcs';
import type { SuiGrpcClient } from './sui-client.js';

export interface DeliveryResult {
  encryptedReservation: Uint8Array;
  resId: number,
  bwRounded: number,
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
  res_id: bcs.u64(),
  bw_rounded: bcs.u64(),
  bw_dataplane_encoding: bcs.u16(),
});


export class DeliveryListener {
  readonly #grpc: SuiGrpcClient;

  constructor(grpcClient: SuiGrpcClient) {
    this.#grpc = grpcClient;
  }

  /**
   * Watch checkpoints until a ReservationDelivered event appears in a transaction
   * with a matching redeem_request_id.
   * Rejects with DeliveryTimeoutError on timeout.
   */
  async waitForDelivery(
    publicKey: Uint8Array,
    packageId: string,
    timeoutMs: number,
  ): Promise<DeliveryResult> {
    const deliveryEventType = `${packageId}::hummingbird_asset::ReservationDelivered`;
    //const normalizedId = redeemRequestObjectId.toLowerCase();

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
              for (const event of tx.events?.events ?? []) {
              //console.log(event.eventType);
                if (event.eventType !== deliveryEventType) continue;
                if (!event.contents?.value) continue;
                console.log("received delivery")

                let decoded: { redeem_request_id: string; encrypted_reservation: number[]; public_key: number[]; res_id: string, bw_rounded: string; bw_dataplane_encoding: number };
                try {
                  const fullDecode = ReservationDeliveredBCS.parse(event.contents.value);
                  console.log(fullDecode);
                  decoded = ReservationDeliveredBCS.parse(event.contents.value);
                } catch (err) {
                  console.error('[DeliveryListener] BCS decode error:', err);
                  continue;
                }
                console.log(decoded);
                
                //TODO add some additional identifier to avoid two concurrent redemptions to get mismatched
                if (!(publicKey.length == decoded.public_key.length && publicKey.every((value,index) => value === decoded.public_key[index]))){
                  console.log(`mismatched publickey ${decoded.public_key} and ${publicKey}`)
                  continue;
                } 

                clearTimeout(timer);
                resolve({ encryptedReservation: new Uint8Array(decoded.encrypted_reservation), resId: Number(decoded.res_id), bwRounded: Number(decoded.bw_rounded), bwDataplaneEncoding: decoded.bw_dataplane_encoding });
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
