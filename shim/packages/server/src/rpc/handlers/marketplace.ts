import { Code, ConnectError } from '@connectrpc/connect';
import type { ServiceImpl } from '@connectrpc/connect';
import type { MarketplaceService as IMarketplaceService } from '../gen/hummingbird/v1/marketplace_connect.js';
import {
  MarketplaceInfoResponse,
  PublishAssetResponse,
  SearchAssetsRequest,
  SearchAssetsResponse,
  SearchAsset,
  BuyAssetsResponse,
  BoughtAsset,
  RedeemAssetResponse,
  FetchReservationsRequest,
  FetchReservationsResponse,
  SplitAssetResponse,
  CombineAssetResponse,
  Reservation,
  PricingStrategy,
  UpdateAssetsResponse,
} from '../gen/hummingbird/v1/marketplace_pb.js';
import { Timestamp } from '@bufbuild/protobuf';
import { Transaction } from '@mysten/sui/transactions';
import { SUI_DECIMALS } from '@mysten/sui/utils';
import { SimulationError } from '@mysten/sui/client';
import {
  buildCreateListing,
  addBuyAndTake,
  buildRedeem,
  DEFAULT_COIN_TYPE,
  executeTransaction,
  getObjectType,
  extractCreatedObjectId,
  getObjectFields,
  getAllListingsOf,
  getAllInterfacesOf,
  getAllRegistries,
  DeliveryTimeoutError,
  insertReservation,
  queryReservations,
  buildCreateInterface,
  isdAsIdToU64,
  buildRedeemPair,
  getHummingbirdAsset,
  openSealed,
  deriveIfIdFromAS,
  deriveRegistryId,
} from '@sui-shim/core';
import type { ReservationFilter, ReservationRow } from '@sui-shim/core';
import type { AppState } from '../../state.js';
import { bytesToSuiHex, ListingToQueryAsset, suiHexToBytes, SuiToRpcAsset } from '../helpers.js';
import { TextEncoder } from 'node:util';

const API_MAJOR_VERSION = 0;
const API_MINOR_VERSION = 1;

function filterAsset(asset: SearchAsset, req: SearchAssetsRequest): boolean {
  if (req.ia              !== undefined && asset.ia          !== req.ia)              return false;
  if (req.ifIdIngress     !== undefined && asset.ifIdIngress !== req.ifIdIngress)     return false;
  if (req.ifIdEgress      !== undefined && asset.ifIdEgress  !== req.ifIdEgress)      return false;
  if (req.minRequiredBw   !== undefined && asset.bandwidth          <  req.minRequiredBw)   return false;
  if (req.price           !== undefined && asset.price       >  req.price)            return false;
  if (req.startsAtLatest  !== undefined && asset.startsAt    !== undefined &&
      asset.startsAt.seconds > req.startsAtLatest.seconds)                            return false;
  if (req.stopsAtEarliest !== undefined && asset.stopsAt     !== undefined &&
      asset.stopsAt.seconds  < req.stopsAtEarliest.seconds)                           return false;
  return true;
}

function filterReservation(r: Reservation, req: FetchReservationsRequest): boolean {
  if (req.ia        !== undefined && r.ia        !== req.ia)        return false;
  if (req.ingressId !== undefined && r.ingressId !== req.ingressId) return false;
  if (req.egressId  !== undefined && r.egressId  !== req.egressId)  return false;
  if (req.bandwidth        !== undefined && r.bandwidth        !== req.bandwidth)        return false;
  if (req.startsAt  !== undefined && r.startsAt  !== undefined &&
      r.startsAt.seconds < req.startsAt.seconds)                    return false;
  if (req.stopsAt   !== undefined && r.stopsAt   !== undefined &&
      r.stopsAt.seconds  > req.stopsAt.seconds)                     return false;
  return true;
}



