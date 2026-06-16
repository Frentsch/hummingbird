import { SuiGraphQLClient } from '@mysten/sui/graphql';
import { SuiGrpcClient, GrpcWebFetchTransport } from '@mysten/sui/grpc';
import { GrpcTransport } from '@protobuf-ts/grpc-transport';
import { ChannelCredentials } from '@grpc/grpc-js';
import type { Network } from './package/manifest.js';

export type { SuiGraphQLClient, SuiGrpcClient };

const GRAPHQL_URLS: Record<Network, string> = {
  mainnet: 'https://graphql.mainent.sui.io/graphql',
  testnet: 'https://graphql.testnet.sui.io/graphql',
  devnet:  'https://sui-devnet.mystenlabs.com/graphql',
  localnet: 'http://127.0.0.1:9125/graphql',
};

const GRPC_FALLBACK_URLS: Record<Network, string> = {
  mainnet: 'https://fullnode.mainnet.sui.io',
  testnet: 'https://fullnode.testnet.sui.io',
  devnet:  'https://fullnode.devnet.sui.io',
  localnet: 'http://127.0.0.1:9000',
};

/** Return a SuiGraphQLClient pointed at the given network's GraphQL endpoint. */
export function createSuiClient(network: Network): SuiGraphQLClient {
  return new SuiGraphQLClient({ url: GRAPHQL_URLS[network], network });
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
  const transport = new GrpcWebFetchTransport({ baseUrl: GRPC_FALLBACK_URLS[network] });
  return new SuiGrpcClient({ network, transport });
}
