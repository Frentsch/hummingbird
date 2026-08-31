import { createServer as createTcpServer } from 'node:net';
import { createServer as createHttp1Server } from 'node:http';
import { createServer as createHttp2Server } from 'node:http2';
import { connectNodeAdapter, compressionGzip } from '@connectrpc/connect-node';
import {
  createSuiClient,
  createSuiGrpcClient,
  loadKeypairs,
  resolveSigner,
  EventListener,
  DeliveryListener,
  loadConfig,
  openDB,
  loadOrCreateEncryptionKeypair,
} from '@sui-shim/core';
import type { RedeemEvent } from '@sui-shim/core';
import type { AppState } from './state.js';
import { createRpcRoutes } from './rpc/handler.js';
import { pushRedeemRequest } from './rpc/handlers/redemption.js';
import { RedeemAssetFromASRequest } from './rpc/gen/hummingbird/v1/redemption_pb.js';
import { Timestamp } from '@bufbuild/protobuf';

export async function startServer(configPath: string): Promise<void> {
  const config = await loadConfig(configPath);
  const client = createSuiClient(config.sui.network);

  const suiKeypairs = await loadKeypairs({ path: config.sui.keystorePath });
  const asSigner = resolveSigner(suiKeypairs, config.as.walletAddress);
  const clientSigner = resolveSigner(suiKeypairs, config.client.walletAddress);
  const grpcClient = createSuiGrpcClient(config.sui.network, config.sui.grpcUrl);
  const deliveryListener = new DeliveryListener(grpcClient);
  const db = openDB(config.market.dbPath);
  
  const authKeypair = await loadOrCreateEncryptionKeypair(config.client.encryptionKeyPath);

  const state: AppState = {
    config,
    client,
    asSigner,
    clientSigner,
    authKeypair,
    interfaceObjects: new Map(),
    deliveryListener,
    pendingRedemptions: new Map(),
    db,
    authServerUrl: config.market.authServerUrl,
  };


  const onRedeem = (ev: RedeemEvent) => {
    const req = new RedeemAssetFromASRequest({
      ingressId: parseInt(ev.ingressAssetId, 16),
      egressId: parseInt(ev.egressAssetId, 16),
      bandwidth: ev.bandwidth,
      startsAt: new Timestamp({ seconds: ev.startTime }),
      stopsAt: new Timestamp({ seconds: ev.expTime }),
      requestId: BigInt(ev.requestId.toString()),
    });
    state.pendingRedemptions.set(ev.requestId, {
      requestObjectId: ev.requestObjectId,
      publicKey: ev.publicKey,
      req,
      lastSentAt: Date.now(),
    });
    pushRedeemRequest(req);
  };
  
  const eventListener = new EventListener(client, grpcClient, config.sui.packageId, asSigner.getPublicKey().toSuiAddress(), onRedeem);
  eventListener.start();

  const rpcHandler = connectNodeAdapter({
    routes: (router) => {
      createRpcRoutes(state)(router);
      for (const handler of router.handlers) {
        console.log(`[debug] registered route: ${handler.requestPath}`);
      }
    },
    acceptCompression: [compressionGzip],
  });
  
  const h1Server = createHttp1Server(rpcHandler as any);
  const h2Server = createHttp2Server(rpcHandler as any);
  const rpcServer = createTcpServer(socket => {
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

  rpcServer.listen(config.market.grpcPort, () => {
    console.log(`[debug] [gRPC/Connect] listening on port ${config.market.grpcPort} (HTTP/1.1 + HTTP/2)`);
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
