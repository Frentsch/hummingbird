import { Code, ConnectError } from '@connectrpc/connect';
import type { Interceptor } from '@connectrpc/connect';
import { callers } from '../callers.js';
import { AccountService } from './gen/hummingbird/v1/account_connect.js';

const EXEMPT_SERVICE = AccountService.typeName;

export const authInterceptor: Interceptor = (next) => async (req) => {
  if (req.service.typeName === EXEMPT_SERVICE) {
    return next(req);
  }
  const authHeader = req.header.get('Authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!callers.has(token)) {
    //skip auth for now
    //throw new ConnectError('Missing or invalid authorization token', Code.Unauthenticated);
  }
  return next(req);
};
