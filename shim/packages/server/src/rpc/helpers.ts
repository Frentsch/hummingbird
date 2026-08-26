import { SearchAsset } from "./gen/hummingbird/v1/marketplace_pb.js";
import { Timestamp } from '@bufbuild/protobuf';
import { parseHummingbirdAssetFields } from '@sui-shim/core';

function assetFromFields(objectId: string, assetFields: Record<string, unknown>, price: number): SearchAsset {
    const asset = parseHummingbirdAssetFields(assetFields);
    return new SearchAsset({
        assetId: suiHexToBytes(objectId),
        ia: asset.isdAsId,
        ...(asset.ifIngressId !== null ? { ifIdIngress: asset.ifIngressId } : {}),
        ...(asset.ifEgressId !== null ? { ifIdEgress: asset.ifEgressId } : {}),
        bandwidth: Number(asset.bandwidth),
        bandwidthMin: 0,
        bandwidthMax: Number(asset.bandwidth),
        startsAt: new Timestamp({ seconds: asset.startTime }),
        stopsAt: new Timestamp({ seconds: asset.expTime }),
        timeGranularity: Number(asset.timeGranularity),
        timeMinDuration: asset.timeMinDuration,
        timeMaxDuration: 0,
        price,
    });
}

/**
 * Map a GraphQL object (from getObject/listOwnedObjects with json: true) for
 * a HummingbirdAsset to an RPC Asset.
 * GraphQL JSON: structs are plain objects, no `fields` wrapper.
 */
export function SuiToRpcAsset(obj: { objectId: string; json: Record<string, unknown> | null }): SearchAsset {
    const fields = obj.json ?? {};
    return assetFromFields(obj.objectId, fields, 0);
}

/**
 * Map a GraphQL object for an AssetListing<COIN> to an RPC Asset.
 * GraphQL JSON: `asset` is a plain struct object (no `fields` wrapper).
 * UID values are canonical address strings.
 */
export function ListingToQueryAsset(obj: { objectId: string; json: Record<string, unknown> | null }): SearchAsset {
    const fields = obj.json ?? {};
    const assetFields = fields['asset'] as Record<string, unknown>;
    console.log("asset fields:");
    console.log(assetFields);
    const price = Number(fields['price']);
    return assetFromFields(obj.objectId, assetFields, price);
}

export function BigIntToUID(id: BigInt) {
    return '0x' + id.toString(16).padStart(64, '0');
}

export function bytesToSuiHex(bytes: Uint8Array): string {
  return '0x' + Buffer.from(bytes).toString('hex').padStart(64,"0")
}

export function suiHexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(Buffer.from(hex.substring(2), 'hex'))
}