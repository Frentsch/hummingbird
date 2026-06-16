import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { toBase64, fromBase64 } from '@mysten/bcs';
import { Transaction } from '@mysten/sui/transactions';
import { z } from 'zod';
import {
  buildRegisterAs,
  buildRegisterSeller,
  buildCreateInterface,
  buildCreateListing,
  buildBuyAndTake,
  buildRedeem,
  buildDeliverReservation,
  buildDelistAndTake,
  executeTransaction,
  DEFAULT_COIN_TYPE,
} from '@sui-shim/core';
import type { AppState } from '../state.js';
import { callers } from '../callers.js';
import {
  RegisterAsBody,
  RegisterSellerBody,
  CreateInterfaceBody,
  CreateListingBody,
  BuyAndTakeBody,
  RedeemBody,
  DeliverReservationBody,
  DelistAndTakeBody,
  AddCallerBody,
} from './schemas.js';

function parseBody<T>(
  schema: z.ZodType<T>,
  body: unknown,
): { ok: true; data: T } | { ok: false; response: Response } {
  const result = schema.safeParse(body);
  if (!result.success) {
    const msg = result.error.issues
      .map((i) => `${String(i.path.join('.'))}: ${i.message}`)
      .join(', ');
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: `Validation error: ${msg}` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    };
  }
  return { ok: true, data: result.data };
}

// Typed helper so tx.build({ client }) resolves correctly
async function buildTxBytes(tx: Transaction, state: AppState): Promise<string> {
  tx.setSender(state.signer.toSuiAddress());
  const bytes = await tx.build({ client: state.client as never });
  return toBase64(bytes);
}

export function createHttpRouter(state: AppState): Hono {
  const app = new Hono();

  app.use('*', cors());

  // Auth middleware — all routes except /health require Bearer token
  app.use('*', async (c, next) => {
    if (c.req.path === '/health') return next();
    const auth = c.req.header('Authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    /* no auth for now
    if (!callers.has(token)) {
      return c.json({ error: 'Unauthorized' }, 401);
    }*/
    return next();
  });

  app.get('/health', (c) => c.json({ ok: true }));

  // Config — read and patch mutable runtime state
  app.get('/config', (c) =>
    c.json({
      packageId: state.packageId,
      globalRegistryId: state.globalRegistryId,
      asRegistryId: state.asRegistryId,
      asAuthCapId: state.asAuthCapId,
      sellerAuthTokenId: state.sellerAuthTokenId,
      network: state.config.network.name,
      coinType: DEFAULT_COIN_TYPE,
    }),
  );

  app.patch('/config', async (c) => {
    const body = await c.req.json().catch(() => null);
    const schema = z.object({
      globalRegistryId: z.string().optional(),
      asRegistryId: z.string().optional(),
      asAuthCapId: z.string().optional(),
      sellerAuthTokenId: z.string().optional(),
    });
    const parsed = parseBody(schema, body);
    if (!parsed.ok) return parsed.response;
    if (parsed.data.globalRegistryId !== undefined) state.globalRegistryId = parsed.data.globalRegistryId;
    if (parsed.data.asRegistryId !== undefined) state.asRegistryId = parsed.data.asRegistryId;
    if (parsed.data.asAuthCapId !== undefined) state.asAuthCapId = parsed.data.asAuthCapId;
    if (parsed.data.sellerAuthTokenId !== undefined) state.sellerAuthTokenId = parsed.data.sellerAuthTokenId;
    return c.json({ ok: true });
  });

  // Callers management
  app.get('/callers', (c) => c.json({ callers: [...callers] }));

  app.post('/callers', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = parseBody(AddCallerBody, body);
    if (!parsed.ok) return parsed.response;
    callers.add(parsed.data.key);
    return c.json({ ok: true });
  });

  app.delete('/callers/:key', (c) => {
    const key = decodeURIComponent(c.req.param('key'));
    callers.delete(key);
    return c.json({ ok: true });
  });

  // TX builders — return unsigned serialised transaction bytes as base64
  app.post('/tx/build/registerAs', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = parseBody(RegisterAsBody, body);
    if (!parsed.ok) return parsed.response;
    const txBytes = await buildTxBytes(buildRegisterAs({ packageId: state.packageId, ...parsed.data }), state);

    return c.json({ txBytes });
  });

  app.post('/tx/build/registerSeller', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = parseBody(RegisterSellerBody, body);
    if (!parsed.ok) return parsed.response;
    const txBytes = await buildTxBytes(buildRegisterSeller({ packageId: state.packageId, ...parsed.data }), state);
    return c.json({ txBytes });
  });

  app.post('/tx/build/createInterface', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = parseBody(CreateInterfaceBody, body);
    if (!parsed.ok) return parsed.response;
    const txBytes = await buildTxBytes(buildCreateInterface({ packageId: state.packageId, ...parsed.data }), state);
    return c.json({ txBytes });
  });

  app.post('/tx/build/createListing', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = parseBody(CreateListingBody, body);
    if (!parsed.ok) return parsed.response;
    const txBytes = await buildTxBytes(buildCreateListing({ packageId: state.packageId, ...parsed.data }), state);
    return c.json({ txBytes });
  });

  app.post('/tx/build/buyAndTake', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = parseBody(BuyAndTakeBody, body);
    if (!parsed.ok) return parsed.response;
    const txBytes = await buildTxBytes(buildBuyAndTake({ packageId: state.packageId, ...parsed.data }), state);
    return c.json({ txBytes });
  });

  app.post('/tx/build/redeem', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = parseBody(RedeemBody, body);
    if (!parsed.ok) return parsed.response;
    const txBytes = await buildTxBytes(
      buildRedeem({ packageId: state.packageId, ...parsed.data, publicKey: new Uint8Array(parsed.data.publicKey) }),
      state,
    );
    return c.json({ txBytes });
  });

  app.post('/tx/build/deliverReservation', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = parseBody(DeliverReservationBody, body);
    if (!parsed.ok) return parsed.response;
    const txBytes = await buildTxBytes(
      buildDeliverReservation({ packageId: state.packageId, ...parsed.data, encryptedReservation: new Uint8Array(parsed.data.encryptedReservation) }),
      state,
    );
    return c.json({ txBytes });
  });

  app.post('/tx/build/delistAndTake', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = parseBody(DelistAndTakeBody, body);
    if (!parsed.ok) return parsed.response;
    const txBytes = await buildTxBytes(buildDelistAndTake({ packageId: state.packageId, ...parsed.data }), state);
    return c.json({ txBytes });
  });

  // TX submit — sign and execute with daemon signer, return digest
  app.post('/tx/submit', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object' || typeof (body as Record<string, unknown>)['txBytes'] !== 'string') {
      return c.json({ error: 'txBytes string required' }, 400);
    }
    try {
      const txBytes = fromBase64((body as { txBytes: string }).txBytes);
      const tx = Transaction.from(txBytes);
      const result = await executeTransaction(
        state.client,
        state.signer,
        tx,
      );
      console.log({result});
      return c.json({ digest: result.digest, status: result.effects.status.success ? 'success' : 'failure', effects: result.effects });
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  return app;
}
