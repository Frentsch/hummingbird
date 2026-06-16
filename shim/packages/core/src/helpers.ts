import type { TxResult } from "./execute.js";
import { SuiTransactionError } from "./errors.js";

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
