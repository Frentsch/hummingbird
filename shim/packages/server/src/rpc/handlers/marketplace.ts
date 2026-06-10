import { Code, ConnectError } from '@connectrpc/connect';
import type { ServiceImpl } from '@connectrpc/connect';
import type { MarketplaceService as IMarketplaceService } from '../gen/hummingbird/v1/marketplace_connect.js';
import {
  MarketplaceInfoResponse,
  PublishAssetResponse,
  SearchAssetsResponse,
  Asset,
  AssetType,
  BuyAssetsResponse,
  BoughtAsset,
  RedeemAssetResponse,
  FetchReservationsResponse,
  SplitAssetResponse,
  CombineAssetResponse,
} from '../gen/hummingbird/v1/marketplace_pb.js';
import { Timestamp } from '@bufbuild/protobuf';
import { deriveObjectID } from '@mysten/sui/utils';
import { bcs } from '@mysten/sui/bcs';
import {
  buildCreateListing,
  buildBuyAndTake,
  buildRedeem,
  DEFAULT_COIN_TYPE,
  executeTransaction,
  getObjectType,
  extractCreatedObjectId,
  listingInterfaceId,
  getObjectFields,
  getAllListingsOf,
  getAllInterfacesOf,
  getAllRegistries,
  DeliveryTimeoutError,
} from '@sui-shim/core';
import type { AppState } from '../../state.js';
import { ListingToQueryAsset, SuiToRpcAsset } from '../helpers.js';

const API_MAJOR_VERSION = 0n;
const API_MINOR_VERSION = 1n;

