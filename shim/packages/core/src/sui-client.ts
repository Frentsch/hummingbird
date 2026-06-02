import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import type { Network } from './package/manifest.js';

export type { SuiJsonRpcClient };

/** Return a SuiJsonRpcClient pointed at the given network's public fullnode. */
export function createSuiClient(network: Network): SuiJsonRpcClient {
  return new SuiJsonRpcClient({
    url: getJsonRpcFullnodeUrl(network),
    network,
  });
}
