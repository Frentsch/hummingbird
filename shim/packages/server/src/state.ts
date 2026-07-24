import type { SuiGraphQLClient, Config, DeliveryListener, SqliteDb, AuthKeypair } from '@sui-shim/core';
import type { Keypair } from '@mysten/sui/cryptography';
import type { RedeemAssetFromASRequest } from './rpc/gen/hummingbird/v1/redemption_pb.js';

/** Everything needed to (re)send a redemption request to the AS and, once answered, deliver the reservation. */
export interface PendingRedemption {
  /** On-chain object ID of the redeem request, passed to buildDeliverReservation. */
  requestObjectId: string;
  /** Buyer's X25519 public key, for sealing the AS's authenticationKey before delivery. */
  publicKey: Uint8Array;
  /** The request as originally sent, kept so it can be resent unchanged. */
  req: RedeemAssetFromASRequest;
  /** Timestamp (ms) this request was last sent to the AS. */
  lastSentAt: number;
}

export interface AppState {
  config: Config;
  client: SuiGraphQLClient;
  signer: Keypair;
  /** X25519 keypair used to encrypt/decrypt authenticationKeys. */
  authKeypair: AuthKeypair;
  packageId: string;
  globalRegistryId: string;
  asRegistryId: string;
  asAuthCapId: string;
  sellerAuthTokenId: string;
  /** interface_id (u16) → on-chain object ID */
  interfaceObjects: Map<number, string>;
  deliveryListener: DeliveryListener;
  /** requestId → pending redemption awaiting an AS response. */
  pendingRedemptions: Map<bigint, PendingRedemption>;
  db: SqliteDb;
  /** URL of the auth-server for proxying AS registration requests, or undefined if not configured. */
  authServerUrl: string | undefined;
}
