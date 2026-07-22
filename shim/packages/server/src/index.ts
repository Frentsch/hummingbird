import { createServer as createTcpServer } from 'node:net';
import { createServer as createHttp1Server } from 'node:http';
import { createServer as createHttp2Server } from 'node:http2';
import { serve } from '@hono/node-server';
import { connectNodeAdapter, compressionGzip } from '@connectrpc/connect-node';
import {
  createSuiClient,
  createSuiGrpcClient,
  loadKeypairs,
  resolveSigner,
  EventListener,
  DeliveryListener,
  PlaintextUnlocker,
  loadConfig,
  openReservationDb,
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

  const grpcClient = createSuiGrpcClient(config.network.name, config.network.grpcUrl);
  const deliveryListener = new DeliveryListener(grpcClient);
  const db = openReservationDb(config.db.path);

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
    deliveryListener,
    pendingRedemptions: new Map(),
    db,
    authServerUrl: config.authServer?.url,
  };

  const myAddress = signer.getPublicKey().toSuiAddress();

  const onRedeem = (ev: RedeemEvent) => {
    const req = new RedeemAssetFromASRequest({
      ingressId: parseInt(ev.ingressAssetId, 16),
      egressId: parseInt(ev.egressAssetId, 16),
      bw: ev.bandwidth,
      startsAt: Timestamp.fromDate(new Date(Number(ev.startTime))),
      stopsAt: Timestamp.fromDate(new Date(Number(ev.expTime))),
      requestId: ev.requestId.toString(),
    });
    state.pendingRedemptions.set(ev.requestId, ev.requestObjectId);
    for (const enqueue of pendingRedeemRequests.values()) {
      enqueue(req);
    }
  };

  const eventListener = new EventListener(client, grpcClient, config.package.id, myAddress, onRedeem);
  eventListener.start();

  const httpApp = createHttpRouter(state);
  serve({ fetch: httpApp.fetch, port: config.http.port }, (info) => {
    console.log(`[HTTP] listening on port ${info.port}`);
  });

  const rpcHandler = connectNodeAdapter({
    routes: (router) => {
      createRpcRoutes(state)(router);
      for (const handler of router.handlers) {
        console.log(`[debug] registered route: ${handler.requestPath}`);
      }
    },
    acceptCompression: [compressionGzip],
    interceptors: [authInterceptor],
  });
  
  // HTTP/1.1 and HTTP/2 share the same port via a protocol-sniffing TCP multiplexer.
  // HTTP/2 prior-knowledge connections always start with "PRI" (0x50 0x52 0x49);
  // everything else (Go clients using Connect/gRPC-Web over HTTP/1.1) goes to the
  // HTTP/1.1 server. Both servers use the same connectNodeAdapter handler instance.
  const h1Server = createHttp1Server(rpcHandler as any);
  const h2Server = createHttp2Server(rpcHandler as any);
  const rpcServer = createTcpServer(socket => {
    // Use 'readable' (paused mode) not 'data' (flowing mode).
    // With 'data', after the once-listener fires and removes itself the socket stays
    // flowing with no listeners — socket.unshift(chunk) puts bytes back but they are
    // immediately re-emitted to no one and discarded.  With 'readable' + socket.read()
    // the socket stays paused; unshift correctly prepends the bytes so the next owner
    // (h1Server or h2Server) sees them when it attaches its own 'data' listener.
    function peek() {
      const chunk = socket.read(3) as Buffer | null;
      if (!chunk) { socket.once('readable', peek); return; }
      socket.unshift(chunk);
      if (chunk[0] === 0x50 && chunk[1] === 0x52 && chunk[2] === 0x49) {
        h2Server.emit('connection', socket);
      } else {
        h1Server.emit('connection', socket);
      }
    }
    socket.once('readable', peek);
  });

  rpcServer.listen(config.grpc.port, () => {
    console.log(`[debug] [gRPC/Connect] listening on port ${config.grpc.port} (HTTP/1.1 + HTTP/2)`);
  });

  const shutdown = () => {
    console.log('Shutting down…');
    eventListener.stop();
    rpcServer.close();
    h1Server.close();
    h2Server.close();
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
