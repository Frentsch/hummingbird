import type { SuiGraphQLClient, Config, DeliveryListener, SqliteDb, AuthKeypair } from '@sui-shim/core';
import type { Keypair } from '@mysten/sui/cryptography';
import type { RedeemAssetFromASRequest } from './rpc/gen/hummingbird/v1/redemption_pb.js';

export interface PendingRedemption {
  requestObjectId: string;
  publicKey: Uint8Array;
  req: RedeemAssetFromASRequest;
  lastSentAt: number;
}

export interface AppState {
  config: Config;
  client: SuiGraphQLClient;
  asSigner: Keypair;
  clientSigner: Keypair;
  authKeypair: AuthKeypair;
  interfaceObjects: Map<number, string>;
  deliveryListener: DeliveryListener;
  /** requestId → pending redemption awaiting an AS response. */
  pendingRedemptions: Map<bigint, PendingRedemption>;
  db: SqliteDb;
  authServerUrl: string | undefined;
}
