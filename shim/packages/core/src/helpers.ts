import type { TxResult } from "./execute.js";
import { SuiTransactionError } from "./errors.js";

/** Parse a SCION ISD-AS string (e.g. "1-ff00:0:110") into a u64 bigint. */
export function isdAsIdToU64(ia: string): bigint {
    const dash = ia.indexOf('-');
    if (dash === -1) throw new Error(`Invalid ISD-AS format: "${ia}"`);
    const isd = BigInt(ia.slice(0, dash));
    const parts = ia.slice(dash + 1).split(':');
    if (parts.length !== 3) throw new Error(`Invalid ISD-AS format: "${ia}"`);
    const a1 = BigInt('0x' + parts[0]);
    const a2 = BigInt('0x' + parts[1]);
    const a3 = BigInt('0x' + parts[2]);
    return (isd << 48n) | (a1 << 32n) | (a2 << 16n) | a3;
}

/** Format a u64 bigint as a SCION ISD-AS string (e.g. "1-ff00:0:110"). */
export function u64ToIsdAsId(ia: bigint): string {
    const isd = (ia >> 48n) & 0xffffn;
    const a1  = (ia >> 32n) & 0xffffn;
    const a2  = (ia >> 16n) & 0xffffn;
    const a3  =  ia         & 0xffffn;
    return `${isd}-${a1.toString(16)}:${a2.toString(16)}:${a3.toString(16)}`;
}

export function extractCreatedObjectId(result: TxResult, objectType: string): string {
    const match = result.effects.changedObjects.find(
        c => c.idOperation === 'Created' && result.objectTypes[c.objectId] === objectType,
    );
    if (!match) throw new SuiTransactionError(`No created object of type ${objectType} found`);
    return match.objectId;
}

export function getObjectType(packageId: string, module: string, type: string): string {
    return packageId.concat("::", module, "::", type);
}

/**
 * Extract the Interface object ID stored in an AssetListing's `interface` field.
 * Expects the result of getObject({ ..., include: { json: true } }).
 */
export function listingInterfaceId(obj: { object: { json: Record<string, unknown> | null } }): string {
    const json = obj.object.json;
    if (!json) throw new SuiTransactionError('Object not found or has no json content');
    return json['interface'] as string;
}

/**
 * Return the top-level Move struct fields as a plain record.
 * Expects the result of getObject({ ..., include: { json: true } }).
 * In the GraphQL API, `json` is already the flat struct — no `fields` wrapper.
 */
export function getObjectFields(obj: { object: { json: Record<string, unknown> | null } }): Record<string, unknown> {
    return obj.object.json ?? {};
}
