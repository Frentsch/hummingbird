import type { SuiGraphQLClient, Config, DeliveryListener, SqliteDb } from '@sui-shim/core';
import type { Keypair } from '@mysten/sui/cryptography';

export interface AppState {
  config: Config;
  client: SuiGraphQLClient;
  signer: Keypair;
  packageId: string;
  globalRegistryId: string;
  asRegistryId: string;
  asAuthCapId: string;
  sellerAuthTokenId: string;
  /** interface_id (u16) → on-chain object ID */
  interfaceObjects: Map<number, string>;
  deliveryListener: DeliveryListener;
  pendingRedemptions: Map<BigInt, string>;
  db: SqliteDb;
  /** URL of the auth-server for proxying AS registration requests, or undefined if not configured. */
  authServerUrl: string | undefined;
}
