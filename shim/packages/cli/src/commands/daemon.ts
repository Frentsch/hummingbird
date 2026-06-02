import { Command } from 'commander';
import { startServer } from '@sui-shim/server';

export function makeDaemonCommand(): Command {
  return new Command('daemon')
    .description('Start the HTTP and ConnectRPC servers')
    .option('-c, --config <path>', 'Path to shim.toml config file', 'shim.toml')
    .action(async (opts: { config: string }) => {
      await startServer(opts.config);
    });
}
