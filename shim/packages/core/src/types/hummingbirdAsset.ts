import { getObjectFields } from '../helpers.js';

/**
 * Mirrors the `HummingbirdAsset` Move struct (hummingbird_asset.move).
 * u64 fields are bigint; Option<u16> fields are number | null.
 */
export interface HummingbirdAsset {
  id: string;
  isdAsId: bigint;
  ifIngressId: number | null;
  ifEgressId: number | null;
  bandwidth: bigint;
  startTime: bigint;
  expTime: bigint;
  timeGranularity: bigint;
  timeMinDuration: bigint;
  minBandwidth: bigint;
  issuer: string;
}

/**
 * Parse a HummingbirdAsset from its flat GraphQL JSON fields.
 * Works both for a top-level HummingbirdAsset object and for the nested
 * `asset` field of an AssetListing.
 */
export function parseHummingbirdAssetFields(fields: Record<string, unknown>): HummingbirdAsset {
  return {
    id: fields['id'] as string,
    isdAsId: BigInt(fields['isd_as_id'] as string),
    ifIngressId: (fields['if_ingress_id'] as number | null) ?? null,
    ifEgressId: (fields['if_egress_id'] as number | null) ?? null,
    bandwidth: BigInt(fields['bandwidth'] as string),
    startTime: BigInt(fields['start_time'] as string),
    expTime: BigInt(fields['exp_time'] as string),
    timeGranularity: BigInt(fields['time_granularity'] as string),
    timeMinDuration: BigInt(fields['time_min_duration'] as string),
    minBandwidth: BigInt(fields['min_bandwidth'] as string),
    issuer: fields['issuer'] as string,
  };
}

/**
 * Extract a HummingbirdAsset from a getObject/listOwnedObjects result
 * (fetched with `include: { json: true }`).
 */
export function getHummingbirdAsset(obj: { object: { json: Record<string, unknown> | null } }): HummingbirdAsset {
  return parseHummingbirdAssetFields(getObjectFields(obj));
}
