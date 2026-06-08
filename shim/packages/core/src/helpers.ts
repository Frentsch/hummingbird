import type { TxResult } from "./execute.js";
import { SuiTransactionError } from "./errors.js";
import { string } from "zod";


export function extractCreatedObjectId(result: TxResult, objectType: string): string {
    console.log(result.objectChanges);
    const change = result.objectChanges.find(
        (c): c is Extract<(typeof result.objectChanges)[number], { type: 'created' }> =>
            c.type === 'created' && c.objectType === objectType
    );
    if (!change) throw new SuiTransactionError(`No created object of type ${objectType} found`);
    return change.objectId;
}


export function getObjectType(packageId: string, module: string, type: string) : string{
    return packageId.concat("::", module,"::", type);
}

/** Extract the Interface object ID stored in an AssetListing's `interface` field. */
export function listingInterfaceId(obj: any): string {
    const fields = (obj.data!.content as { dataType: 'moveObject'; fields: Record<string, unknown> }).fields;
    console.log(fields);
    return fields['interface'] as string;
}

export function getObjectFields(obj:any): Record<string, unknown> {
    return (obj.data!.content as {dataType: 'moveObject'; fields: Record<string, unknown>}).fields;
}

