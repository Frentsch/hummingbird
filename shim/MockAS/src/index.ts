import { loadConfig } from '@sui-shim/core';
import { startRedeemService } from './redeem-service.js';

async function main(): Promise<void> {
  console.log("starting mock AS...")
  const config = await loadConfig(process.env['SHIM_CONFIG'] ?? 'mock-as.toml');
  await startRedeemService(config.market.grpcPort);
}

main().catch((err) => {
  console.error('[MockAS] fatal error:', err);
  process.exit(1);
});
