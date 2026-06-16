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
  Reservation,
} from '../gen/hummingbird/v1/marketplace_pb.js';
import { Timestamp } from '@bufbuild/protobuf';
import { Transaction } from '@mysten/sui/transactions';
import { deriveObjectID } from '@mysten/sui/utils';
import { bcs } from '@mysten/sui/bcs';
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
} from '@sui-shim/core';
import type { ReservationFilter } from '@sui-shim/core';
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

      // Fetch the interface object to resolve isd_as_id and interface_id.
      const interfaceObj = await state.client.getObject({
        id: interfaceObjectId,
        options: { showContent: true },
      });
      const interfaceFields = getObjectFields(interfaceObj);
      const isdAsId = BigInt(interfaceFields.isd_as_id as string);
      const interfaceId = interfaceFields.interface_id as number;

      const tx = buildCreateListing({
        packageId: state.packageId,
        interfaceObjectId,
        interfaceType: req.ifIdIngress ? 0: 1,
        asAuthCapId: state.asAuthCapId,
        sellerAuthTokenId: state.sellerAuthTokenId,
        isdAsId,
        interfaceId,
        bandwidth: req.bandwidth as bigint,
        startTime: BigInt(Math.floor(startMs)),
        expTime: BigInt(Math.floor(stopMs)),
        timeGranularity: req.timeGranularity as bigint,
        timeMinDuration: req.timeGranularity as bigint,
        minBandwidth: req.bandwidthMin as bigint,
        price: req.price as bigint,
        issuer: state.signer.getPublicKey().toSuiAddress(),
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
      try{
      // Validate all assets upfront before touching the chain.
      for (const asset of req.assets) {
        if (asset.startsAtExactly === undefined || asset.stopsAtExactly === undefined)
          throw new ConnectError(`must specify start and stop time for asset ${asset.assetId}`);
        if (asset.bwExact === undefined)
          throw new ConnectError(`must specify exact bandwidth for asset ${asset.assetId}`);
      }

      // Fetch all listing objects and wallet balance in parallel.
      const [listingResults, { totalBalance }] = await Promise.all([
        Promise.all(req.assets.map(asset => {
          const listingId = '0x' + BigInt(asset.assetId).toString(16).padStart(64, '0');
          return state.client.getObject({ id: listingId, options: { showContent: true } });
        })),
        state.client.getBalance({ owner: state.signer.toSuiAddress() }),
      ]);

      // Compute effective price for each asset: duration * bandwidth * unit_price.
      type AssetMeta = { fields: Record<string, any>; interfaceObjectId: string; assetId: string; listingId: string; effectivePrice: bigint };
      const metas: AssetMeta[] = req.assets.map((asset, i) => {
        const fields = getObjectFields(listingResults[i]);
        const interfaceObjectId = fields['interface'] as string;
        const assetId = (fields['asset'] as Record<string, any>)['fields']['id']['id'] as string;
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

      // Build a single PTB — one buyAndTake call per asset, all atomic.

      const tx = new Transaction();
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

      // Reclaim any unspent remainder from the payment coin.
      tx.mergeCoins(tx.gas, [paymentCoin]);

      // Execute atomically — all succeed or none go through.
      const result = await executeTransaction(state.client, state.signer, tx);
      console.log(result);

      const balanceChange = result.balanceChanges?.find((c: any) => c.owner.AddressOwner === state.signer.toSuiAddress());
      const cost = BigInt(-Number(balanceChange?.amount ?? 0));

      const bought = metas.map(m => new BoughtAsset({ assetId: BigInt(m.assetId).toString() }));
      return new BuyAssetsResponse({ assets: bought, cost });}
      catch(error){
        console.log(error);
        throw error;
      }
    },

    async redeemAsset(req, _ctx) {
      const ingressId = '0x' + BigInt(req.ingressAssetId).toString(16).padStart(64, '0');
      const egressId = '0x' + BigInt(req.egressAssetId).toString(16).padStart(64, '0');
      console.log(ingressId);
      console.log(egressId);
      try {
        // Fetch asset fields before buildRedeem wraps them into a RedeemRequest on-chain
        const ingressObj = await state.client.getObject({ id: ingressId, options: { showContent: true } });
        const ingressFields = getObjectFields(ingressObj);
        const ia          = BigInt(ingressFields['isd_as_id'] as string);
        const ingressIfId = ingressFields['interface_id'] as number;
        const startsAt    = new Date(Number(BigInt(ingressFields['start_time'] as string)));
        const stopsAt     = new Date(Number(BigInt(ingressFields['exp_time']   as string)));

        const egressObj = await state.client.getObject({ id: egressId, options: { showContent: true } });
        const egressFields = getObjectFields(egressObj);
        const egressIfId  = egressFields['interface_id'] as number;

        // Public key management is TBD; hardcoded zeros for now
        const publicKey = new Uint8Array(32);

        const tx = buildRedeem({ packageId: state.packageId, ingressAssetId: ingressId, egressAssetId: egressId, publicKey });
        const result = await executeTransaction(
          state.client as Parameters<typeof executeTransaction>[0],
          state.signer,
          tx,
        );
        
        // The redeem() call creates a RedeemRequest object owned by the AS issuer
        const redeemRequestObjectId = extractCreatedObjectId(
          result,
          getObjectType(state.packageId, 'hummingbird_asset', 'RedeemRequest'),
        );

        // Wait for the AS to call deliver_reservation(), which deletes the RedeemRequest
        // and emits ReservationDelivered with the encrypted keys
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
    },

    fetchReservations(req, _ctx) {
      const filter: ReservationFilter = {};
      if (req.ia        !== undefined) filter.ia        = req.ia;
      if (req.ingressId !== undefined) filter.ingressId = req.ingressId;
      if (req.egressId  !== undefined) filter.egressId  = req.egressId;
      if (req.bw        !== undefined) filter.bw        = req.bw;
      if (req.startsAt  !== undefined) filter.startsAt  = req.startsAt.toDate();
      if (req.stopsAt   !== undefined) filter.stopsAt   = req.stopsAt.toDate();
      const rows = queryReservations(state.db, filter);
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

    splitAsset(_req, _ctx) {
      throw new ConnectError('splitAsset is not supported by the underlying Move contract', Code.Unimplemented);
    },

    combineAssets(_req, _ctx) {
      throw new ConnectError('combineAssets is not supported by the underlying Move contract', Code.Unimplemented);
    },
  };
}
