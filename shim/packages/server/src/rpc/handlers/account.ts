import type { ServiceImpl } from '@connectrpc/connect';
import type { AccountService as IAccountService } from '../gen/hummingbird/v1/account_connect.js';
import { JWTResetResponse } from '../gen/hummingbird/v1/account_pb.js';
import { callers } from '../../callers.js';

export const accountServiceImpl: Partial<ServiceImpl<typeof IAccountService>> = {
  resetJWT(_req, ctx) {
    const auth = ctx.requestHeader.get('Authorization') ?? '';
    const old = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (old) callers.delete(old);
    return new JWTResetResponse();
  },
};