export function createMarketplaceServiceImpl(state: AppState): Partial<ServiceImpl<typeof IMarketplaceService>> {
  return {
    info(_req, _ctx) {
      console.log("info request");
      return new MarketplaceInfoResponse({
        apiMajorVersion: API_MAJOR_VERSION,
        apiMinorVersion: API_MINOR_VERSION,
        currency: DEFAULT_COIN_TYPE,
        currencyExponent: SUI_DECIMALS,
        maxStatisticsGranularity: 1,
        pricingStrategy: PricingStrategy.static_pricing,
        transactionFeeAbsolute: 0n,
        transactionFeeRelative: 0,
        splitCombineFeeAbsolute: 0n,
        supportsRedemptionDelegation: false,
        delegationHourlyFee: 0n,
      });
    },

    async updateAssets(req, _ctx) {
      const assetUpdates = req.assets; 
      for(const update of assetUpdates){
        const id = bytesToSuiHex(update.assetId)
        console.log(id)
      }
      return new UpdateAssetsResponse()
    },

    async publishAsset(req, _ctx) {
      const asset = req.asset;
      if(!asset) throw new ConnectError("Must specify Asset", Code.FailedPrecondition);
      if(!state.config.as.isdAsId || !state.config.as.asRegistryId || !state.config.as.asAuthCapId) throw new ConnectError('AS not registered.', Code.Unauthenticated);
      
      if(!state.config.package.globalRegistryId) throw new ConnectError('No marketplace configured. Set the globalRegistryId in the config', Code.NotFound);
      if (asset.ifIdIngress === undefined && asset.ifIdEgress === undefined) {
        throw new ConnectError('At least one of if_id_ingress or if_id_egress must be set', Code.InvalidArgument);
      }
      if(asset.bandwidth<=0) throw new ConnectError('Bandwidth must be at least 1', Code.FailedPrecondition);
      if(!asset.startsAt || !asset.stopsAt) throw new ConnectError('Must specify start and end time', Code.FailedPrecondition);
      if(asset.bandwidthMin>asset.bandwidth) throw new ConnectError('Min bandwidth may not exceed bandwidth', Code.FailedPrecondition);
      if(asset.timeMinDuration>asset.stopsAt.seconds-asset.startsAt.seconds) throw new ConnectError('Min time duration must be at most the total duration', Code.FailedPrecondition);
      const isdAsId = state.config.as.isdAsId;
      try{
      //create interface if not exists
      const ifId = asset.ifIdIngress ?? asset.ifIdEgress!;
      const interfaceObjectId = deriveIfIdFromAS(state.config.as.asRegistryId,ifId);
      console.log(interfaceObjectId);
      const { objects: [interfaceResult] } = await state.client.getObjects({ objectIds: [interfaceObjectId] });
      if (interfaceResult instanceof Error) {
        try{
          console.log(`generating new interface for ${ifId}`);
          await executeTransaction(state.client, state.signer,
            buildCreateInterface({
              packageId: state.config.package.id,
              asRegistryId: state.config.as.asRegistryId,
              asAuthCapId: state.config.as.asAuthCapId!,
              interfaceId: ifId,
            })
          );

          while(!await state.client.getObject({objectId: interfaceObjectId}).then(_ => true).catch(_ => false)){
              console.log("Newly created interface not yet registered on-chain. Wait before publishing asset...")
          }
        }catch(error){
          console.log(error);
          if (error instanceof SimulationError && error.executionError?.$kind === 'MoveAbort') {
            const {abortCode} = error.executionError.MoveAbort;
            
            if(abortCode=="2") throw new ConnectError('Unauthorized: invalid auth cap. Set the correct auth cap in the config', Code.FailedPrecondition);
          }else throw error;
        }
      }
      
      const tx = buildCreateListing({
        packageId: state.packageId,
        interfaceObjectId,
        ingressId: asset.ifIdIngress,
        egressId: asset.ifIdEgress,
        asAuthCapId: state.asAuthCapId,
        sellerAuthTokenId: state.sellerAuthTokenId,
        isdAsId: isdAsIdToU64(isdAsId),
        bandwidth: asset.bandwidth,
        startTime: asset.startsAt.seconds,
        expTime: asset.stopsAt.seconds,
        routerOnly: false,
        timeGranularity: BigInt(asset.timeGranularity),
        timeMinDuration: BigInt(asset.timeGranularity),
        timeMaxDuration: BigInt(asset.timeMaxDuration),
        minBandwidth: asset.bandwidthMin,
        maxBandwidth: asset.bandwidthMax,
        price: BigInt(asset.price),
        issuer: state.signer.getPublicKey().toSuiAddress(),
        coinType: DEFAULT_COIN_TYPE,
      });

        const result = await executeTransaction(state.client, state.signer, tx);

        const created = extractCreatedObjectId(
          result,
          getObjectType(state.packageId, 'marketplace', `AssetListing<${DEFAULT_COIN_TYPE}>`),
        );
        
        return new PublishAssetResponse({ assetId: suiHexToBytes(created) });
      }catch(error){
        console.log(error);
        if (error instanceof SimulationError && error.executionError?.$kind === 'MoveAbort') {
            const {abortCode} = error.executionError.MoveAbort;
            
            if(abortCode=="2") throw new ConnectError('Unauthorized: invalid auth cap. Make sure to register first', Code.FailedPrecondition);
          }else throw error;
        throw new ConnectError(`Failed to publish asset: ${error}`, Code.Internal);
      }
    },

    async searchAssets(_req, _ctx) {
      console.log("start asset search");
      var assets: SearchAsset[];
      if (_req.owned) {
        const result = await state.client.listOwnedObjects({
          owner: state.signer.getPublicKey().toSuiAddress(),
          type: getObjectType(state.config.package.id, "hummingbird_asset", "HummingbirdAsset"),
          include: { json: true },
        });

        const ownedAssets: SearchAsset[] = result.objects
          .filter((obj: any) => obj.json != null)
          .map((obj: any) => SuiToRpcAsset(obj))
          .filter((asset: SearchAsset) => filterAsset(asset, _req));

        assets = ownedAssets;
      } else {
        function ListingsToAssets(listings: any[]) {
          return listings
            .filter((obj: any) => !(obj instanceof Error) && obj.json != null)
            .map((obj: any) => ListingToQueryAsset(obj))
            .filter((asset: SearchAsset) => filterAsset(asset, _req));
        }
        var marketListings: any[] = [];
        if (_req.ia) {
          const isdAsId = _req.ia;
          const asRegistryId = deriveRegistryId(state.globalRegistryId, isdAsId)/*deriveObjectID(
            state.globalRegistryId,
            'u64',
            bcs.U64.serialize(isdAsId).toBytes(),
          );*/
          
          if (_req.ifIdIngress || _req.ifIdEgress) {
            console.log("Find specific Interface");
            const interfaceId = _req.ifIdIngress ?? _req.ifIdEgress;
            if (isdAsId === undefined || interfaceId === undefined) throw new ConnectError("ia and interface id must be specified", Code.InvalidArgument);

            const interfaceObjId = deriveIfIdFromAS(asRegistryId, interfaceId) /*deriveObjectID(
              asRegistryId,
              'u32',
              bcs.U32.serialize(interfaceId).toBytes(),
            );*/
            console.log(`Interface: ${interfaceObjId}`);

            marketListings = await getAllListingsOf(interfaceObjId, state.client);
            
          } else {
            try {
              const interfaceIds = await getAllInterfacesOf(asRegistryId, state.client);

              const listings: any[] = [];
              for (const interfaceId of interfaceIds) {
                const ls = await getAllListingsOf(interfaceId, state.client);
                listings.push(...ls);
              }
              marketListings = listings
            } catch (error) {
              console.log(error);
              throw new ConnectError(`Failed to fetch all Listings: ${error}`);
            }
          }
        } else {
          const result: any[] = [];
          try {
            const asRegistries = await getAllRegistries(state.globalRegistryId, state.client);
            for (const asRegistry of asRegistries) {
              const interfaces = await getAllInterfacesOf(asRegistry, state.client);
              for (const interfaceId of interfaces) {
                const listings = await getAllListingsOf(interfaceId, state.client);
                result.push(...listings);
              }
            }
            console.log(ListingsToAssets(result));
          } catch (error) {
            console.log(error);
          }
          marketListings = result
        }
        assets = ListingsToAssets(marketListings)
      }

      const pageSize = _req.maxReturnedAssets ?? 10;
      
        return new SearchAssetsResponse({assets: assets.slice(_req.page * pageSize, (_req.page + 1) * pageSize)})
    },

    async buyAssets(req, _ctx) {
      try {
        // TODO find a way to obtain isdAsId without needing to query 

        // Fetch all listing objects and wallet balance in parallel.
        const [listingResults, balanceResult] = await Promise.all([
          Promise.all(req.assets.map(asset => {
            const listingId = bytesToSuiHex(asset.assetId);
            return state.client.getObject({ objectId: listingId, include: { json: true } });
          })),
          state.client.getBalance({ owner: state.signer.toSuiAddress(), coinType: DEFAULT_COIN_TYPE }),
        ]);

        type AssetMeta = { fields: Record<string, any>; interfaceObjectId: string; assetId: string; listingId: string; };
        const metas: AssetMeta[] = req.assets.map((asset, i) => {
          const fields = getObjectFields(listingResults[i]!);
          const interfaceObjectId = fields['interface'] as string;
          const assetId = (fields['asset'] as Record<string, any>)['id'] as string;
          const listingId = bytesToSuiHex(asset.assetId);
          return { fields, interfaceObjectId, assetId, listingId };
        });
        
        var maxPrice = req.maxPrice;
        const addressBalance = BigInt(balanceResult.balance.balance)
        //TODO find a better gasPrice estimate. Also if payment is done in a currency different from SUI, subtracting the sui gas price is faulty
        const gasPrice = 50_000n * await state.client.getReferenceGasPrice().then(gp => BigInt(gp.referenceGasPrice)).catch(err => 0n);
        console.log(`available balance ${addressBalance}. Gas price ${gasPrice}`)
        if (addressBalance < maxPrice - gasPrice){
          console.warn(`maxPrice ${maxPrice} exceeds address balance. Setting maxPrice to ${addressBalance - gasPrice}`)
          maxPrice = addressBalance - gasPrice
        }
        
        const tx = new Transaction();
        const [ budget ] = tx.splitCoins(tx.gas, [tx.pure.u64(maxPrice)])


        for (const [meta, asset] of metas.map((m, i) => [m, req.assets[i]!] as const)) {
          
          addBuyAndTake(tx, {
            packageId: state.config.package.id,
            interfaceObjectId: meta.interfaceObjectId,
            listingId: bytesToSuiHex(asset.assetId),
            startTime: BigInt(asset.startsAtExactly!.seconds),
            expTime:   BigInt(asset.stopsAtExactly!.seconds),
            bandwidth: asset.bandwidthExact,
            coinType: DEFAULT_COIN_TYPE,
          }, budget);
        }

        tx.mergeCoins(tx.gas, [budget]);
        
        const result = await executeTransaction(state.client, state.signer, tx);
        console.log(result);

        const balanceChange = result.balanceChanges?.find(c => c.address === state.signer.toSuiAddress());
        var cost = BigInt(-Number(balanceChange?.amount ?? 0));
        // the returned cost must fit an unsigned integer, but in some cases the storage rebate is higher than the transaction cost leading to a gain (negative cost). 
        // In practice this should never happpen assuming assets prices are set properly, but when testing with small values this might happen 
        cost = cost<0n?0n:cost; 
        
        const boughtIds = result.effects.changedObjects.filter(obj => result.objectTypes[obj.objectId]?.includes("hummingbird_asset::HummingbirdAsset"));
        
        const bought = boughtIds.map(m => new BoughtAsset({ assetId: suiHexToBytes(m.objectId) }));
        return new BuyAssetsResponse({ assets: bought, cost});
      } catch (error) {
        console.log(error);
        if (error instanceof SimulationError && error.executionError?.$kind === 'MoveAbort') {
            const {abortCode} = error.executionError.MoveAbort;
            const MARKET_ERRORS: Record<string, string> = {
              '1': "Invalid interval",
              '2': 'Invalid Bandwidth',
              '5': 'Insufficient Balance',
            }
            throw new ConnectError(MARKET_ERRORS[abortCode]??"Failed transaction on Marketplace", Code.InvalidArgument);
          }
        throw error;
      }

    },

    async redeemAsset(req, _ctx) {
      
      try{
      var tx: Transaction;
      //TODO generate and store the private/public key pair somewhere
      const publicKey = state.authKeypair.publicKey;
      var reservation: Record<string, any> = {};
      if(req.interfaces.case == "ifPairAssetId"){
        const interfacePairId = req.interfaces.value;
        console.log(interfacePairId);
        if(!interfacePairId) throw new ConnectError("Must specify if_pair_asset_id", Code.InvalidArgument);
        const interfacePairAssetId = bytesToSuiHex(interfacePairId);
        const asset = await state.client.getObject({objectId: interfacePairAssetId, include: {json: true}});
        const pairAsset = getHummingbirdAsset(asset);
        reservation.ia = pairAsset.isdAsId;
        reservation.startsAt = pairAsset.startTime;
        reservation.stopsAt     = pairAsset.expTime;
        reservation.ingressId = pairAsset.ifIngressId;
        reservation.egressId = pairAsset.ifEgressId;
        tx  = buildRedeemPair({packageId: state.packageId, interfacePairId: interfacePairAssetId, publicKey});

      }else{
        const ingressAssetId = req.interfaces.value!.ingressAssetId;
        const egressAssetId = req.interfaces.value!.egressAssetId;
        if(!(ingressAssetId && egressAssetId)) throw new ConnectError("Must specify ingress and egress Id, or interface pair id", Code.FailedPrecondition);    
        const ingressId = bytesToSuiHex(ingressAssetId);
        const egressId = bytesToSuiHex(egressAssetId);
        console.log(ingressId);
        console.log(egressId);
          const ingressObj = await state.client.getObject({ objectId: ingressId, include: { json: true } });
          const ingressAsset = getHummingbirdAsset(ingressObj);
          reservation.ia          = ingressAsset.isdAsId;
          const ingressIfId = ingressAsset.ifIngressId;
          reservation.startsAt    = ingressAsset.startTime;
          reservation.stopsAt     = ingressAsset.expTime;

          const egressObj = await state.client.getObject({ objectId: egressId, include: { json: true } });
          const egressAsset = getHummingbirdAsset(egressObj);
          const egressIfId  = egressAsset.ifEgressId;
          console.log(ingressObj);
          console.log(egressObj);
          if(!(ingressIfId&&egressIfId)) throw new ConnectError("Asset Mismatch. Ingress asset must have ingress id set. Egress asset must have egress id set", Code.FailedPrecondition);
          
          tx = buildRedeem({ packageId: state.packageId, ingressAssetId: ingressId, egressAssetId: egressId, publicKey });
          reservation.ingressId = ingressIfId;
          reservation.egressId = egressIfId;
      }
        
          console.log(`waiting for redemption of ${publicKey}`);
          const deliveryPromise = state.deliveryListener.waitForDelivery(
            publicKey,
            state.packageId,
            state.config.redemption.timeoutSecs * 1000,
          );
          // The delivery listener needs a moment to start, but the reservation could already arrive before that which would lead to us missing the reservation. 
          // To avoid this we wait a moment to allow for the delivery listener to start up. TODO: wait only until the listener is started and not longer.
          await new Promise(resolve => setTimeout(resolve, 2000))
          
          const result = await executeTransaction(state.client, state.signer, tx);
          /*
          const redeemRequestObjectId = extractCreatedObjectId(
            result,
            getObjectType(state.packageId, 'hummingbird_asset', 'RedeemRequest'),
          );*/
          

          
          const delivery = await deliveryPromise;
          
          console.log(`received delivery${delivery.resId}`);
          const authKey = await openSealed(state.authKeypair,delivery.encryptedReservation);
          const authenticationKey = new TextDecoder().decode(authKey);
          console.log(authenticationKey);
          reservation.resId = delivery.resId;
          reservation.bw = delivery.bwRounded;
          reservation.ak = authenticationKey;
          insertReservation(state.db, reservation as ReservationRow);

          return new RedeemAssetResponse({
            authenticationKey: new TextEncoder().encode(authenticationKey),
            reservationId: delivery.resId,
            bandwidthRounded: delivery.bwRounded,
            bwDataplaneEncoding: delivery.bwDataplaneEncoding,
          });
        } catch (err) {
          console.log(err);
          if (err instanceof DeliveryTimeoutError) {
            throw new ConnectError('AS did not deliver reservation in time', Code.DeadlineExceeded);
          }
          throw err;
        }
    },

    fetchReservations(req, _ctx) {
      const filter: ReservationFilter = {};
      if (req.ia        !== undefined) filter.ia        = req.ia;
      if (req.ingressId !== undefined) filter.ingressId = req.ingressId;
      if (req.egressId  !== undefined) filter.egressId  = req.egressId;
      if (req.bandwidth !== undefined) filter.bw = req.bandwidth;
      if (req.startsAt  !== undefined) filter.startsAt  = req.startsAt.seconds;
      if (req.stopsAt   !== undefined) filter.stopsAt   = req.stopsAt.seconds;
      const rows = queryReservations(state.db, filter).filter(r => filterReservation(new Reservation({
        ia: r.ia, ingressId: r.ingressId, egressId: r.egressId, bandwidth: r.bw,
        startsAt: new Timestamp({ seconds: r.startsAt }), stopsAt: new Timestamp({ seconds: r.stopsAt }),
      }), req));
      console.log(rows);
      return new FetchReservationsResponse({
        reservations: rows.map(r => new Reservation({
          reservationId:     r.resId,
          ia:        r.ia,
          ingressId: r.ingressId,
          egressId:  r.egressId,
          bandwidth:        r.bw,
          startsAt:  new Timestamp({ seconds: r.startsAt }),
          stopsAt:   new Timestamp({ seconds: r.stopsAt }),
          authenticationKey:        new TextEncoder().encode(r.ak),
        })),
      });
    },

    async splitAsset(req, _ctx) {
      if (req.splitOption.case === undefined) {
        throw new ConnectError('splitOption is required', Code.InvalidArgument);
      }

      const gasBudget = BigInt(state.config.transaction.gasBudget);
      const tx = new Transaction();
      tx.setGasBudget(gasBudget);

      const assetId = bytesToSuiHex(req.assetId);
      for(var idx = 0; idx < req.splitOption.value.splits.length; idx++){
        console.log(req.splitOption.value.splits[idx])
        const newAsset = req.splitOption.case === 'timeSplit'
        ? tx.moveCall({
            target: `${state.config.package.id}::hummingbird_asset::split_time`,
            arguments: [tx.object(assetId), tx.pure.u64(BigInt(req.splitOption.value.splits[idx]?.seconds??0))],
          })
        : tx.moveCall({
            target: `${state.config.package.id}::hummingbird_asset::split_bandwidth`,
            arguments: [tx.object(assetId), tx.pure.u32(req.splitOption.value.splits[idx]??0)],
          });
        tx.transferObjects([newAsset], tx.pure.address(state.signer.toSuiAddress()));
      }
      
      try {
        const result = await executeTransaction(state.client, state.signer, tx);
        console.log(result);
        const newAssetIds = result.effects.changedObjects.filter(c => c.idOperation === 'Created').map(obj => suiHexToBytes(obj.objectId ?? '0x0'));

        return new SplitAssetResponse({ assetIds: [... newAssetIds, req.assetId] });
      }catch (error){
        console.log(error)
        throw new ConnectError(`${error}`, Code.Internal)
      }
    },

    async combineAssets(req, _ctx) {
      if (req.assetIds.length <= 2) {
        throw new ConnectError("must specify at least 2 assets to combine")
      }
      const mergeAssetId = bytesToSuiHex(req.assetIds[0]!);

      const gasBudget = BigInt(state.config.transaction.gasBudget);
      const tx = new Transaction();
      tx.setGasBudget(gasBudget);
      for(const assetId of req.assetIds.slice(1)){
        tx.moveCall({
          target: `${state.config.package.id}::hummingbird_asset::fuse_assets`,
          arguments: [tx.object(mergeAssetId), tx.object(bytesToSuiHex(assetId))],
        });
      }
      try {
        await executeTransaction(state.client, state.signer, tx);

        return new CombineAssetResponse({ assetId: suiHexToBytes(mergeAssetId) });
      }catch (error) {
        console.log(error);
        throw new ConnectError(`${error}`, Code.Internal)
      }
    },
  };
}
