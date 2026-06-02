import { z } from 'zod';

const SuiObjectId = z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'Must be a 0x-prefixed 64-hex-char Sui object ID');
const Uint64Str = z.string().regex(/^\d+$/, 'Must be an unsigned integer string');
const Uint8Str =   z.string().regex(/^\d+$/, 'Must be an unsigned integer string');
const CoinType = z.string().min(1);

export const RegisterAsBody = z.object({
  globalRegistryId: SuiObjectId,
  isdAsId: Uint64Str.transform(BigInt),
});

export const RegisterSellerBody = z.object({
  paymentAddress: SuiObjectId,
});

export const CreateInterfaceBody = z.object({
  asRegistryId: SuiObjectId,
  asAuthCapId: SuiObjectId,
  interfaceId: z.number().int().min(0).max(65535),
  coinType: CoinType,
});

export const CreateListingBody = z.object({
  interfaceObjectId: SuiObjectId,
  asAuthCapId: SuiObjectId,
  interfaceType: z.number().int().min(0).max(255),
  sellerAuthTokenId: SuiObjectId,
  bandwidth: Uint64Str.transform(BigInt),
  startTime: Uint64Str.transform(BigInt),
  expTime: Uint64Str.transform(BigInt),
  timeGranularity: Uint64Str.transform(BigInt),
  minBandwidth: Uint64Str.transform(BigInt),
  price: Uint64Str.transform(BigInt),
  coinType: CoinType,
});

export const BuyAndTakeBody = z.object({
  interfaceObjectId: SuiObjectId,
  listingId: SuiObjectId,
  startTime: Uint64Str.transform(BigInt),
  expTime: Uint64Str.transform(BigInt),
  bandwidth: Uint64Str.transform(BigInt),
  maxPrice: Uint64Str.transform(BigInt),
  paymentCoinId: SuiObjectId,
  coinType: CoinType,
});

export const RedeemBody = z.object({
  ingressAssetId: SuiObjectId,
  egressAssetId: SuiObjectId,
  publicKey: z.array(z.number().int().min(0).max(255)),
});

export const DeliverReservationBody = z.object({
  redeemRequestId: SuiObjectId,
  encryptedReservation: z.array(z.number().int().min(0).max(255)),
});

export const DelistAndTakeBody = z.object({
  interfaceObjectId: SuiObjectId,
  listingId: SuiObjectId,
  sellerAuthTokenId: SuiObjectId,
  coinType: CoinType,
});

export const SubmitBody = z.object({
  txBytes: z.string().min(1),
});

export const AddCallerBody = z.object({
  key: z.string().min(8, 'API key must be at least 8 characters'),
});
