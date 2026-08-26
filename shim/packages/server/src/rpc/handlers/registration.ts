import { ConnectError, Code, createClient } from '@connectrpc/connect';
import type { HandlerContext, ServiceImpl } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-node';
import { AccountService } from '../gen/hummingbird/v1/account_connect.js';
import { CreateChallengeResponse, RegisterASResponse } from '../gen/hummingbird/v1/account_pb.js';
import { ASRegistrationService } from '../gen/hummingbird/v1/registration_connect.js';
import { ShimCreateChallengeRequest, ShimRegisterASRequest } from '../gen/hummingbird/v1/registration_pb.js';
import { saveConfig, u64ToIsdAsId } from '@sui-shim/core';
import type { AppState } from '../../state.js';
import { deriveObjectID } from '@mysten/sui/utils';
import { bcs } from '@mysten/sui/bcs';

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

  const suiAddress = state.signer.getPublicKey().toSuiAddress();
  const transport = createConnectTransport({ baseUrl: state.authServerUrl, httpVersion: '1.1' });
  const authServerClient = createClient(ASRegistrationService, transport);

  return {
    async createChallenge(req) {
      try{
        const result = await authServerClient.createChallenge(
          new ShimCreateChallengeRequest({ ia: req.ia, suiAddress }),
        );
        return new CreateChallengeResponse({
          id: result.id,
          value: result.value,
        });
      }catch (error){
        throw new ConnectError(`Failed to reach Auth Server ${error}. Make sure to start the auth server`, Code.Unavailable)
      }
    },

    async registerAS(req, ctx) {
      const sm = req.signedChallenge;
      if (!sm) {
        throw new ConnectError('signed_challenge is required', Code.InvalidArgument);
      }

      try{
        const result = await authServerClient.registerAS(
          new ShimRegisterASRequest({
            id: req.id,
            signedChallenge: sm,
            authority: extractAuthority(ctx),
          }),
        );

        const asAuthCapId = result.authCapId;
        if(asAuthCapId != ""){
          state.asAuthCapId = asAuthCapId;
          state.config.as.asAuthCapId = asAuthCapId;
          state.config.as.isdAsId = u64ToIsdAsId(result.isdAsId);
          state.config.as.asRegistryId = deriveObjectID(state.config.package.globalRegistryId!, 'u64',  bcs.U64.serialize(result.isdAsId).toBytes());
          await saveConfig(state.config);
        }

        return new RegisterASResponse({ jwtPublisher: 'dummy-token', jwtRedemption: 'dummy-token' });
      }catch(error) {
        throw new ConnectError(`Failed to reach Auth Server ${error}. Make sure to start the auth server`, Code.Unavailable)
      }
    },
  };
}
