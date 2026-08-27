import type { ServiceImpl } from '@connectrpc/connect';
import type { AccountService as IAccountService } from '../gen/hummingbird/v1/account_connect.js';
import { JWTResetResponse } from '../gen/hummingbird/v1/account_pb.js';

export const accountServiceImpl: Partial<ServiceImpl<typeof IAccountService>> = {
  resetJWT(_req, ctx) {
    return new JWTResetResponse();
  },
};
