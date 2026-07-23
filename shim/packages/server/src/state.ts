import type { SuiGraphQLClient, Config, DeliveryListener, SqliteDb, AuthKeypair } from '@sui-shim/core';
import type { Keypair } from '@mysten/sui/cryptography';

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
  pendingRedemptions: Map<BigInt, string>;
  /** requestId → buyer's X25519 public key, for sealing the AS's authenticationKey before delivery. */
  pendingRedemptionKeys: Map<bigint, Uint8Array>;
  db: SqliteDb;
  /** URL of the auth-server for proxying AS registration requests, or undefined if not configured. */
  authServerUrl: string | undefined;
}
