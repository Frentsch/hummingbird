import { deriveObjectID, fromBase64 } from '@mysten/sui/utils';
import type { SuiJsonRpcClient } from '../sui-client.js';
import { bcs } from '@mysten/sui/bcs';

export async function getAllListingsOf(interfaceId: string, client: SuiJsonRpcClient): Promise<any>{
    // Fetch the Interface object to locate the listings ObjectBag
    const interfaceObj = await client.getObject({
        id: interfaceId,
        options: { showContent: true },
    });
    if (!interfaceObj.data?.content || interfaceObj.data.content.dataType !== 'moveObject') {
        return [];
    }
    // Extract the ObjectBag ID from Interface.listings
    const interfaceFields = (interfaceObj.data.content as { dataType: 'moveObject'; fields: Record<string, unknown> }).fields;
    const bagId = ((interfaceFields['listings'] as { fields: { id: { id: string } } }).fields.id.id);
    
    // Paginate through all dynamic fields of the ObjectBag to collect listing IDs
    const listingIds: string[] = [];
    let cursor: string | null = null;
    do {
        const page = await client.getDynamicFields({ parentId: bagId, cursor });
        listingIds.push(...page.data.map(f => f.objectId));
        cursor = page.hasNextPage ? (page.nextCursor ?? null) : null;
    } while (cursor !== null);

    if (listingIds.length === 0) {
        [];
    }

    // Batch-fetch all listing objects with their content
    const listingObjs = await client.multiGetObjects({
        ids: listingIds,
        options: { showContent: true },
    });
    return listingObjs;
}

export async function getAllInterfacesOf(asRegsitryid: string, client: SuiJsonRpcClient): Promise<string[]>{

    const registryObj = await client.getObject({
        id: asRegsitryid,
        options: { showContent: true },
    });

    if (!registryObj.data?.content || registryObj.data.content.dataType !== 'moveObject') {
        return [];
    }
    // Extract the ObjectBag ID from Interface.listings
    const registryFields = (registryObj.data.content as { dataType: 'moveObject'; fields: Record<string, unknown> }).fields;

    const bagId = ((registryFields['interfaces'] as { fields: { id: { id: string } } }).fields.id.id);
 
    // Paginate through all dynamic fields of the Table to collect listing IDs
    const interfaceIds: string[] = [];
    let cursor: string | null = null;
    do {
        const page = await client.getDynamicFields({ parentId: bagId, cursor });
        interfaceIds.push(...page.data.map(f => {
            const iid = bcs.U16.fromBase64(f.bcsName);
            const addr = deriveObjectID(asRegsitryid,'u16' ,fromBase64(f.bcsName));
            return addr;
            }
        ));
        cursor = page.hasNextPage ? (page.nextCursor ?? null) : null;
    } while (cursor !== null);
    return interfaceIds;
}

export async function getAllRegistries(globalRegistryId: string, client: SuiJsonRpcClient): Promise<string[]>{
    const registryObj = await client.getObject({
        id: globalRegistryId,
        options: { showContent: true },
    });

    if (!registryObj.data?.content || registryObj.data.content.dataType !== 'moveObject') {
        return [];
    }
    // Extract the ObjectBag ID from Interface.listings
    const registryFields = (registryObj.data.content as { dataType: 'moveObject'; fields: Record<string, unknown> }).fields;
  
    const bagId = ((registryFields['as_registries'] as { fields: { id: { id: string } } }).fields.id.id);

    // Paginate through all dynamic fields of the ObjectBag to collect listing IDs
    const registryIds: string[] = [];
    let cursor: string | null = null;
    do {
        const page = await client.getDynamicFields({ parentId: bagId, cursor });
        registryIds.push(...page.data.map(f => deriveObjectID(globalRegistryId,'u64' ,fromBase64(f.bcsName))));
        cursor = page.hasNextPage ? (page.nextCursor ?? null) : null;
    } while (cursor !== null);

    return registryIds;
}