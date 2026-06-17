import { Command } from 'commander';
import {
  buildRegisterAs,
  buildRegisterSeller,
  buildCreateInterface,
  buildCreateListing,
  buildBuyAndTake,
  buildRedeem,
  buildDeliverReservation,
  buildDelistAndTake,
  DEFAULT_COIN_TYPE,
  loadKeypairs,
  PlaintextUnlocker,
  extractCreatedObjectId,
  getObjectType,
  saveConfig,
  listingInterfaceId,
  DeliveryListener,
  createSuiGrpcClient,
  openReservationDb,
  insertReservation,
  getObjectFields,
} from '@sui-shim/core';
import type { SuiClientTypes } from '@mysten/sui/client';
import { deriveObjectID, isValidSuiObjectId } from '@mysten/sui/utils';
import { bcs } from '@mysten/sui/bcs';
import { makeCtx, runTx } from '../ctx.js';
import { getDefaultAddress } from './keys.js';

function configOpt(cmd: Command): Command {
  return cmd.option('-c, --config <path>', 'Path to shim.toml config file', 'shim.toml');
}

function coinTypeOpt(cmd: Command): Command {
  return cmd.option('--coin-type <type>', 'Coin type for the Move call', DEFAULT_COIN_TYPE);
}

function resolve(cliVal: string | undefined, configVal: string | undefined, flag: string): string {
  const v = cliVal ?? configVal;
  if (!v) throw new Error(`--${flag} is required (or set package.${flag.replace(/-/g, '')} in shim.toml)`);
  return v;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error(`Odd-length hex string: ${hex}`);
  return new Uint8Array(Buffer.from(clean, 'hex'));
}

