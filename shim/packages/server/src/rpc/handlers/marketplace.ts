import { Code, ConnectError } from '@connectrpc/connect';
import type { ServiceImpl } from '@connectrpc/connect';
import type { MarketplaceService as IMarketplaceService } from '../gen/hummingbird/v1/marketplace_connect.js';
import {
  MarketplaceInfoResponse,
  PublishAssetResponse,
  SearchAssetsRequest,
  SearchAssetsResponse,
  Asset,
  BuyAssetsResponse,
  BoughtAsset,
  RedeemAssetResponse,
  FetchReservationsRequest,
  FetchReservationsResponse,
  SplitAssetResponse,
  CombineAssetResponse,
  Reservation,
} from '../gen/hummingbird/v1/marketplace_pb.js';
import { Timestamp } from '@bufbuild/protobuf';
import { Transaction } from '@mysten/sui/transactions';
import { deriveObjectID } from '@mysten/sui/utils';
import { bcs } from '@mysten/sui/bcs';
import { SimulationError } from '@mysten/sui/client';
import {
  buildCreateListing,
  addBuyAndTake,
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
  insertReservation,
  queryReservations,
  buildRegisterAs,
  buildCreateInterface,
  saveConfig,
} from '@sui-shim/core';
import type { ReservationFilter } from '@sui-shim/core';
import type { AppState } from '../../state.js';
import { BigIntToUID, ListingToQueryAsset, SuiToRpcAsset } from '../helpers.js';
import { assert } from 'node:console';

const API_MAJOR_VERSION = 0n;
const API_MINOR_VERSION = 1n;

