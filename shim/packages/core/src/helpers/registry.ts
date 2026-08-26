import { deriveObjectID } from '@mysten/sui/utils';
import type { SuiClientTypes } from '@mysten/sui/client';
import type { SuiGraphQLClient } from '../sui-client.js';
import { deriveIfIdFromAS } from '../helpers.js';

// In the GraphQL JSON representation:
//   - Structs are plain JSON objects (no `fields` wrapper)
//   - UID / ID values are canonical address strings (not { id: { id: "0x..." } })
//   - u64 values are JSON strings; u8/u16/u32 are JSON numbers

export async function getAllListingsOf(interfaceId: string, client: SuiGraphQLClient): Promise<any[]> {
    const interfaceObj = await client.getObject({ objectId: interfaceId, include: { json: true } }).catch((_)=>{});
    if(!interfaceObj) return [];
    const interfaceJson = interfaceObj.object.json;
    if (!interfaceJson) return [];

    // listings is a Bag { id: UID, size: u64 }; UID serialises as a canonical address string.
    const listingsBag = interfaceJson['listings'] as { id: string } | undefined;
    const bagId = listingsBag?.id;
    if (!bagId) return [];

    const listingIds: string[] = [];
    let cursor: string | null = null;
    while (true) {
        const result: SuiClientTypes.ListDynamicFieldsResponse = await client.listDynamicFields({ parentId: bagId, cursor });
        listingIds.push(...result.dynamicFields.map(f =>
            f.$kind === 'DynamicObject' ? f.childId : f.fieldId
        ));
        if (!result.hasNextPage) break;
        cursor = result.cursor;
    }

    if (listingIds.length === 0) return [];

    const { objects } = await client.getObjects({
        objectIds: listingIds,
        include: { json: true },
    });
    return objects;
}

export async function getAllInterfacesOf(asRegistryId: string, client: SuiGraphQLClient): Promise<string[]> {
    const registryObj = await client.getObject({ objectId: asRegistryId, include: { json: true } }).catch((_) => {});
    if(!registryObj) return []
    const registryJson = registryObj.object.json;
    if (!registryJson) return [];

    const interfacesBag = registryJson['interfaces'] as { id: string } | undefined;
    const bagId = interfacesBag?.id;
    if (!bagId) return [];

    const interfaceIds: string[] = [];
    let cursor: string | null = null;
    while (true) {
        const result: SuiClientTypes.ListDynamicFieldsResponse = await client.listDynamicFields({ parentId: bagId, cursor });
        interfaceIds.push(...result.dynamicFields.map(f => {
            return deriveObjectID(asRegistryId, 'u32', f.name.bcs);
        }));
        if (!result.hasNextPage) break;
        cursor = result.cursor;
    }

    return interfaceIds;
}

export async function getAllRegistries(globalRegistryId: string, client: SuiGraphQLClient): Promise<string[]> {
    const registryObj = await client.getObject({ objectId: globalRegistryId, include: { json: true } });
    const registryJson = registryObj.object.json;
    if (!registryJson) return [];

    const asRegistriesBag = registryJson['as_registries'] as { id: string } | undefined;
    const bagId = asRegistriesBag?.id;
    if (!bagId) return [];

    const registryIds: string[] = [];
    let cursor: string | null = null;
    while (true) {
        const result: SuiClientTypes.ListDynamicFieldsResponse = await client.listDynamicFields({ parentId: bagId, cursor });
        registryIds.push(...result.dynamicFields.map(f =>
            deriveObjectID(globalRegistryId, 'u64', f.name.bcs)
        ));
        if (!result.hasNextPage) break;
        cursor = result.cursor;
    }

    return registryIds;
}
