import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { SuiGrpcClient, GrpcWebFetchTransport } from '@mysten/sui/grpc';
import { GrpcTransport } from '@protobuf-ts/grpc-transport';
import { ChannelCredentials } from '@grpc/grpc-js';
import type { Network } from './package/manifest.js';

export type { SuiJsonRpcClient, SuiGrpcClient };

/** Return a SuiJsonRpcClient pointed at the given network's public fullnode. */
export function createSuiClient(network: Network): SuiJsonRpcClient {
  return new SuiJsonRpcClient({
    url: getJsonRpcFullnodeUrl(network),
    network,
  });
}

/**
 * Return a SuiGrpcClient for the given network.
 * If grpcUrl is provided (e.g. "fullnode.testnet.sui.io:443"), uses native gRPC over TLS.
 * Otherwise falls back to the SDK's default gRPC-web transport.
 */
export function createSuiGrpcClient(network: Network, grpcUrl?: string): SuiGrpcClient {
  if (grpcUrl) {
    const transport = new GrpcTransport({
      host: grpcUrl,
      channelCredentials: ChannelCredentials.createSsl(),
    });
    return new SuiGrpcClient({ network, transport });
  }
  // No custom endpoint — fall back to gRPC-web on the same HTTPS fullnode URL
  const transport = new GrpcWebFetchTransport({ baseUrl: getJsonRpcFullnodeUrl(network) });
  return new SuiGrpcClient({ network, transport });
}