export function createMarketplaceServiceImpl(state: AppState): Partial<ServiceImpl<typeof IMarketplaceService>> {
  return {
    info(_req, _ctx) {
      console.log("info request");
      return new MarketplaceInfoResponse({
        apiMajorVersion: API_MAJOR_VERSION,
        apiMinorVersion: API_MINOR_VERSION,
        currency: DEFAULT_COIN_TYPE,
      });
    },

    async publishAsset(req, _ctx) {
      if (req.ifIdIngress === undefined && req.ifIdEgress === undefined) {
        throw new ConnectError('At least one of if_id_ingress or if_id_egress must be set', Code.InvalidArgument);
      }

      // Resolve the interface object ID from state
      const ifId = req.ifIdIngress ?? req.ifIdEgress!;
      const interfaceObjectId = state.interfaceObjects.get(ifId);
      if (!interfaceObjectId) {
        throw new ConnectError(`Interface ${ifId} not registered on this daemon`, Code.NotFound);
      }

      const startMs = req.startAt ? Number(req.startAt.seconds) * 1000 : Date.now();
      const stopMs = req.stopsAt ? Number(req.stopsAt.seconds) * 1000 : startMs + 3600_000;

      const tx = buildCreateListing({
        packageId: state.packageId,
        interfaceObjectId,
        interfaceType: req.ifIdIngress ? 0: 1,
        asAuthCapId: state.asAuthCapId,
        sellerAuthTokenId: state.sellerAuthTokenId,
        bandwidth: req.bandwidth as bigint,
        startTime: BigInt(Math.floor(startMs)),
        expTime: BigInt(Math.floor(stopMs)),
        timeGranularity: req.timeGranularity as bigint,
        minBandwidth: req.bandwidthMin as bigint,
        price: req.price as bigint,
        coinType: DEFAULT_COIN_TYPE,
      });

      const result = await executeTransaction(
        state.client as Parameters<typeof executeTransaction>[0],
        state.signer,
        tx,
      );

      // The listing object ID is returned as a created object in effects.
      // Use its ID as an opaque asset_id encoded as BigInt of the hex.
      const created = result.effects.created?.[0]?.reference?.objectId ?? '0x0';
      const assetId = BigInt(created);

      return new PublishAssetResponse({ assetId: created });
    },

    async searchAssets(_req, _ctx) {
      if (_req.owned) {
        const result = await state.client.getOwnedObjects({
          owner: state.signer.getPublicKey().toSuiAddress(),
          filter: {
            StructType: getObjectType(state.config.package.id, "hummingbird_asset", "HummingbirdAsset"),
          },
          options: {
            showType: true,
            showContent: true,
          },
        });

        const ownedAssets: Asset[] = result.data
          .filter((obj: any) => obj.data?.content?.dataType === 'moveObject')
          .map((obj: any) => SuiToRpcAsset(obj)
          );
        
        return new SearchAssetsResponse({ owned: _req.owned, assets: ownedAssets });
      }else{
        function ListingsToAssets(listings: any[]) {
          return listings.filter((obj: { data: { content: { dataType: string; }; }; }) => obj.data?.content?.dataType === 'moveObject').map(obj => ListingToQueryAsset(obj));
        };
        if(_req.ia){
          const isdAsId = _req.ia;
          // Derive AsRegistry from GlobalRegistry + isdAsId
          const asRegistryId = deriveObjectID(
            state.globalRegistryId,
            'u64',
            bcs.U64.serialize(BigInt(isdAsId)).toBytes(),
          );
          console.log(`[debug] asRegistryId ${asRegistryId}`);

          if(_req.ifIdIngress || _req.ifIdEgress){
            console.log("Find specific Interface");
            // Find specific as-interface
            const interfaceId = _req.ifIdIngress ?? _req.ifIdEgress;
            if (isdAsId === undefined || interfaceId === undefined) throw new ConnectError("ia and interface id must be specified", Code.InvalidArgument);
            

            // Derive Interface from AsRegistry + interfaceId
            const interfaceObjId = deriveObjectID(
              asRegistryId,
              'u16',
              bcs.U16.serialize(interfaceId).toBytes(),
            );
            console.log(`Interface: ${interfaceObjId}`);

            const listingObjs = await getAllListingsOf(interfaceObjId, state.client);
            console.log(listingObjs);
            /*const assets: Asset[] = listingObjs
              .filter((obj: { data: { content: { dataType: string; }; }; }) => obj.data?.content?.dataType === 'moveObject')
              .map((obj: any) => ListingToQueryAsset(obj));*/
            
            const assets: Asset[] = ListingsToAssets(listingObjs);
            return new SearchAssetsResponse({ owned: _req.owned, assets });
          }else{
            try{
            //fetch all interfaces of the specified AS and add their listings
            const interfaceIds = await getAllInterfacesOf(asRegistryId, state.client);

            var listings: any[] = [];
            for(const interfaceId of interfaceIds){
              const ls = await getAllListingsOf(interfaceId, state.client);
              listings.push(...ls);
            }
            
            return new SearchAssetsResponse({ owned: _req.owned, assets: ListingsToAssets(listings)});
          }catch(error){
            console.log(error);
          }
          throw new ConnectError("Failed to fetch all Listings");
          }
        }else{
          //Fetch all Listings
          var result: any[] = [];
          try{
          const asRegistries = await getAllRegistries(state.globalRegistryId, state.client);
          for(const asRegistry of asRegistries){
            const interfaces = await getAllInterfacesOf(asRegistry,state.client);
            for(const interfaceId of interfaces){
              const listings = await getAllListingsOf(interfaceId, state.client);
              result.push(...listings);
            }
          }
          }catch (error){
            console.log(error);
          }
          return new SearchAssetsResponse({owned: _req.owned, assets: ListingsToAssets(result)});
        }
      }
    },


    async buyAssets(req, _ctx) {
      const bought: BoughtAsset[] = [];
      var totalPrice = 0;
      for (const asset of req.assets) {
        // asset.assetId encodes the object ID as string hex
        const listingId = '0x' + BigInt(asset.assetId).toString(16).padStart(64, '0');
        if(asset.startsAtExactly === undefined || asset.stopsAtExactly == undefined) throw new ConnectError(`must specifiy start and stop time for asset ${asset.assetId}`);
        if(asset.bwExact === undefined) throw new ConnectError("Must specify exact bandwidth");
        const start = Number(asset.startsAtExactly.seconds);
        const stop = Number(asset.stopsAtExactly.seconds);

        const listing = await state.client.getObject({ id: listingId, options: { showContent: true } });
        const fields = getObjectFields(listing);
        const interfaceObjectId = fields['interface'] as string;
        const assetId = (fields['asset'] as Record<string, any>)['fields']['id']['id'] as string;
        console.log(fields);
        console.log(assetId);
        //TODO extract coin type from listing type annotation
        //TODO build all transactions and buy in an atomic operation
        try{
          const result = await executeTransaction(
            state.client,
            state.signer,
            buildBuyAndTake({
              packageId: state.config.package.id,
              interfaceObjectId: interfaceObjectId,
              listingId: listingId,
              startTime: BigInt(start),
              expTime: BigInt(stop),
              bandwidth: BigInt(asset.bwExact),
              maxPrice: BigInt(req.maxPrice),
              coinType: DEFAULT_COIN_TYPE,
          }));
          console.log(result);
          const balanceChange = result.balanceChanges?.find((c:any) => c.owner.AddressOwner === state.signer.toSuiAddress());
          totalPrice -= Number(balanceChange?.amount ?? 0);
          bought.push(new BoughtAsset({assetId: BigInt(assetId).toString()}));
        }catch(error){
          console.log(error);
        }
      }

      return new BuyAssetsResponse({ assets: bought, cost: BigInt(totalPrice)});
    },

    async redeemAsset(req, _ctx) {
      const ingressId = '0x' + BigInt(req.ingressAssetId).toString(16).padStart(64, '0');
      const egressId = '0x' + BigInt(req.egressAssetId).toString(16).padStart(64, '0');

      // Generate a transient EC keypair public key placeholder — caller supplies actual key via HTTP
      const publicKey = new Uint8Array(32);

      const tx = buildRedeem({ packageId: state.packageId, ingressAssetId: ingressId, egressAssetId: egressId, publicKey });
      const result = await executeTransaction(
        state.client as Parameters<typeof executeTransaction>[0],
        state.signer,
        tx,
      );

      //TODO wait for redemption delivery, decrypt and send back
      return new RedeemAssetResponse({
        ak: "0x00",
        resId: BigInt(req.ingressAssetId),
        bwRounded: 0n,
        bwDataplaneEncoding: 0,
      });
    },

    fetchReservations(_req, _ctx) {
      return new FetchReservationsResponse({ reservations: [] });
    },

    splitAsset(_req, _ctx) {
      throw new ConnectError('splitAsset is not supported by the underlying Move contract', Code.Unimplemented);
    },

    combineAssets(_req, _ctx) {
      throw new ConnectError('combineAssets is not supported by the underlying Move contract', Code.Unimplemented);
    },
  };
}
