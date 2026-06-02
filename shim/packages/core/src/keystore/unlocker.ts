/**
 * Keystore unlock seam.
 *
 * Today the keystore is plaintext, so `PlaintextUnlocker` is a no-op. This
 * interface exists so encrypted-keystore support can be added later WITHOUT
 * changing the loader's call sites: a future `EncryptedUnlocker` would decrypt
 * `raw` using a passphrase sourced elsewhere (env var or CLI prompt) and return
 * the plaintext bytes. The loader is async specifically to accommodate that.
 *
 * Do NOT collapse this back into a synchronous, unlocker-free loader.
 */
export interface Unlocker {
  /**
   * Transform a raw keystore entry's bytes into usable (decrypted) bytes.
   * For plaintext keystores this is the identity function.
   */
  unlock(raw: Uint8Array): Promise<Uint8Array>;
}

/** No-op unlocker for plaintext keystores (the current default everywhere). */
export class PlaintextUnlocker implements Unlocker {
  async unlock(raw: Uint8Array): Promise<Uint8Array> {
    return raw;
  }
}

// FUTURE (not implemented now):
//
// export class EncryptedUnlocker implements Unlocker {
//   constructor(private readonly passphrase: () => Promise<string>) {}
//   async unlock(raw: Uint8Array): Promise<Uint8Array> {
//     const pass = await this.passphrase();
//     return decrypt(raw, pass); // scheme TBD
//   }
// }
