/** Default coin type for marketplace operations. */
export const DEFAULT_COIN_TYPE = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';

/** The networks the daemon can target. RPC URLs resolved by createSuiClient(). */
export type Network = 'mainnet' | 'testnet' | 'devnet' | 'localnet';

export const DEFAULT_NETWORK: Network = 'testnet';

export interface OperationDef {
  name: string;
  module: string;
  fn: string;
  /** Number of type arguments (0 or 1 for <COIN>). */
  typeArgCount: number;
}

/**
 * Fixed set of supported Move entry functions.
 */
export const OPERATIONS = {
  registerAs: {
    name: 'registerAs',
    module: 'registry',
    fn: 'register_as_to_sender',
    typeArgCount: 0,
  },
  registerSeller: {
    name: 'registerSeller',
    module: 'marketplace',
    fn: 'register_seller_to_sender',
    typeArgCount: 0,
  },
  // "createInterface" in the plan = create_interface in Move.
  // An Interface object represents the per-(isd_as_id, interface_id) "interface".
  createInterface: {
    name: 'createInterface',
    module: 'registry',
    fn: 'create_interface',
    typeArgCount: 0,
  },
  issueAsset: {
    name: 'issueAsset',
    module: 'hummingbird_asset',
    fn: 'issue',
    typeArgCount: 0,
  },
  createListing: {
    name: 'createListing',
    module: 'marketplace',
    fn: 'create_listing',
    typeArgCount: 1,
  },
  buyAndTake: {
    name: 'buyAndTake',
    module: 'marketplace',
    fn: 'buy_and_take',
    typeArgCount: 1,
  },
  redeem: {
    name: 'redeem',
    module: 'hummingbird_asset',
    fn: 'redeem',
    typeArgCount: 0,
  },
  deliverReservation: {
    name: 'deliverReservation',
    module: 'hummingbird_asset',
    fn: 'deliver_reservation',
    typeArgCount: 0,
  },
  delistAndTake: {
    name: 'delistAndTake',
    module: 'marketplace',
    fn: 'delist_and_take',
    typeArgCount: 1,
  },
  registerAsFor: {
    name: 'registerAsFor',
    module: 'registry',
    fn: 'register_as_for',
    typeArgCount: 0,
  },
} as const satisfies Record<string, OperationDef>;

export type OperationName = keyof typeof OPERATIONS;

export const OPERATION_NAMES = Object.keys(OPERATIONS) as OperationName[];

/** Fully-qualified Move target string, e.g. `0xABC::module::fn`. */
export function moveTarget(packageId: string, op: OperationName): `${string}::${string}::${string}` {
  const def = OPERATIONS[op];
  return `${packageId}::${def.module}::${def.fn}`;
}
