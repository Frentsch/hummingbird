/**
 * Typed error hierarchy. The server maps these to HTTP status codes in one
 * place (server/src/middleware/errors.ts). Never throw bare Error from core.
 */
export class ShimError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = this.constructor.name;
  }
}

/** Keystore could not be read, parsed, or unlocked. */
export class KeystoreError extends ShimError {}

/** Input failed validation (maps to HTTP 400). */
export class ValidationError extends ShimError {}

/** Caller is not authenticated (maps to HTTP 401). */
export class AuthError extends ShimError {}

/** Caller is authenticated but not permitted this operation (maps to HTTP 403). */
export class PolicyError extends ShimError {}

/** The transaction was submitted but failed on-chain (maps to HTTP 422). */
export class SuiTransactionError extends ShimError {
  constructor(
    message: string,
    public readonly digest?: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}
