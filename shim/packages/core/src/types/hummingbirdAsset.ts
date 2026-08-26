import { getObjectFields } from '../helpers.js';

/**
 * Mirrors the `HummingbirdAsset` Move struct (hummingbird_asset.move).
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
  timeMinDuration: number;
  timeMaxDuration: number;
  minBandwidth: number;
  maxBandwidth: number;
  issuer: string;
}

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
    timeMinDuration: Number(fields['time_min_duration'] as string),
    timeMaxDuration: Number(fields['time_max_duration'] as string),
    minBandwidth: Number(fields['bandwidth_min'] as string),
    maxBandwidth: Number(fields['bandwidth_max'] as string),
    issuer: fields['issuer'] as string,
  };
}

export function getHummingbirdAsset(obj: { object: { json: Record<string, unknown> | null } }): HummingbirdAsset {
  return parseHummingbirdAssetFields(getObjectFields(obj));
}
