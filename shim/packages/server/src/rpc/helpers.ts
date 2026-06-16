import { Asset, AssetType } from "./gen/hummingbird/v1/marketplace_pb.js";
import { Timestamp } from '@bufbuild/protobuf';

function assetFromFields(objectId: string, assetFields: Record<string, unknown>, price: bigint): Asset {
    const interfaceType = Number(assetFields['interface_type']);
    const interfaceId = Number(assetFields['interface_id']);
    const start = BigInt(assetFields['start_time'] as string);
    const exp = BigInt(assetFields['exp_time'] as string);
    return new Asset({
        assetId: BigInt(objectId).toString(),
        ia: BigInt(assetFields['isd_as_id'] as string),
        assetType: interfaceType === 0 ? AssetType.Ingress : AssetType.Egress,
        ...(interfaceType === 0 ? { ifIdIngress: interfaceId } : {}),
        ...(interfaceType === 1 ? { ifIdEgress: interfaceId } : {}),
        bw: BigInt(assetFields['bandwidth'] as string),
        startsAt: new Timestamp({ seconds: start, nanos: Number(start % 1000n) * 1_000_000 }),
        stopsAt: new Timestamp({ seconds: exp, nanos: Number(exp % 1000n) * 1_000_000 }),
        timeGranularity: BigInt(assetFields['time_granularity'] as string),
        price,
    });
}

/**
 * Map a GraphQL object (from getObject/listOwnedObjects with json: true) for
 * a HummingbirdAsset to an RPC Asset.
 * GraphQL JSON: structs are plain objects, no `fields` wrapper.
 */
export function SuiToRpcAsset(obj: { objectId: string; json: Record<string, unknown> | null }): Asset {
    const fields = obj.json ?? {};
    return assetFromFields(obj.objectId, fields, 0n);
}

/**
 * Map a GraphQL object for an AssetListing<COIN> to an RPC Asset.
 * GraphQL JSON: `asset` is a plain struct object (no `fields` wrapper).
 * UID values are canonical address strings.
 */
export function ListingToQueryAsset(obj: { objectId: string; json: Record<string, unknown> | null }): Asset {
    const fields = obj.json ?? {};
    const assetFields = fields['asset'] as Record<string, unknown>;
    const price = BigInt(fields['price'] as string);
    return assetFromFields(obj.objectId, assetFields, price);
}

export function BigIntToUID(id: BigInt) {
    return '0x' + id.toString(16).padStart(64, '0');
}
