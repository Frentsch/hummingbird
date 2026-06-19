import type { ConnectRouter } from '@connectrpc/connect';
import { AccountService } from './gen/hummingbird/v1/account_connect.js';
import { MarketplaceService } from './gen/hummingbird/v1/marketplace_connect.js';
import { RedemptionService } from './gen/hummingbird/v1/redemption_connect.js';
import { accountServiceImpl } from './handlers/account.js';
import { createMarketplaceServiceImpl } from './handlers/marketplace.js';
import { createRedemptionServiceImpl } from './handlers/redemption.js';
import { createRegistrationServiceImpl } from './handlers/registration.js';
import type { AppState } from '../state.js';

export function createRpcRoutes(state: AppState) {
  return (router: ConnectRouter) => {
    router.service(AccountService, {
      ...accountServiceImpl,
      ...createRegistrationServiceImpl(state),
    });
    router.service(MarketplaceService, createMarketplaceServiceImpl(state));
    router.service(RedemptionService, createRedemptionServiceImpl(state));
  };
}
