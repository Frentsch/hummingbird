import type { SuiJsonRpcClient } from '@sui-shim/core';

export async function getAllListingsOf(interfaceId: string, client: SuiJsonRpcClient): Promise<any>{
// Fetch the Interface object to locate the listings ObjectBag
    const interfaceObj = await client.getObject({
        id: interfaceId,
        options: { showContent: true },
    });
    if (!interfaceObj.data?.content || interfaceObj.data.content.dataType !== 'moveObject') {
        return [];
    }
    console.log(interfaceObj);
    // Extract the ObjectBag ID from Interface.listings
    const interfaceFields = (interfaceObj.data.content as { dataType: 'moveObject'; fields: Record<string, unknown> }).fields;
    console.log(interfaceFields);
    const bagId = ((interfaceFields['listings'] as { fields: { id: { id: string } } }).fields.id.id);
    console.log(bagId);
    // Paginate through all dynamic fields of the ObjectBag to collect listing IDs
    const listingIds: string[] = [];
    let cursor: string | null = null;
    do {
        const page = await client.getDynamicFields({ parentId: bagId, cursor });
        listingIds.push(...page.data.map(f => f.objectId));
        cursor = page.hasNextPage ? (page.nextCursor ?? null) : null;
    } while (cursor !== null);

    console.log(listingIds);
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
    console.log("Collecting Interfaces");
    const registryObj = await client.getObject({
        id: asRegsitryid,
        options: { showContent: true },
    });

    if (!registryObj.data?.content || registryObj.data.content.dataType !== 'moveObject') {
        return [];
    }
    // Extract the ObjectBag ID from Interface.listings
    const registryFields = (registryObj.data.content as { dataType: 'moveObject'; fields: Record<string, unknown> }).fields;
    console.log(registryFields);
    const bagId = ((registryFields['interfaces'] as { fields: { id: { id: string } } }).fields.id.id);

    // Paginate through all dynamic fields of the Table to collect listing IDs
    const interfaceIds: string[] = [];
    let cursor: string | null = null;
    do {
        const page = await client.getDynamicFields({ parentId: bagId, cursor });
        interfaceIds.push(...page.data.map(f => f.objectId));
        cursor = page.hasNextPage ? (page.nextCursor ?? null) : null;
    } while (cursor !== null);
    console.log("interface ids");
    console.log(interfaceIds);
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
    //TODO check if field is called asRegistries or as_registries in ts
    const bagId = ((registryFields['asRegistries'] as { fields: { id: { id: string } } }).fields.id.id);

    // Paginate through all dynamic fields of the ObjectBag to collect listing IDs
    const registryIds: string[] = [];
    let cursor: string | null = null;
    do {
        const page = await client.getDynamicFields({ parentId: bagId, cursor });
        registryIds.push(...page.data.map(f => f.objectId));
        cursor = page.hasNextPage ? (page.nextCursor ?? null) : null;
    } while (cursor !== null);

    return registryIds;
}