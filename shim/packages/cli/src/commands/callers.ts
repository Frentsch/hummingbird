import { Command } from 'commander';
import { loadConfig } from '@sui-shim/core';

async function httpRequest(
  method: string,
  url: string,
  token: string,
  body?: unknown,
): Promise<unknown> {
  const init: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
  return JSON.parse(text);
}

async function getBaseUrl(configPath: string): Promise<{ url: string; token: string }> {
  const config = await loadConfig(configPath);
  return {
    url: `http://localhost:${config.http.port}`,
    token: config.http.token,
  };
}

export function makeCallersCommand(): Command {
  const callers = new Command('callers').description('Manage authorized API callers on a running daemon');

  callers.addCommand(
    new Command('list')
      .description('List all authorized caller keys')
      .option('-c, --config <path>', 'Path to shim.toml', 'shim.toml')
      .action(async (opts: { config: string }) => {
        const { url, token } = await getBaseUrl(opts.config);
        const result = await httpRequest('GET', `${url}/callers`, token) as { callers: string[] };
        if (result.callers.length === 0) {
          console.log('(no callers registered)');
        } else {
          result.callers.forEach((k) => console.log(k));
        }
      }),
  );

  callers.addCommand(
    new Command('add')
      .description('Add an authorized caller key')
      .argument('<key>', 'API key to authorize (min 8 chars)')
      .option('-c, --config <path>', 'Path to shim.toml', 'shim.toml')
      .action(async (key: string, opts: { config: string }) => {
        const { url, token } = await getBaseUrl(opts.config);
        await httpRequest('POST', `${url}/callers`, token, { key });
        console.log(`Added caller: ${key}`);
      }),
  );

  callers.addCommand(
    new Command('remove')
      .description('Remove an authorized caller key')
      .argument('<key>', 'API key to remove')
      .option('-c, --config <path>', 'Path to shim.toml', 'shim.toml')
      .action(async (key: string, opts: { config: string }) => {
        const { url, token } = await getBaseUrl(opts.config);
        await httpRequest('DELETE', `${url}/callers/${encodeURIComponent(key)}`, token);
        console.log(`Removed caller: ${key}`);
      }),
  );

  return callers;
}
