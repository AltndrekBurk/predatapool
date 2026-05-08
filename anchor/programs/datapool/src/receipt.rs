use anchor_lang::prelude::*;

/// Off-chain signed authorization to debit a buyer's pre-approved USDC
/// allowance into a specific pool.
///
/// The buyer signs the canonical 104-byte wire format with Ed25519. The
/// `settle_batch` instruction verifies the signature via Solana's Ed25519
/// precompile and then pulls USDC via the SPL token delegate the buyer
/// authorized at setup.
///
/// MUST stay byte-identical to server/src/receipt.ts and app/lib/receipt.ts.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct JoinReceipt {
    pub pool_hash: [u8; 32],
    pub buyer: Pubkey,
    pub max_price: u64,
    pub nonce: u64,
    pub deadline: i64,
}

impl JoinReceipt {
    /// 16-byte ASCII domain tag — prevents a buyer's signature from being
    /// replayable in any other protocol that happens to hash structured data.
    pub const DOMAIN: &'static [u8; 16] = b"DATAPOOL_JOIN_V1";

    /// Canonical wire size: 16 (domain) + 32 (pool_hash) + 32 (buyer)
    /// + 8 (max_price) + 8 (nonce) + 8 (deadline) = 104.
    pub const WIRE_SIZE: usize = 104;

    /// Anchor-serialized struct size (no domain tag): 32 + 32 + 8 + 8 + 8 = 88.
    pub const STRUCT_SIZE: usize = 88;

    /// Reconstruct the exact byte string the buyer signed.
    pub fn canonical_bytes(&self) -> [u8; Self::WIRE_SIZE] {
        let mut out = [0u8; Self::WIRE_SIZE];
        out[0..16].copy_from_slice(Self::DOMAIN);
        out[16..48].copy_from_slice(&self.pool_hash);
        out[48..80].copy_from_slice(&self.buyer.to_bytes());
        out[80..88].copy_from_slice(&self.max_price.to_le_bytes());
        out[88..96].copy_from_slice(&self.nonce.to_le_bytes());
        out[96..104].copy_from_slice(&self.deadline.to_le_bytes());
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_bytes_layout() {
        let r = JoinReceipt {
            pool_hash: [0xAB; 32],
            buyer: Pubkey::new_from_array([0xCD; 32]),
            max_price: 0x0102030405060708,
            nonce: 0x1112131415161718,
            deadline: 0x2122232425262728,
        };

        let bytes = r.canonical_bytes();
        assert_eq!(&bytes[0..16], JoinReceipt::DOMAIN);
        assert_eq!(&bytes[16..48], &[0xAB; 32]);
        assert_eq!(&bytes[48..80], &[0xCD; 32]);
        // u64 LE
        assert_eq!(&bytes[80..88], &0x0102030405060708u64.to_le_bytes());
        assert_eq!(&bytes[88..96], &0x1112131415161718u64.to_le_bytes());
        assert_eq!(&bytes[96..104], &0x2122232425262728i64.to_le_bytes());
    }

    #[test]
    fn struct_serializes_smaller_than_wire() {
        // Anchor serialization (no domain tag) is the on-the-wire ix arg form;
        // canonical_bytes adds the domain prefix used for sig verification.
        let r = JoinReceipt {
            pool_hash: [1; 32],
            buyer: Pubkey::new_unique(),
            max_price: 1_000_000,
            nonce: 1,
            deadline: 1_700_000_000,
        };
        let mut buf = Vec::new();
        AnchorSerialize::serialize(&r, &mut buf).unwrap();
        assert_eq!(buf.len(), JoinReceipt::STRUCT_SIZE);
    }
}
