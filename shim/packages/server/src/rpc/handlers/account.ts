import { randomUUID } from 'node:crypto';
import type { ServiceImpl } from '@connectrpc/connect';
import type { AccountService as IAccountService } from '../gen/hummingbird/v1/account_connect.js';
import { JWTIssuanceResponse, JWTResetResponse } from '../gen/hummingbird/v1/account_pb.js';
import { callers } from '../../callers.js';

export const accountServiceImpl: Partial<ServiceImpl<typeof IAccountService>> = {
  issueJWT(_req, _ctx) {
    const publisherToken = randomUUID();
    const redemptionToken = randomUUID();
    callers.add(publisherToken);
    callers.add(redemptionToken);
    return new JWTIssuanceResponse({ jwtPublisher: publisherToken, jwtRedemption: redemptionToken });
  },

  resetJWT(_req, ctx) {
    const auth = ctx.requestHeader.get('Authorization') ?? '';
    const old = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (old) callers.delete(old);
    return new JWTResetResponse();
  },
};