export function makeCallCommand(): Command {
  const call = new Command('call').description('Build and submit a Move transaction');

  // register-as
  call.addCommand(
    configOpt(
      new Command('register-as')
        .description('Register this signer as an AS in the global registry')
        .option('--global-registry-id <id>', 'Global registry shared object ID (fallback: package.globalRegistryId in config)')
        .option('--set-active','Set the created registry as the default for further commands')
        .requiredOption('--isd-as-id <n>', 'ISD-AS identifier (integer)', parseInt),
    ).action(async (opts: { config: string; globalRegistryId?: string;setActive: boolean, isdAsId: string }) => {
      const ctx = await makeCtx(opts.config);
      const globalRegistryId = resolve(opts.globalRegistryId, ctx.config.package?.globalRegistryId, 'global-registry-id');
      const result = await runTx(ctx, buildRegisterAs({ packageId: ctx.config.package.id, globalRegistryId, isdAsId: BigInt(opts.isdAsId) }));
      const registryId = extractCreatedObjectId(result, getObjectType(ctx.config.package.id,"registry","AsRegistry"));
      const asAuthCapId = extractCreatedObjectId(result, getObjectType(ctx.config.package.id, "registry", "AsAuthCap"));
      if(registryId){
        console.log(`Created AS registry for isd-as ${opts.isdAsId} at ${registryId}`);
      }else{
        throw new Error("Failed to create AS on chain. Check that the AS registry does not yet exist on chain");
      }

      if(opts.setActive) {
        ctx.config.as.isdAsId = opts.isdAsId;
        ctx.config.as.asRegistryId = registryId;
        ctx.config.as.asAuthCapId = asAuthCapId;
        ctx.config.as.interfaces = [];
        saveConfig(ctx.config, opts.config);
      }
    }),
  );

  // register-seller
  call.addCommand(
    configOpt(
      new Command('register-seller')
        .description('Register as a seller and receive a SellerAuthToken')
        .option('--payment-address <addr>', 'Address to receive listing payments')
        .option('--set-active'),
    ).action(async (opts: { config: string; paymentAddress: string; setActive: boolean}) => {
      const ctx = await makeCtx(opts.config);
      const addr = opts.paymentAddress ?? getDefaultAddress(ctx);
      const result = await runTx(ctx, buildRegisterSeller({ packageId: ctx.config.package.id, paymentAddress: addr}));
      const sellerToken = extractCreatedObjectId(result, getObjectType(ctx.config.package.id,"marketplace","SellerAuthToken"));
      console.log(`Created Seller Token at ${sellerToken} for Address ${addr}`);

      if(opts.setActive){
        ctx.config.as.sellerAuthTokenId = sellerToken;
        saveConfig(ctx.config, opts.config);
      }
    }),
  );

  // create-interface
  call.addCommand(
    coinTypeOpt(
      configOpt(
        new Command('create-interface')
          .description('Create a new Interface object for this AS')
          .option('--as-registry-id <id>', 'AsRegistry shared object ID (fallback: package.globalRegistryId in config)')
          .option('--as-auth-cap-id <id>', 'AsAuthCap object ID (fallback: as.asAuthCapId in config)')
          .option('--save', 'Save to Interface list in config')
          .requiredOption('--interface-id <n>', 'Interface identifier (u16)', parseInt),
      ),
    ).action(
      async (opts: { config: string; asRegistryId?: string; asAuthCapId?: string; save: boolean; interfaceId: number; coinType: string;}) => {
        const ctx = await makeCtx(opts.config);
        const asRegistryId = resolve(opts.asRegistryId, ctx.config.as?.asRegistryId, 'as-registry-id');
        const asAuthCapId = resolve(opts.asAuthCapId, ctx.config.as?.asAuthCapId, 'as-auth-cap-id');

        const result = await runTx(
          ctx,
          buildCreateInterface({
            packageId: ctx.config.package.id,
            asRegistryId,
            asAuthCapId,
            interfaceId: opts.interfaceId,
          }),
        );

        const interfaceObjId = extractCreatedObjectId(result, getObjectType(ctx.config.package.id, "registry","Interface"));
        console.log(`Created new Interface for ${ctx.config.as.isdAsId} at ${interfaceObjId}`);

        if(opts.save){
          ctx.config.as.interfaces?.push(interfaceObjId);
          saveConfig(ctx.config, opts.config);
        }
      },
    ),
  );

  // create-listing
  call.addCommand(
    coinTypeOpt(
      configOpt(
        new Command('create-listing')
          .description('Issue a HummingbirdAsset and create a listing on an Interface')
          .option('--interface-object-id <id>', 'Interface object ID')
          .requiredOption('--interface-type <n>', 'Interface Type (0=Ingress, 1=Egress)', parseInt)
          .option('--as-auth-cap-id <id>', 'AsAuthCap object ID (fallback: as.asAuthCapId in config)')
          .option('--seller-auth-token-id <id>', 'SellerAuthToken object ID (fallback: as.sellerAuthTokenId in config)')
          .requiredOption('--bandwidth <n>', 'Total bandwidth in kb/s (u64)', parseInt)
          .requiredOption('--start-time <s>', 'Start epoch seconds (u64)', parseInt)
          .requiredOption('--exp-time <s>', 'Expiry epoch seconds (u64)', parseInt)
          .requiredOption('--time-granularity <n>', 'Minimum time slice in ms (u64)', parseInt)
          .option('--time-min-duration <n>', 'Minimum purchasable duration in ms (u64, defaults to --time-granularity)', parseInt)
          .requiredOption('--min-bandwidth <n>', 'Minimum bandwidth slice (u64)', parseInt)
          .requiredOption('--price <n>', 'Price in coin base units per unit bandwidth per time (u64)', parseInt),
      ),
    ).action(
      async (opts: {
        config: string;
        interfaceObjectId?: string;
        interfaceType: number;
        asAuthCapId?: string;
        sellerAuthTokenId?: string;
        bandwidth: number;
        startTime: number;
        expTime: number;
        timeGranularity: number;
        timeMinDuration?: number;
        minBandwidth: number;
        price: number;
        coinType: string;
      }) => {
        const ctx = await makeCtx(opts.config);
        const asAuthCapId = resolve(opts.asAuthCapId, ctx.config.as?.asAuthCapId, 'as-auth-cap-id');
        const sellerAuthTokenId = resolve(opts.sellerAuthTokenId, ctx.config.as?.sellerAuthTokenId, 'seller-auth-token-id');
        const interfaceObjectId = resolve(opts.interfaceObjectId, ctx.config.as?.interfaces ? ctx.config.as.interfaces[0] : undefined, 'interface-object-id');

        // Fetch interface object to get isd_as_id and interface_id.
        const interfaceObj = await ctx.client.getObject({
          objectId: interfaceObjectId,
          include: { json: true },
        });
        const interfaceFields = getObjectFields(interfaceObj);
        const isdAsId = BigInt(interfaceFields.isd_as_id as string);
        const interfaceId = interfaceFields.interface_id as number;

        const result = await runTx(
          ctx,
          buildCreateListing({
            packageId: ctx.config.package.id,
            interfaceObjectId,
            interfaceType: opts.interfaceType,
            asAuthCapId,
            sellerAuthTokenId,
            isdAsId,
            interfaceId,
            bandwidth: BigInt(opts.bandwidth),
            startTime: BigInt(opts.startTime),
            expTime: BigInt(opts.expTime),
            timeGranularity: BigInt(opts.timeGranularity),
            timeMinDuration: BigInt(opts.timeMinDuration ?? opts.timeGranularity),
            minBandwidth: BigInt(opts.minBandwidth),
            price: BigInt(opts.price),
            issuer: ctx.signer.getPublicKey().toSuiAddress(),
            coinType: opts.coinType,
          }),
        );
        console.log(result);
        console.log(`Successfully published listing at ${extractCreatedObjectId(result, getObjectType(ctx.config.package.id, "marketplace", `AssetListing<${opts.coinType.toString()}>`))}`)
      },
    ),
  );

  // buy-and-take
  call.addCommand(
    coinTypeOpt(
      configOpt(
        new Command('buy-and-take')
          .description('Buy a listing slice and transfer the resulting asset to the signer')
          .requiredOption('--listing-id <id>', 'Listing ID (ObjectBag key)')
          .requiredOption('--start-time <s>', 'Desired start time (u64)', parseInt)
          .requiredOption('--exp-time <s>', 'Desired expiry time (u64)', parseInt)
          .requiredOption('--bandwidth <n>', 'Desired bandwidth (u64)', parseInt)
          .requiredOption('--max-price <n>', 'Max price to pay for this asset (u64)', parseInt)
          .option('--payment-coin-id <id>', 'Coin object ID to pay with (omit to use the gas coin)'),
      ),
    ).action(
      async (opts: {
        config: string;
        interfaceObjectId: string;
        listingId: string;
        startTime: number;
        expTime: number;
        bandwidth: number;
        maxPrice: number;
        paymentCoinId: string;
        coinType: string;
      }) => {
        const ctx = await makeCtx(opts.config);
        const listing = await ctx.client.getObject({ objectId: opts.listingId, include: { json: true } });
        const interfaceObjectId = listingInterfaceId(listing);

        const result = await runTx(
          ctx,
          buildBuyAndTake({
            packageId: ctx.config.package.id,
            interfaceObjectId: interfaceObjectId,
            listingId: opts.listingId,
            startTime: BigInt(opts.startTime),
            expTime: BigInt(opts.expTime),
            bandwidth: BigInt(opts.bandwidth),
            maxPrice: BigInt(opts.maxPrice),
            coinType: opts.coinType,
          }),
        );
        console.log(`Purchased asset ${extractCreatedObjectId(result,getObjectType(ctx.config.package.id,"hummingbird_asset","HummingbirdAsset"))}`);
      },
    ),
  );

  // redeem
  call.addCommand(
    configOpt(
      new Command('redeem')
        .description('Redeem ingress + egress assets, wait for delivery, and store the reservation')
        .requiredOption('--ingress-asset-id <id>', 'Ingress HummingbirdAsset object ID')
        .requiredOption('--egress-asset-id <id>', 'Egress HummingbirdAsset object ID')
        .requiredOption('--public-key <hex>', 'Public key bytes as hex (0x-prefixed or plain)'),
    ).action(
      async (opts: { config: string; ingressAssetId: string; egressAssetId: string; publicKey: string }) => {
        const ctx = await makeCtx(opts.config);

        const ingressObj = await ctx.client.getObject({ objectId: opts.ingressAssetId, include: { json: true } });
        const ingressFields = getObjectFields(ingressObj);
        const ia          = BigInt(ingressFields['isd_as_id'] as string);
        const ingressIfId = ingressFields['interface_id'] as number;
        const startsAt    = new Date(Number(BigInt(ingressFields['start_time'] as string)));
        const stopsAt     = new Date(Number(BigInt(ingressFields['exp_time']   as string)));

        const egressObj = await ctx.client.getObject({ objectId: opts.egressAssetId, include: { json: true } });
        const egressFields = getObjectFields(egressObj);
        const egressIfId  = egressFields['interface_id'] as number;

        const result = await runTx(
          ctx,
          buildRedeem({
            packageId: ctx.config.package.id,
            ingressAssetId: opts.ingressAssetId,
            egressAssetId: opts.egressAssetId,
            publicKey: hexToBytes(opts.publicKey),
          }),
        );

        const redeemRequestObjectId = extractCreatedObjectId(
          result,
          getObjectType(ctx.config.package.id, 'hummingbird_asset', 'RedeemRequest'),
        );
        console.log(`RedeemRequest created: ${redeemRequestObjectId}`);
        console.log('Waiting for AS to deliver reservation…');

        const grpcClient = createSuiGrpcClient(ctx.config.network.name, ctx.config.network.grpcUrl);
        const dl = new DeliveryListener(grpcClient);
        const delivery = await dl.waitForDelivery(
          redeemRequestObjectId,
          ctx.config.package.id,
          ctx.config.redemption.timeoutSecs * 1000,
        );

        const ak = new TextDecoder().decode(delivery.encryptedReservation);

        const db = openReservationDb(ctx.config.db.path);
        insertReservation(db, {
          resId:     delivery.resId,
          ia,
          ingressId: ingressIfId,
          egressId:  egressIfId,
          bw:        delivery.bwRounded,
          startsAt,
          stopsAt,
          ak,
        });
        db.close();

        console.log(`✓ Reservation stored`);
        console.log(`  res_id : ${delivery.resId}`);
        console.log(`  bw     : ${delivery.bwRounded}`);
        console.log(`  ak     : ${ak}`);
      },
    ),
  );

  // deliver-reservation
  call.addCommand(
    configOpt(
      new Command('deliver-reservation')
        .description('Deliver an encrypted reservation to a pending redeem request')
        .requiredOption('--redeem-request-id <id>', 'RedeemRequest object ID')
        .requiredOption('--encrypted-reservation <hex>', 'Encrypted reservation bytes as hex')
        .requiredOption('--res-id <id>', 'Per AS Reservation Id')
        .requiredOption('--bw-rounded <num>', 'Rounded BW')
        .requiredOption('--bw-dataplane-encoding <enc>', 'Dataplane representation'),
    ).action(
      async (opts: { config: string; redeemRequestId: string; encryptedReservation: string; resId: bigint; bwRounded: bigint; bwDataplanEncoding: number; }) => {
        const ctx = await makeCtx(opts.config);
        await runTx(
          ctx,
          buildDeliverReservation({
            packageId: ctx.config.package.id,
            redeemRequestId: opts.redeemRequestId,
            encryptedReservation: hexToBytes(opts.encryptedReservation),
            resId: opts.resId,
            bwRounded: opts.bwRounded,
            bwDataplaneEncoding: opts.bwDataplanEncoding,
          }),
        );
      },
    ),
  );

  // delist-and-take
  call.addCommand(
    coinTypeOpt(
      configOpt(
        new Command('delist-and-take')
          .description('Remove a listing and return the wrapped asset to the signer')
          .requiredOption('--interface-object-id <id>', 'Interface object ID')
          .requiredOption('--listing-id <id>', 'Listing ID (ObjectBag key)')
          .option('--seller-auth-token-id <id>', 'SellerAuthToken object ID (fallback: as.sellerAuthTokenId in config)'),
      ),
    ).action(
      async (opts: {
        config: string;
        interfaceObjectId: string;
        listingId: string;
        sellerAuthTokenId?: string;
        coinType: string;
      }) => {
        const ctx = await makeCtx(opts.config);
        const sellerAuthTokenId = resolve(opts.sellerAuthTokenId, ctx.config.as?.sellerAuthTokenId, 'seller-auth-token-id');
        await runTx(
          ctx,
          buildDelistAndTake({
            packageId: ctx.config.package.id,
            interfaceObjectId: opts.interfaceObjectId,
            listingId: opts.listingId,
            sellerAuthTokenId,
            coinType: opts.coinType,
          }),
        );
      },
    ),
  );

  // list-listings
  call.addCommand(
    configOpt(
      new Command('list-listings')
        .description('List all listings for a given AS interface')
        .requiredOption('--isd-as-id <n>', 'ISD-AS identifier (u64)', parseInt)
        .requiredOption('--interface-id <n>', 'Interface identifier (u16)', parseInt),
    ).action(async (opts: { config: string; isdAsId: number; interfaceId: number }) => {
      const ctx = await makeCtx(opts.config);
      const globalRegistryId = resolve(undefined, ctx.config.package?.globalRegistryId, 'global-registry-id');

      const asRegistryId = deriveObjectID(
        globalRegistryId,
        'u64',
        bcs.U64.serialize(BigInt(opts.isdAsId)).toBytes(),
      );
      console.log(`[debug] asRegistryId: ${asRegistryId}`);

      const interfaceObjId = deriveObjectID(
        asRegistryId,
        'u16',
        bcs.U16.serialize(opts.interfaceId).toBytes(),
      );
      console.log(`Interface: ${interfaceObjId}`);

      // GraphQL JSON: Bag { id: UID } → `id` is a canonical address string.
      const interfaceObj = await ctx.client.getObject({ objectId: interfaceObjId, include: { json: true } });
      const ifaceJson = interfaceObj.object.json;
      if (!ifaceJson) {
        throw new Error(`Interface object not found at derived ID ${interfaceObjId}`);
      }

      const bagId = (ifaceJson['listings'] as { id: string } | undefined)?.id;
      if (!bagId) {
        throw new Error(`Could not locate listings bag in interface. Raw json:\n${JSON.stringify(ifaceJson, null, 2)}`);
      }

      let cursor: string | null = null;
      let total = 0;
      while (true) {
        const page: SuiClientTypes.ListDynamicFieldsResponse = await ctx.client.listDynamicFields({ parentId: bagId, cursor });
        for (const entry of page.dynamicFields) {
          total++;
          const objectId = entry.$kind === 'DynamicObject' ? entry.childId : entry.fieldId;
          const listingObj = await ctx.client.getObject({ objectId, include: { json: true } });
          console.log(`\nListing ${objectId}:`);
          console.log(JSON.stringify(listingObj.object.json, null, 2));
        }
        if (!page.hasNextPage) break;
        cursor = page.cursor;
      }

      if (total === 0) console.log('No listings found.');
      else console.log(`\nTotal: ${total} listing(s).`);
    }),
  );

  // owned-assets
  call.addCommand(
    configOpt(
      new Command('owned-assets')
        .description('List all owned assets'),
    ).action(async (opts: { config: string; }) => {
      const ctx = await makeCtx(opts.config);

      const result = await ctx.client.listOwnedObjects({
        owner: getDefaultAddress(ctx),
        type: getObjectType(ctx.config.package.id, "hummingbird_asset", "HummingbirdAsset"),
        include: { json: true },
      });

      if (result.objects.length === 0) {
        console.log("No objects found");
        return;
      }

      const COL = { objectId: 66, isdAsId: 20, ifaceId: 9, ifaceType: 10, start: 20, end: 20, bw: 12 };
      const header = [
        'Object ID'.padEnd(COL.objectId),
        'ISD-AS ID'.padEnd(COL.isdAsId),
        'If ID'.padEnd(COL.ifaceId),
        'If Type'.padEnd(COL.ifaceType),
        'Start Time'.padEnd(COL.start),
        'End Time'.padEnd(COL.end),
        'BW (kbps)'.padEnd(COL.bw),
      ].join(' | ');
      const separator = '-'.repeat(header.length);
      console.log(separator);
      console.log(header);
      console.log(separator);

      result.objects.forEach((object) => {
        const fields = object.json as Record<string, unknown> ?? {};
        const ifaceType = fields.interface_type === 0 || fields.interface_type === '0' ? 'ingress' : 'egress';
        console.log([
          object.objectId.padEnd(COL.objectId),
          String(fields.isd_as_id ?? '?').padEnd(COL.isdAsId),
          String(fields.interface_id ?? '?').padEnd(COL.ifaceId),
          ifaceType.padEnd(COL.ifaceType),
          String(fields.start_time ?? '?').padEnd(COL.start),
          String(fields.exp_time ?? '?').padEnd(COL.end),
          String(fields.bandwidth ?? '?').padEnd(COL.bw),
        ].join(' | '));
      });
      console.log(separator);
    }),
  );

  // redeem-requests
  call.addCommand(
    configOpt(
      new Command('redeem-requests')
        .description('Show pending redemption requests'),
    ).action(async (opts: { config: string; }) => {
      const ctx = await makeCtx(opts.config);

      const result = await ctx.client.listOwnedObjects({
        owner: getDefaultAddress(ctx),
        type: getObjectType(ctx.config.package.id, "hummingbird_asset", "RedeemRequest"),
        include: { json: true },
      });

      if (result.objects.length === 0) {
        console.log("No objects found");
        return;
      }

      const COL = { objectId: 66, ingressAsset: 20, egressAsset: 20, publicKey: 20, buyer: 66};
      const header = [
        'Object ID'.padEnd(COL.objectId),
        'Ingress Asset'.padEnd(COL.ingressAsset),
        'Egress Asset'.padEnd(COL.egressAsset),
        'Public Key'.padEnd(COL.publicKey),
        'Buyer'.padEnd(COL.buyer),
      ].join(' | ');
      const separator = '-'.repeat(header.length);
      console.log(separator);
      console.log(header);
      console.log(separator);

      result.objects.forEach((object) => {
        const fields = object.json as Record<string, unknown> ?? {};
        console.log([
          object.objectId.padEnd(COL.objectId),
          String(fields.ingress_asset ?? '?').padEnd(COL.ingressAsset),
          String(fields.egress_asset ?? '?').padEnd(COL.egressAsset),
          String(fields.public_key ?? '?').padEnd(COL.publicKey),
          String(fields.buyer ?? '?').padEnd(COL.buyer),
        ].join(' | '));
      });
      console.log(separator);
    }),
  );

  return call;
}
