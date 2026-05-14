/**
 * Verification error classes — buyers branch on these to distinguish
 * "the data is wrong" (commitment / hash / envelope) from "the network is
 * wrong" (HTTP / parse).
 */

export class KeyCommitmentError extends Error {
  constructor() {
    super("Key commitment mismatch — keeper delivered wrong K_pool");
    this.name = "KeyCommitmentError";
  }
}

export class DecryptDataHashMismatchError extends Error {
  constructor(
    public readonly expected: string,
    public readonly actual: string
  ) {
    super(
      `Data hash mismatch after decrypt: expected ${expected}, got ${actual}`
    );
    this.name = "DecryptDataHashMismatchError";
  }
}

export class DataEnvelopeVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataEnvelopeVerificationError";
  }
}

export class DataPoolHashMismatchError extends Error {
  constructor(
    public readonly expected: string,
    public readonly actual: string
  ) {
    super(`Data hash mismatch: expected ${expected}, got ${actual}`);
    this.name = "DataPoolHashMismatchError";
  }
}

export class PoolMetadataVersionError extends Error {
  constructor(public readonly actual: number) {
    super(`Unsupported PoolMetadata version: ${actual}`);
    this.name = "PoolMetadataVersionError";
  }
}
