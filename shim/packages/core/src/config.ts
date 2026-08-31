import { readFile, writeFile } from 'node:fs/promises';
import { parse, stringify } from 'smol-toml';
import { z } from 'zod';

const NetworkSchema = z.enum(['testnet', 'mainnet', 'devnet', 'localnet']);

export const DEFAULT_CONFIG_PATH = './shim.toml';

export const ConfigSchema = z.object({
  sui: z.object({
    network: NetworkSchema,
    grpcUrl: z.string().optional(),
    gasBudget: z.number().int().min(0).default(5_000_000),
    keystorePath: z.string(),
    packageId: z.string(),
    globalRegistryId: z.string()
  }),
  as: z.object({
    isdAsId: z.string().optional(),
    asRegistryId: z.string().optional(),
    asAuthCapId: z.string().optional(),
    sellerAuthTokenId: z.string().optional(),
    interfaces: z.array(z.string()).optional(),
    walletAddress: z.string().optional(),
  }),
  client: z.object({
    timeoutSecs: z.number().int().min(1).default(60).default(60),
    encryptionKeyPath: z.string(),
    walletAddress: z.string().optional(),
  }),
  market: z.object({
    authServerUrl: z.string(),
    grpcPort: z.number().int().min(1).max(65535).default(9091),
    dbPath: z.string(),
    coinType: z.string().default("0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI"),
    coinExponent: z.int().default(9),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;

export async function loadConfig(path?: string): Promise<Config> {
  path = path ?? DEFAULT_CONFIG_PATH;
  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch (err) {
    throw new Error(`Cannot read config file at ${path}: ${String(err)}`);
  }

  let parsed: unknown;
  try {
    parsed = parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse TOML config at ${path}: ${String(err)}`);
  }

  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid config at ${path}:\n${issues}`);
  }
  return result.data;
}

export async function saveConfig(config: Config, path?: string, ): Promise<void> {
  await writeFile(path??DEFAULT_CONFIG_PATH, stringify(config), 'utf-8');
}
