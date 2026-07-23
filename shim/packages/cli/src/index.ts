#!/usr/bin/env node
import { Command } from 'commander';
import { makeDaemonCommand } from './commands/daemon.js';
import { makeCallCommand } from './commands/call.js';
import { makeKeysCommand } from './commands/keys.js';
import { createReservationsCommand } from './commands/reservations.js';

const program = new Command('sui-shim')
  .description('Hummingbird Sui shim — daemon and tooling for AS operators')
  .version('0.0.1');

program.addCommand(makeDaemonCommand());
program.addCommand(makeCallCommand());
program.addCommand(makeKeysCommand());
program.addCommand(createReservationsCommand());

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error('Error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
