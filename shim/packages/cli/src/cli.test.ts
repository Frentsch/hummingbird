import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import { makeDaemonCommand } from './commands/daemon.js';
import { makeCallCommand } from './commands/call.js';
import { makeCallersCommand } from './commands/callers.js';
import { makeKeysCommand } from './commands/keys.js';

function makeTestProgram(): Command {
  return new Command('sui-shim')
    .exitOverride()
    .addCommand(makeDaemonCommand())
    .addCommand(makeCallCommand())
    .addCommand(makeCallersCommand())
    .addCommand(makeKeysCommand());
}

describe('CLI command structure', () => {
  it('program has daemon command', () => {
    const prog = makeTestProgram();
    const cmd = prog.commands.find((c) => c.name() === 'daemon');
    expect(cmd).toBeDefined();
  });

  it('program has call command with 8 subcommands', () => {
    const prog = makeTestProgram();
    const call = prog.commands.find((c) => c.name() === 'call');
    expect(call).toBeDefined();
    const subNames = call!.commands.map((c) => c.name());
    expect(subNames).toContain('register-as');
    expect(subNames).toContain('register-seller');
    expect(subNames).toContain('create-interface');
    expect(subNames).toContain('create-listing');
    expect(subNames).toContain('buy-and-take');
    expect(subNames).toContain('redeem');
    expect(subNames).toContain('deliver-reservation');
    expect(subNames).toContain('delist-and-take');
    expect(subNames).toHaveLength(8);
  });

  it('program has callers command with list/add/remove subcommands', () => {
    const prog = makeTestProgram();
    const callers = prog.commands.find((c) => c.name() === 'callers');
    expect(callers).toBeDefined();
    const subNames = callers!.commands.map((c) => c.name());
    expect(subNames).toContain('list');
    expect(subNames).toContain('add');
    expect(subNames).toContain('remove');
  });

  it('program has keys command with list subcommand', () => {
    const prog = makeTestProgram();
    const keys = prog.commands.find((c) => c.name() === 'keys');
    expect(keys).toBeDefined();
    const subNames = keys!.commands.map((c) => c.name());
    expect(subNames).toContain('list');
  });

  it('call register-as has required options', () => {
    const prog = makeTestProgram();
    const registerAs = prog.commands
      .find((c) => c.name() === 'call')!
      .commands.find((c) => c.name() === 'register-as')!;

    const opts = registerAs.options.map((o) => o.long);
    expect(opts).toContain('--global-registry-id');
    expect(opts).toContain('--isd-as-id');
    expect(opts).toContain('--config');
  });

  it('call buy-and-take has required options', () => {
    const prog = makeTestProgram();
    const buyAndTake = prog.commands
      .find((c) => c.name() === 'call')!
      .commands.find((c) => c.name() === 'buy-and-take')!;

    const opts = buyAndTake.options.map((o) => o.long);
    expect(opts).toContain('--interface-object-id');
    expect(opts).toContain('--listing-id');
    expect(opts).toContain('--payment-coin-id');
    expect(opts).toContain('--coin-type');
  });

  it('daemon uses default config path shim.toml', () => {
    const prog = makeTestProgram();
    const daemon = prog.commands.find((c) => c.name() === 'daemon')!;
    const configOpt = daemon.options.find((o) => o.long === '--config');
    expect(configOpt?.defaultValue).toBe('shim.toml');
  });
});
