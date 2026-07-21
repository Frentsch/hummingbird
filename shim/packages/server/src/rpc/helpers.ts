import { SearchAsset } from "./gen/hummingbird/v1/marketplace_pb.js";
import { Timestamp } from '@bufbuild/protobuf';

function assetFromFields(objectId: string, assetFields: Record<string, unknown>, price: number): SearchAsset {
    const ingressId = assetFields['if_ingress_id'] as number | null;
    const egressId = assetFields['if_egress_id'] as number | null;
    const start = BigInt(assetFields['start_time'] as string);
    const exp = BigInt(assetFields['exp_time'] as string);
    return new SearchAsset({
        assetId: BigInt(objectId).toString(),
        ia: BigInt(assetFields['isd_as_id'] as string),
        ...(ingressId ? { ifIdIngress: ingressId } : {}),
        ...(egressId ? { ifIdEgress: egressId } : {}),
        bandwidth: Number(assetFields['bandwidth']),
        bandwidthMin: 0,
        bandwidthMax: Number(assetFields['bandwidth']),
        startsAt: new Timestamp({ seconds: start}),
        stopsAt: new Timestamp({ seconds: exp}),
        timeGranularity: Number(assetFields['time_granularity']),
        timeMinDuration: 0,
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
