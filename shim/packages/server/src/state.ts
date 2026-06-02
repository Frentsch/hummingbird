import type { SuiJsonRpcClient, Config } from '@sui-shim/core';
import type { Keypair } from '@mysten/sui/cryptography';

export interface AppState {
  config: Config;
  client: SuiJsonRpcClient;
  signer: Keypair;
  packageId: string;
  globalRegistryId: string;
  asRegistryId: string;
  asAuthCapId: string;
  sellerAuthTokenId: string;
  /** interface_id (u16) → on-chain object ID */
  interfaceObjects: Map<number, string>;
}
