import type { Address } from "@solana/kit";

export type WalletAccount = {
  address: Address;
  publicKey: Uint8Array;
  label?: string;
};

export type WalletConnectorMetadata = {
  id: string;
  name: string;
  icon?: string;
};

export type WalletSession = {
  account: WalletAccount;
  connector: WalletConnectorMetadata;
  disconnect: () => Promise<void>;
  signTransaction?: (
    transaction: Uint8Array,
    chain: string
  ) => Promise<Uint8Array>;
  sendTransaction?: (
    transaction: Uint8Array,
    chain: string
  ) => Promise<Uint8Array>;
  /**
   * Off-chain Ed25519 signature over an arbitrary byte string.
   * Used for JoinReceipts so a buyer can authorize a batched on-chain
   * settlement without signing a transaction per join.
   *
   * Returns both the bytes the wallet actually signed and the signature.
   * Most Solana wallets sign the input verbatim, but the wallet-standard
   * spec permits prefixing — the signature must be verified against
   * `signedMessage`, not the input.
   */
  signMessage?: (message: Uint8Array) => Promise<{
    signedMessage: Uint8Array;
    signature: Uint8Array;
  }>;
};

export type WalletConnector = WalletConnectorMetadata & {
  connect: (options?: { silent?: boolean }) => Promise<WalletSession>;
};
