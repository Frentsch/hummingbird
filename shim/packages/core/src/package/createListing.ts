import { Transaction } from '@mysten/sui/transactions';

export interface CreateListingParams {
  packageId: string;
  interfaceObjectId: string;
  asAuthCapId: string;
  sellerAuthTokenId: string;
  isdAsId: bigint;
  ingressId: number | undefined;
  egressId: number | undefined;
  bandwidth: number;
  startTime: bigint;
  expTime: bigint;
  routerOnly: boolean;
  timeGranularity: bigint;
  timeMinDuration: bigint;
  timeMaxDuration: bigint;
  minBandwidth: number;
  maxBandwidth: number;
  price: bigint;
  issuer: string;
  coinType: string;
}

export function buildCreateListing(tx: Transaction | undefined, params: CreateListingParams): Transaction {
  if(!tx) tx = new Transaction();

  const asset = tx.moveCall({
    target: `${params.packageId}::hummingbird_asset::issue`,
    arguments: [
      tx.object(params.asAuthCapId),
      tx.pure.u64(params.isdAsId),
      tx.pure.option('u32', params.ingressId),
      tx.pure.option('u32', params.egressId),
      tx.pure.u32(params.bandwidth),
      tx.pure.u64(params.startTime),
      tx.pure.u64(params.expTime),
      tx.pure.bool(params.routerOnly),
      tx.pure.u64(params.timeGranularity),
      tx.pure.u64(params.timeMinDuration),
      tx.pure.u64(params.timeMaxDuration), 
      tx.pure.u32(params.minBandwidth),
      tx.pure.u32(params.maxBandwidth),
      tx.pure.address(params.issuer),
      tx.object("0x6"), //clock
    ],
  });

  tx.moveCall({
    target: `${params.packageId}::marketplace::create_listing`,
    typeArguments: [params.coinType],
    arguments: [
      tx.object(params.interfaceObjectId),
      asset,
      tx.pure.u64(params.price),
      tx.object(params.sellerAuthTokenId),
    ],
  });

  return tx;
}
