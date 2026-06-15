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

/** Map a raw SuiObjectResponse for a HummingbirdAsset (owned) to an RPC Asset. */
export function SuiToRpcAsset(obj: any): Asset {
    const objectId = obj.data!.objectId as string;
    const fields = (obj.data!.content as { dataType: 'moveObject'; fields: Record<string, unknown> }).fields;
    return assetFromFields(objectId, fields, 0n);
}



/** Map a raw SuiObjectResponse for an AssetListing<COIN> (marketplace) to an RPC Asset.
 *  The listing's object ID is used as assetId so buyers can reference it in BuyAssets. */
export function ListingToQueryAsset(obj: any): Asset {
    const objectId = obj.data!.objectId as string;
    const fields = (obj.data!.content as { dataType: 'moveObject'; fields: Record<string, unknown> }).fields;
    const assetFields = (fields['asset'] as { fields: Record<string, unknown> }).fields;
    const price = BigInt(fields['price'] as string);
    return assetFromFields(objectId, assetFields, price);
}

export function BigIntToUID(id: BigInt){
    return '0x' + id.toString(16).padStart(64, '0');
}
