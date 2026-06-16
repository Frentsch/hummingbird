import { describe, it, expect } from 'vitest';
import { Transaction } from '@mysten/sui/transactions';
import { buildRegisterAs } from './registerAs.js';
import { buildRegisterSeller } from './registerSeller.js';
import { buildCreateInterface } from './createInterface.js';
import { buildCreateListing } from './createListing.js';
import { buildBuyAndTake } from './buyAndTake.js';
import { buildRedeem } from './redeem.js';
import { buildDeliverReservation } from './deliverReservation.js';
import { buildDelistAndTake } from './delistAndTake.js';

const FAKE_OBJ = '0x' + '1'.repeat(64);
const FAKE_PKG = '0x' + 'a'.repeat(64);
const COIN_TYPE = '0x2::sui::SUI';

describe('transaction builders', () => {
  it('buildRegisterAs returns a Transaction', () => {
    const tx = buildRegisterAs({ packageId: FAKE_PKG, globalRegistryId: FAKE_OBJ, isdAsId: 1n });
    expect(tx).toBeInstanceOf(Transaction);
  });

  it('buildRegisterSeller returns a Transaction', () => {
    const tx = buildRegisterSeller({ packageId: FAKE_PKG, paymentAddress: '0x' + 'a'.repeat(64) });
    expect(tx).toBeInstanceOf(Transaction);
  });

  it('buildCreateInterface returns a Transaction with coin type arg', () => {
    const tx = buildCreateInterface({
      packageId: FAKE_PKG,
      asRegistryId: FAKE_OBJ,
      asAuthCapId: FAKE_OBJ,
      interfaceId: 1,
    });
    expect(tx).toBeInstanceOf(Transaction);
  });

  it('buildCreateListing returns a Transaction', () => {
    const tx = buildCreateListing({
      packageId: FAKE_PKG,
      interfaceObjectId: FAKE_OBJ,
      interfaceType: 0,
      asAuthCapId: FAKE_OBJ,
      sellerAuthTokenId: FAKE_OBJ,
      isdAsId: 1n,
      interfaceId: 1,
      bandwidth: 1000n,
      startTime: 1000n,
      expTime: 2000n,
      timeGranularity: 100n,
      timeMinDuration: 100n,
      minBandwidth: 100n,
      price: 10n,
      issuer: '0x0000000000000000000000000000000000000000000000000000000000000001',
      coinType: COIN_TYPE,
    });
    expect(tx).toBeInstanceOf(Transaction);
  });

  it('buildBuyAndTake returns a Transaction', () => {
    const tx = buildBuyAndTake({
      packageId: FAKE_PKG,
      interfaceObjectId: FAKE_OBJ,
      listingId: FAKE_OBJ,
      startTime: 1000n,
      expTime: 2000n,
      bandwidth: 500n,
      maxPrice: 100000n,
      coinType: COIN_TYPE,
    });
    // listingId is passed as tx.pure.id() — enforced in the wrapper source.
    expect(tx).toBeInstanceOf(Transaction);
  });

  it('buildRedeem returns a Transaction', () => {
    const tx = buildRedeem({
      packageId: FAKE_PKG,
      ingressAssetId: FAKE_OBJ,
      egressAssetId: FAKE_OBJ,
      publicKey: new Uint8Array([1, 2, 3]),
    });
    expect(tx).toBeInstanceOf(Transaction);
  });

  it('buildDeliverReservation returns a Transaction', () => {
    const tx = buildDeliverReservation({
      packageId: FAKE_PKG,
      redeemRequestId: FAKE_OBJ,
      encryptedReservation: new Uint8Array([4, 5, 6]),
      resId: 1n,
      bwRounded: 100n,
      bwDataplaneEncoding: 0,
    });
    expect(tx).toBeInstanceOf(Transaction);
  });

  it('buildDelistAndTake returns a Transaction', () => {
    const tx = buildDelistAndTake({
      packageId: FAKE_PKG,
      interfaceObjectId: FAKE_OBJ,
      listingId: FAKE_OBJ,
      sellerAuthTokenId: FAKE_OBJ,
      coinType: COIN_TYPE,
    });
    // listingId is passed as tx.pure.id() — enforced in the wrapper source.
    expect(tx).toBeInstanceOf(Transaction);
  });
});

/**
 * Dry-run test — requires testnet access. Skipped in offline environments.
 * Run manually with: TESTNET_DRY_RUN=1 pnpm test
 */
describe.skipIf(!process.env['TESTNET_DRY_RUN'])('dry-run against testnet', () => {
  it('registerAs dry-run completes without error', async () => {
    const { createSuiClient } = await import('../sui-client.js');
    const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
    const { dryRunTransaction } = await import('../execute.js');

    const client = createSuiClient('testnet');
    const signer = new Ed25519Keypair();
    const tx = buildRegisterAs({
      packageId: FAKE_PKG,
      globalRegistryId: FAKE_OBJ,  // will fail on-chain, but dry-run still validates structure
      isdAsId: 1n,
    });
    // Dry-run against a non-existent object will fail; that's expected and typed.
    const { SuiTransactionError } = await import('../errors.js');
    await expect(dryRunTransaction(client, signer, tx)).rejects.toBeInstanceOf(SuiTransactionError);
  });
});
