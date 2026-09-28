import { bcs } from '@mysten/sui/bcs';
import type { SuiGrpcClient } from './sui-client.js';
import { time } from 'node:console';
import { date } from 'zod';

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
  bw_dataplane_encoding: bcs.u32(),
});


export class DeliveryListener {
  readonly #grpc: SuiGrpcClient;

  constructor(grpcClient: SuiGrpcClient) {
    this.#grpc = grpcClient;
  }

  async waitForDelivery(
    publicKey: Uint8Array,
    packageId: string,
    timeoutMs: number,
  ): Promise<DeliveryResult> {
    const deliveryEventType = `${packageId}::hummingbird_asset::ReservationDelivered`;
    //const normalizedId = redeemRequestObjectId.toLowerCase();
    const abortController = new AbortController();

    return new Promise<DeliveryResult>(async (resolve, reject) => {
      const timer = setTimeout(() => {
        abortController.abort();
        reject(new DeliveryTimeoutError());
      }, timeoutMs);
      console.log(`Startup delivery listener: ${new Date().getUTCMilliseconds}`)
      const stream = this.#grpc.subscriptionService.subscribeCheckpoints(
        { readMask: { paths: ['transactions.events', 'transactions.effects'] } },
        { abort: abortController.signal },
      );
      await stream.headers.catch(err => reject(err));
      console.log(`delivery listener started at ${new Date().getUTCMilliseconds}`);
      (async () => {
        try {
          for await (const response of stream.responses) {
            const checkpoint = response.checkpoint;
            if (!checkpoint) continue;
            for (const tx of checkpoint.transactions) {
              for (const event of tx.events?.events ?? []) {
                if (event.eventType !== deliveryEventType) continue;
                if (!event.contents?.value) continue;

                let decoded: { redeem_request_id: string; encrypted_reservation: number[]; public_key: number[]; res_id: string, bw_rounded: string; bw_dataplane_encoding: number };
                try {
                  const fullDecode = ReservationDeliveredBCS.parse(event.contents.value);
                  console.log(fullDecode);
                  decoded = ReservationDeliveredBCS.parse(event.contents.value);
                } catch (err) {
                  console.error('[DeliveryListener] BCS decode error:', err);
                  continue;
                }
                
                //TODO add some additional identifier to avoid two concurrent redemptions to get mismatched
                //The issue is that the listener should be started before the transaction is executed, 
                // but we need to execute the transaction in order to get the reservation object id
                // probably add an additional field to the event
                if (!(publicKey.length == decoded.public_key.length && publicKey.every((value,index) => value === decoded.public_key[index]))){
                  console.log(`mismatched publickey ${decoded.public_key} and ${publicKey}`)
                  continue;
                } 

                clearTimeout(timer);
                abortController.abort();
                resolve({ encryptedReservation: new Uint8Array(decoded.encrypted_reservation), resId: Number(decoded.res_id), bwRounded: Number(decoded.bw_rounded), bwDataplaneEncoding: decoded.bw_dataplane_encoding });
                return;
              }
            }
          }
          clearTimeout(timer);
          reject(new Error('gRPC stream ended before ReservationDelivered'));
        } catch (err) {
          clearTimeout(timer);
          abortController.abort();
          reject(err);
        }
      })();
    });
  }
}
