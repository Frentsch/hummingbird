import { Command } from 'commander';
import { KeystoreError, loadKeypairs } from '@sui-shim/core';
import { loadConfig } from '@sui-shim/core';
import { type CliCtx } from '../ctx.js';

export function makeKeysCommand(): Command {
  const keys = new Command('keys').description('Manage the Sui keystore');

  keys.addCommand(
    new Command('list')
      .description('List all Sui addresses in the keystore')
      .option('-c, --config <path>', 'Path to shim.toml', 'shim.toml')
      .action(async (opts: { config: string }) => {
        const config = await loadConfig(opts.config);
        const keypairs = await loadKeypairs({ path: config.keystore.path });
        keypairs.forEach((kp, i) => {
          console.log(`[${i}] ${kp.toSuiAddress()}`);
        });
      }),
  );

  return keys;
}

export function getDefaultAddress(ctx : CliCtx) : string{
  if(ctx.config.keystore.address != null) return ctx.config.keystore.address!;
  if(ctx.keypairs.length >0 && ctx.keypairs[0] != null) return ctx.keypairs[0].toSuiAddress();
  throw new KeystoreError("No configured address found");
}