function filterAsset(asset: Asset, req: SearchAssetsRequest): boolean {
  if (req.ia              !== undefined && asset.ia          !== req.ia)              return false;
  if (req.ifIdIngress     !== undefined && asset.ifIdIngress !== req.ifIdIngress)     return false;
  if (req.ifIdEgress      !== undefined && asset.ifIdEgress  !== req.ifIdEgress)      return false;
  if (req.minRequiredBw   !== undefined && asset.bw          <  req.minRequiredBw)   return false;
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
  if (req.bw        !== undefined && r.bw        !== req.bw)        return false;
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
        maxStatisticsGranularity: 1;
      });
    },

    async publishAsset(req, _ctx) {
      if(!state.config.as.isdAsId) throw new ConnectError('AS ID not configured. Set your isd-as-id in the config', Code.Unauthenticated);
      
      if(!state.config.package.globalRegistryId) throw new ConnectError('No marketplace configured. Set the globalRegistryId in the config', Code.NotFound);
      if (req.ifIdIngress === undefined && req.ifIdEgress === undefined) {
        throw new ConnectError('At least one of if_id_ingress or if_id_egress must be set', Code.InvalidArgument);
      }
      if(req.bandwidth<=0) throw new ConnectError('Bandwidth must be at least 1', Code.FailedPrecondition);
      if(!req.startsAt || !req.stopsAt) throw new ConnectError('Must specify start and end time', Code.FailedPrecondition);
      if(req.bandwidthMin<=req.bandwidth) throw new ConnectError('Min bandwidth may not exceed bandwidth', Code.FailedPrecondition);
      if(req.timeMinDuration<=req.stopsAt.seconds-req.startsAt.seconds) throw new ConnectError('Min time duration must be at most the total duration', Code.FailedPrecondition);
      const isdAsId = state.config.as.isdAsId;
      try{
      //create as registry if not existing
      const derivedAsRegistryId = deriveObjectID(state.config.package.globalRegistryId, 'u64', bcs.U64.serialize(isdAsId).toBytes());
      const { objects: [asRegistryResult] } = await state.client.getObjects({ objectIds: [derivedAsRegistryId] });
      if (asRegistryResult instanceof Error) {
        const result = await executeTransaction(state.client, state.signer,
          buildRegisterAs({
            packageId: state.config.package.id,
            globalRegistryId: state.config.package.globalRegistryId,
            isdAsId: BigInt(isdAsId)
          })
        );
        state.config.as.asAuthCapId = extractCreatedObjectId(result, getObjectType(state.config.package.id, "registry", "AsAuthCap"));
      }
      state.config.as.asRegistryId = derivedAsRegistryId;
      saveConfig(state.config);

      //create interface if not exists
      const ifId = req.ifIdIngress ?? req.ifIdEgress!;
      const interfaceObjectId = deriveObjectID(state.config.as.asRegistryId, 'u16',  bcs.U16.serialize(ifId).toBytes());
      const { objects: [interfaceResult] } = await state.client.getObjects({ objectIds: [interfaceObjectId] });
      if (interfaceResult instanceof Error) {
        try{
          await executeTransaction(state.client, state.signer,
            buildCreateInterface({
              packageId: state.config.package.id,
              asRegistryId: state.config.as.asRegistryId,
              asAuthCapId: state.config.as.asAuthCapId!,
              interfaceId: ifId,
            })
          );
        }catch(error){
          console.log(error);
          if (error instanceof SimulationError && error.executionError?.$kind === 'MoveAbort') {
            const {abortCode} = error.executionError.MoveAbort;
            
            if(abortCode=="2") throw new ConnectError('Unauthorized: invalid auth cap. Set the correct auth cap in the config', Code.FailedPrecondition);
          }else throw error;
        }
      }

      const start = req.startsAt ? Number(req.startsAt.seconds)  : Date.now();
      const stop = req.stopsAt ? Number(req.stopsAt.seconds) : start + 3600;

      /*const interfaceObj = await state.client.getObject({
        objectId: interfaceObjectId,
        include: { json: true },
      });*/
      //const interfaceFields = getObjectFields(interfaceObj);
      //const interfaceId = interfaceFields.interface_id as number;

      const tx = buildCreateListing({
        packageId: state.packageId,
        interfaceObjectId,
        ingressId: req.ifIdIngress,
        egressId: req.ifIdEgress,
        asAuthCapId: state.asAuthCapId,
        sellerAuthTokenId: state.sellerAuthTokenId,
        isdAsId: BigInt(isdAsId),
        bandwidth: req.bandwidth as bigint,
        startTime: BigInt(Math.floor(start)),
        expTime: BigInt(Math.floor(stop)),
        timeGranularity: req.timeGranularity as bigint,
        timeMinDuration: req.timeGranularity as bigint,
        minBandwidth: req.bandwidthMin as bigint,
        price: req.price as bigint,
        issuer: state.signer.getPublicKey().toSuiAddress(),
        coinType: DEFAULT_COIN_TYPE,
      });

      const result = await executeTransaction(state.client, state.signer, tx);

      // Find the first created object in effects.
      const created = result.effects.changedObjects.find(c => c.idOperation === 'Created')?.objectId ?? '0x0';

      return new PublishAssetResponse({ assetId: BigInt(created).toString() });
    }catch(error){
      console.log(error);
      throw new ConnectError("error");
    }
    },

    async searchAssets(_req, _ctx) {
      console.log("start asset search");
      if (_req.owned) {
        const result = await state.client.listOwnedObjects({
          owner: state.signer.getPublicKey().toSuiAddress(),
          type: getObjectType(state.config.package.id, "hummingbird_asset", "HummingbirdAsset"),
          include: { json: true },
        });

        const ownedAssets: Asset[] = result.objects
          .filter((obj: any) => obj.json != null)
          .map((obj: any) => SuiToRpcAsset(obj))
          .filter((asset: Asset) => filterAsset(asset, _req));

        return new SearchAssetsResponse({assets: ownedAssets });
      } else {
        function ListingsToAssets(listings: any[]) {
          return listings
            .filter((obj: any) => !(obj instanceof Error) && obj.json != null)
            .map((obj: any) => ListingToQueryAsset(obj))
            .filter((asset: Asset) => filterAsset(asset, _req));
        }

        if (_req.ia) {
          const isdAsId = _req.ia;
          const asRegistryId = deriveObjectID(
            state.globalRegistryId,
            'u64',
            bcs.U64.serialize(BigInt(isdAsId)).toBytes(),
          );
          console.log(`[debug] asRegistryId ${asRegistryId}`);

          if (_req.ifIdIngress || _req.ifIdEgress) {
            console.log("Find specific Interface");
            const interfaceId = _req.ifIdIngress ?? _req.ifIdEgress;
            if (isdAsId === undefined || interfaceId === undefined) throw new ConnectError("ia and interface id must be specified", Code.InvalidArgument);

            const interfaceObjId = deriveObjectID(
              asRegistryId,
              'u16',
              bcs.U16.serialize(interfaceId).toBytes(),
            );
            console.log(`Interface: ${interfaceObjId}`);

            const listingObjs = await getAllListingsOf(interfaceObjId, state.client);
            console.log(listingObjs);

            const assets: Asset[] = ListingsToAssets(listingObjs);
            return new SearchAssetsResponse({ assets });
          } else {
            try {
              const interfaceIds = await getAllInterfacesOf(asRegistryId, state.client);

              const listings: any[] = [];
              for (const interfaceId of interfaceIds) {
                const ls = await getAllListingsOf(interfaceId, state.client);
                listings.push(...ls);
              }
              console.log(listings);
              return new SearchAssetsResponse({ assets: ListingsToAssets(listings) });
            } catch (error) {
              console.log(error);
            }
            throw new ConnectError("Failed to fetch all Listings");
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
          console.log(result);
          return new SearchAssetsResponse({ assets: ListingsToAssets(result) });
        }
      }
    },

    async buyAssets(req, _ctx) {
      try {
        // Validate all assets upfront before touching the chain.
        for (const asset of req.assets) {
          if (asset.startsAtExactly === undefined || asset.stopsAtExactly === undefined)
            throw new ConnectError(`must specify start and stop time for asset ${asset.assetId}`);
          if (asset.bwExact === undefined)
            throw new ConnectError(`must specify exact bandwidth for asset ${asset.assetId}`);
        }

        // Fetch all listing objects and wallet balance in parallel.
        const [listingResults, balanceResult] = await Promise.all([
          Promise.all(req.assets.map(asset => {
            const listingId = '0x' + BigInt(asset.assetId).toString(16).padStart(64, '0');
            return state.client.getObject({ objectId: listingId, include: { json: true } });
          })),
          state.client.getBalance({ owner: state.signer.toSuiAddress() }),
        ]);
        const totalBalance = balanceResult.balance.balance;

        // Compute effective price for each asset: duration * bandwidth * unit_price.
        // GraphQL JSON: nested structs have no `fields` wrapper; UID is a canonical address string.
        type AssetMeta = { fields: Record<string, any>; interfaceObjectId: string; assetId: string; listingId: string; effectivePrice: bigint };
        const metas: AssetMeta[] = req.assets.map((asset, i) => {
          const fields = getObjectFields(listingResults[i]!);
          const interfaceObjectId = fields['interface'] as string;
          const assetId = (fields['asset'] as Record<string, any>)['id'] as string;
          const listingId = '0x' + BigInt(asset.assetId).toString(16).padStart(64, '0');
          const unitPrice = BigInt(fields['price'] as string);
          const reqStart = BigInt(asset.startsAtExactly!.seconds);
          const reqExp   = BigInt(asset.stopsAtExactly!.seconds);
          const reqBw    = BigInt(asset.bwExact!);
          const effectivePrice = (reqExp - reqStart) * reqBw * unitPrice;
          return { fields, interfaceObjectId, assetId, listingId, effectivePrice };
        });

        const totalPrice = metas.reduce((sum, m) => sum + m.effectivePrice, 0n);

        const gasBudget = BigInt(state.config.transaction.gasBudget);
        const spendable = BigInt(totalBalance) > gasBudget ? BigInt(totalBalance) - gasBudget : 0n;
        const effectiveMax = req.maxPrice < spendable ? req.maxPrice : spendable;

        if (effectiveMax < totalPrice)
          throw new ConnectError(`spendable balance (${effectiveMax}) is below estimated total cost (${totalPrice})`);

        const tx = new Transaction();
        console.log(gasBudget);
        tx.setGasBudget(gasBudget);
        const [paymentCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(effectiveMax)]);

        const slack = effectiveMax - totalPrice;
        for (const [meta, asset] of metas.map((m, i) => [m, req.assets[i]!] as const)) {
          const slotMax = meta.effectivePrice + (totalPrice > 0n ? slack * meta.effectivePrice / totalPrice : 0n);
          const [slotCoin] = tx.splitCoins(paymentCoin, [tx.pure.u64(slotMax)]);
          addBuyAndTake(tx, {
            packageId: state.config.package.id,
            interfaceObjectId: meta.interfaceObjectId,
            listingId: meta.listingId,
            startTime: BigInt(asset.startsAtExactly!.seconds),
            expTime:   BigInt(asset.stopsAtExactly!.seconds),
            bandwidth: BigInt(asset.bwExact!),
            coinType: DEFAULT_COIN_TYPE,
          }, slotCoin);
        }

        tx.mergeCoins(tx.gas, [paymentCoin]);
        
        const result = await executeTransaction(state.client, state.signer, tx);
        console.log(result);

        // BalanceChange.address (new API) replaced old .owner.AddressOwner
        const balanceChange = result.balanceChanges?.find(c => c.address === state.signer.toSuiAddress());
        const cost = BigInt(-Number(balanceChange?.amount ?? 0));

        const bought = metas.map(m => new BoughtAsset({ assetId: BigInt(m.assetId).toString() }));
        return new BuyAssetsResponse({ assets: bought, cost });
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
      if(req.ifPairAssetId){
        throw new ConnectError("IfPairAssetId not implemented");
      }else{
        if(!(req.ingressAssetId && req.egressAssetId)) throw new ConnectError("Must specify ingress and egress Id, or interface pair id", Code.FailedPrecondition);    
        const ingressId = '0x' + BigInt(req.ingressAssetId).toString(16).padStart(64, '0');
        const egressId = '0x' + BigInt(req.egressAssetId).toString(16).padStart(64, '0');
        console.log(ingressId);
        console.log(egressId);
        try {
          const ingressObj = await state.client.getObject({ objectId: ingressId, include: { json: true } });
          const ingressFields = getObjectFields(ingressObj);
          const ia          = BigInt(ingressFields['isd_as_id'] as string);
          const ingressIfId = ingressFields['if_ingress_id'] as number;
          const startsAt    = new Date(Number(BigInt(ingressFields['start_time'] as string)));
          const stopsAt     = new Date(Number(BigInt(ingressFields['exp_time']   as string)));

          const egressObj = await state.client.getObject({ objectId: egressId, include: { json: true } });
          const egressFields = getObjectFields(egressObj);
          const egressIfId  = egressFields['if_egress_id'] as number;
          console.log(ingressObj);
          console.log(egressObj);
          if(!(ingressIfId&&egressIfId)) throw new ConnectError("Asset Mismatch. Ingress asset must have ingress id set. Egress asset must have egress id set", Code.FailedPrecondition);
          const publicKey = new Uint8Array(32);

          const tx = buildRedeem({ packageId: state.packageId, ingressAssetId: ingressId, egressAssetId: egressId, publicKey });
          const result = await executeTransaction(state.client, state.signer, tx);

          const redeemRequestObjectId = extractCreatedObjectId(
            result,
            getObjectType(state.packageId, 'hummingbird_asset', 'RedeemRequest'),
          );

          const delivery = await state.deliveryListener.waitForDelivery(
            redeemRequestObjectId,
            state.packageId,
            state.config.redemption.timeoutSecs * 1000,
          );
          const ak = new TextDecoder().decode(delivery.encryptedReservation);
          console.log(ak);
          console.log(delivery.resId);

          insertReservation(state.db, {
            resId:     delivery.resId,
            ia,
            ingressId: ingressIfId,
            egressId:  egressIfId,
            bw:        delivery.bwRounded,
            startsAt,
            stopsAt,
            ak,
          });

          return new RedeemAssetResponse({
            ak,
            resId: delivery.resId,
            bwRounded: delivery.bwRounded,
            bwDataplaneEncoding: delivery.bwDataplaneEncoding,
          });
        } catch (err) {
          console.log(err);
          if (err instanceof DeliveryTimeoutError) {
            throw new ConnectError('AS did not deliver reservation in time', Code.DeadlineExceeded);
          }
          throw err;
        }
    }
    },

    fetchReservations(req, _ctx) {
      const filter: ReservationFilter = {};
      if (req.ia        !== undefined) filter.ia        = req.ia;
      if (req.ingressId !== undefined) filter.ingressId = req.ingressId;
      if (req.egressId  !== undefined) filter.egressId  = req.egressId;
      if (req.bw        !== undefined) filter.bw        = req.bw;
      if (req.startsAt  !== undefined) filter.startsAt  = req.startsAt.toDate();
      if (req.stopsAt   !== undefined) filter.stopsAt   = req.stopsAt.toDate();
      const rows = queryReservations(state.db, filter).filter(r => filterReservation(new Reservation({
        ia: r.ia, ingressId: r.ingressId, egressId: r.egressId, bw: r.bw,
        startsAt: Timestamp.fromDate(r.startsAt), stopsAt: Timestamp.fromDate(r.stopsAt),
      }), req));
      console.log(rows);
      return new FetchReservationsResponse({
        reservations: rows.map(r => new Reservation({
          resId:     r.resId,
          ia:        r.ia,
          ingressId: r.ingressId,
          egressId:  r.egressId,
          bw:        r.bw,
          startsAt:  Timestamp.fromDate(r.startsAt),
          stopsAt:   Timestamp.fromDate(r.stopsAt),
          ak:        r.ak,
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

      const assetId = '0x' + BigInt(req.assetId).toString(16).padStart(64, '0');
      const newAsset = req.splitOption.case === 'timeSplit'
        ? tx.moveCall({
            target: `${state.config.package.id}::hummingbird_asset::split_time`,
            arguments: [tx.object(assetId), tx.pure.u64(BigInt(req.splitOption.value.seconds))],
          })
        : tx.moveCall({
            target: `${state.config.package.id}::hummingbird_asset::split_bandwidth`,
            arguments: [tx.object(assetId), tx.pure.u64(req.splitOption.value)],
          });

      tx.transferObjects([newAsset], tx.pure.address(state.signer.toSuiAddress()));

      const result = await executeTransaction(state.client, state.signer, tx);
      const newAssetId = result.effects.changedObjects.find(c => c.idOperation === 'Created')?.objectId ?? '0x0';

      return new SplitAssetResponse({ assetId1: req.assetId, assetId2: BigInt(newAssetId).toString() });
    },

    async combineAssets(req, _ctx) {
      const assetId1 = '0x' + BigInt(req.assetId1).toString(16).padStart(64, '0');
      const assetId2 = '0x' + BigInt(req.assetId2).toString(16).padStart(64, '0');

      const [obj1, obj2] = await Promise.all([
        state.client.getObject({ objectId: assetId1, include: { json: true } }),
        state.client.getObject({ objectId: assetId2, include: { json: true } }),
      ]);

      const fields1 = getObjectFields(obj1);
      const fields2 = getObjectFields(obj2);
      const fuseFunction = fields1.bandwidth === fields2.bandwidth ? 'fuse_time' : 'fuse_bandwidth';

      const gasBudget = BigInt(state.config.transaction.gasBudget);
      const tx = new Transaction();
      tx.setGasBudget(gasBudget);

      tx.moveCall({
        target: `${state.config.package.id}::hummingbird_asset::${fuseFunction}`,
        arguments: [tx.object(assetId1), tx.object(assetId2)],
      });

      await executeTransaction(state.client, state.signer, tx);

      return new CombineAssetResponse({ assetId: req.assetId1 });
    },
  };
}
