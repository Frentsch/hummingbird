import { createServer } from 'node:http';
import { serve } from '@hono/node-server';
import { connectNodeAdapter, compressionGzip } from '@connectrpc/connect-node';
import {
  createSuiClient,
  loadKeypairs,
  resolveSigner,
  EventListener,
  PlaintextUnlocker,
  loadConfig,
} from '@sui-shim/core';
import type { RedeemEvent } from '@sui-shim/core';
import type { AppState } from './state.js';
import { createHttpRouter } from './http/router.js';
import { createRpcRoutes } from './rpc/handler.js';
import { pendingRedeemRequests } from './rpc/handlers/redemption.js';
import { RedeemAssetFromASRequest } from './rpc/gen/hummingbird/v1/redemption_pb.js';
import { authInterceptor } from './rpc/auth-interceptor.js';
import { Timestamp } from '@bufbuild/protobuf';

export async function startServer(configPath: string): Promise<void> {
  const config = await loadConfig(configPath);
  const client = createSuiClient(config.network.name);

  const keypairs = await loadKeypairs({
    path: config.keystore.path,
    unlocker: new PlaintextUnlocker(),
  });
  const signer = resolveSigner(keypairs, config.keystore.address);

  const state: AppState = {
    config,
    client,
    signer,
    packageId: config.package.id,
    globalRegistryId: config.package.globalRegistryId ?? '',
    asRegistryId: config.as.asRegistryId ?? '',
    asAuthCapId: config.as.asAuthCapId ?? process.env['SHIM_AS_AUTH_CAP_ID'] ?? '',
    sellerAuthTokenId: config.as.sellerAuthTokenId ?? process.env['SHIM_SELLER_AUTH_TOKEN_ID'] ?? '',
    interfaceObjects: new Map(),
  };

  const onRedeem = (ev: RedeemEvent) => {
    const req = new RedeemAssetFromASRequest({
      ingressId: parseInt(ev.ingressAssetId, 16),
      egressId: parseInt(ev.egressAssetId, 16),
      bw: 0n,
      startsAt: Timestamp.fromDate(new Date()),
      stopsAt: Timestamp.fromDate(new Date(Date.now() + 3600_000)),
      requestId: ev.requestId,
    });
    for (const enqueue of pendingRedeemRequests.values()) {
      enqueue(req);
    }
  };

  const eventListener = new EventListener(client, config.package.id, onRedeem);
  eventListener.start();

  const httpApp = createHttpRouter(state);
  serve({ fetch: httpApp.fetch, port: config.http.port }, (info) => {
    console.log(`[HTTP] listening on port ${info.port}`);
  });

  const rpcHandler = connectNodeAdapter({
    routes: createRpcRoutes(state),
    acceptCompression: [compressionGzip],
    interceptors: [authInterceptor],
  });
  const rpcServer = createServer(rpcHandler);
  rpcServer.listen(config.grpc.port, () => {
    console.log(`[gRPC/Connect] listening on port ${config.grpc.port}`);
  });

  const shutdown = () => {
    console.log('Shutting down…');
    eventListener.stop();
    rpcServer.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// Only auto-start when run directly as a script
const scriptUrl = new URL(import.meta.url);
const argUrl = new URL(process.argv[1]!, 'file://');
if (scriptUrl.pathname === argUrl.pathname) {
  startServer(process.env['SHIM_CONFIG'] ?? 'shim.toml').catch((err) => {
    console.error('Fatal startup error:', err);
    process.exit(1);
  });
}
