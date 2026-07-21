import { ConnectError, Code } from '@connectrpc/connect';
import type { HandlerContext, ServiceImpl } from '@connectrpc/connect';
import { AccountService } from '../gen/hummingbird/v1/account_connect.js';
import { CreateChallengeResponse, RegisterASResponse } from '../gen/hummingbird/v1/account_pb.js';
import { saveConfig } from '@sui-shim/core';
import type { AppState } from '../../state.js';

// Auth-server Connect JSON endpoint paths.
const CREATE_CHALLENGE = 'proto.hummingbird.v1.ASRegistrationService/CreateChallenge';
const REGISTER_AS = 'proto.hummingbird.v1.ASRegistrationService/RegisterAS';

async function callAuthServer(baseUrl: string, path: string, body: unknown): Promise<unknown> {
  const resp = await fetch(`${baseUrl}/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Connect-Protocol-Version': '1',
    },
    body: JSON.stringify(body),
  });
  console.log(resp);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({})) as Record<string, string>;
    throw new ConnectError(err['message'] ?? `auth-server error ${resp.status}`, Code.Internal);
  }
  return resp.json();
}

function extractAuthority(ctx: HandlerContext): string {
  ctx.requestHeader.forEach((v,k,h) => console.log(k));
  // HTTP/2 uses :authority; HTTP/1.1 uses Host.
  return ctx.requestHeader.get('authority') ?? ctx.requestHeader.get('host') ?? '';
}

export function createRegistrationServiceImpl(
  state: AppState,
): Pick<ServiceImpl<typeof AccountService>, 'createChallenge' | 'registerAS'> {
  if (!state.authServerUrl) {
    return {
      createChallenge() {
        throw new ConnectError(
          'auth-server not configured (set authServer.url in shim.toml)',
          Code.Unimplemented,
        );
      },
      registerAS() {
        throw new ConnectError(
          'auth-server not configured (set authServer.url in shim.toml)',
          Code.Unimplemented,
        );
      },
    };
  }

  const baseUrl = state.authServerUrl;
  const suiAddress = state.signer.getPublicKey().toSuiAddress();

  return {
    async createChallenge(req) {
      // Enrich with the shim's Sui address before forwarding to the auth-server.
      const result = await callAuthServer(baseUrl, CREATE_CHALLENGE, {
        ia: req.ia.toString(),
        suiAddress,
      }) as { id?: string; value?: string };
      console.log(result);
      return new CreateChallengeResponse({
        id: result.id ?? '',
        // Auth-server returns value as base64 in JSON proto encoding.
        value: result.value ? Buffer.from(result.value, 'base64') : new Uint8Array(),
      });
    },

    async registerAS(req, ctx) {
      const sm = req.signedChallenge;
      console.log(sm);
      if (!sm) {
        throw new ConnectError('signed_challenge is required', Code.InvalidArgument);
      }

      // Forward the SignedMessage and the HTTP authority the AS used when signing.
      // The SCION client includes authority as associated data in the ECDSA signature,
      // so the auth-server needs it to reproduce the signed digest.
      const result = await callAuthServer(baseUrl, REGISTER_AS, {
        id: req.id,
        signedChallenge: {
          headerAndBody: Buffer.from(sm.headerAndBody).toString('base64'),
          signature: Buffer.from(sm.signature).toString('base64'),
        },
        authority: extractAuthority(ctx),
      }) as { authCapId?: string };

      const asAuthCapId = result.authCapId ?? '';
      console.log(asAuthCapId);
      if(asAuthCapId != ""){
        state.asAuthCapId = asAuthCapId;
        state.config.as.asAuthCapId = asAuthCapId;
        await saveConfig(state.config);
      }

      return new RegisterASResponse({ jwtPublisher: 'dummy-token', jwtRedemption: 'dummy-token' });
    },
  };
}
