# docs/external — İndirilen Harici Dokümantasyon

Bu klasör PreDataPool geliştirmesiyle doğrudan ilgili harici kaynakların
yerel kopyalarını içerir. Codex ve diğer ajanlar internet erişimi olmadan
bu dosyalara başvurabilir.

Son güncelleme: 2026-05-11

---

## simd/ — Solana Improvement Documents

Kaynak: https://github.com/solana-foundation/solana-improvement-documents

| Dosya | Konu | PreDataPool İlgisi |
|---|---|---|
| `0001-simd-process.md` | SIMD süreç tanımı | Referans |
| `0033-timely-vote-credits.md` | Zamanında oy kredileri | AoI / veri tazeliği modeli |
| `0083-relax-entry-constraints.md` | Entry kısıtlamalarını gevşet | Transaction yapısı |
| `0096-reward-collected-priority-fee-in-entirety.md` | Priority fee dağıtımı | Provider gelir modeli |
| `0339-increase-cpi-account-info-limit.md` | CPI hesap limiti artırımı | Light Protocol CPI çağrıları |
| `0385-transaction-v1.md` | Transaction v1 formatı | settle_receipt tx yapısı |
| `0388-bls12-381-syscalls.md` | BLS12-381 syscall'ları | Gelecek: BLS imzalama |
| `0436-reduce-rent-exempt-minimum-by-2x.md` | Rent minimumunu düşür | Hesap açma maliyeti |
| `0512-sha512-syscall.md` | SHA-512 syscall | Şifreleme genişletmesi |

---

## anchor/ — Anchor + Solana Core Docs

Kaynak: https://www.anchor-lang.com / https://github.com/solana-foundation/developer-content

| Dosya | Konu | PreDataPool İlgisi |
|---|---|---|
| `account-constraints.md` | Anchor kısıt makroları | DataPool constraints (keeper, fetched_at) |
| `custom-errors.md` | Anchor hata tanımları | DataPoolError enum |
| `solana-accounts.md` | Solana hesap modeli | PDA, rent, account lifecycle |
| `solana-transactions.md` | Transaction anatomisi | settle_receipt tx layout |
| `solana-programs.md` | Program geliştirme | Anchor program temelleri |
| `solana-deploying.md` | Program deploy | Devnet deploy adımları |
| `solana-pda.md` | Program Derived Address | data_pool/escrow/protocol_delegate PDA'ları |
| `solana-cpi.md` | Cross-Program Invocation | Light Protocol CPI, SPL Token CPI |
| `solana-tokens.md` | SPL Token | USDC escrow, token hesapları |

---

## light-protocol/ — Light Protocol (ZK Compression)

Kaynak: https://github.com/Lightprotocol/light-protocol

| Dosya | Konu | PreDataPool İlgisi |
|---|---|---|
| `light-protocol-README.md` | Genel bakış | CompressedBuyerSlot neden seçildi |
| `DOCS.md` | Dokümantasyon rehberi | Light SDK kullanımı |
| `INSTALL.md` | Kurulum | Light SDK kurulum adımları |
| `compressible-README.md` | Compressible hesaplar | BuyerSlot sıkıştırma pattern |
| `compressed-account-README.md` | Compressed account API | settle_receipt CPI detayları |

**Bu projede:** `server/src/light.ts` → `prepareSettleReceiptCpi()` Photon RPC
üzerinden validity proof + address tree bilgisi alır, settle_receipt'e iletir.

---

## x402/ — x402 Ödeme Protokolü

Kaynak: https://github.com/coinbase/x402

| Dosya | Konu | PreDataPool İlgisi |
|---|---|---|
| `x402-spec.md` | Ana README / spec | x402 genel protokol |
| `introduction.md` | Protokol girişi | Neden x402, nasıl çalışır |
| `client-server.md` | Client-server akışı | Keeper upstream'e nasıl öder |
| `facilitator.md` | Facilitator rolü | Keeper'ın facilitator olarak konumu |
| `http-402.md` | HTTP 402 semantiği | mock-upstream 402 yanıtı |
| `wallet.md` | Cüzdan entegrasyonu | Keeper KeyPairSigner |
| `faq.md` | Sık sorulan sorular | Protokol tasarım kararları |
| `sdk-features.md` | SDK özellikleri | @solana/mpp kullanımı |
| `AGENTS.md` | x402 Codex kuralları | x402 geliştirme rehberi |

**Bu projede:** `server/src/fetcher.ts` → upstream API 402 döndürünce
`@solana/mpp` `solana.charge()` çağrısı ile ödeme yapılır.

---

## noble/ — @noble Kriptografi

Kaynak: https://github.com/paulmillr/noble-*

| Dosya | Konu | PreDataPool İlgisi |
|---|---|---|
| `noble-ciphers-README.md` | AES-GCM, ChaCha20 | At-rest şifreleme (AES-256-GCM) |
| `noble-curves-README.md` | ed25519, x25519, secp256k1 | ECIES x25519 key delivery |
| `noble-hashes-README.md` | SHA-256, HKDF, HMAC | keyCommitment, HKDF wrap key |

**Bu projede:**
- `server/src/crypto.ts` + `app/lib/crypto.ts` → tüm noble kütüphanelerini kullanır
- Audit edilmiş kütüphaneler — başka kripto lib ekleme

---

## Hızlı Başvuru

```
# Hangi SIMD Ed25519 native program'ı tanımlar?
→ Ed25519 Solana'da built-in; SIMD-0083 entry constraint'lerle ilgili

# settle_receipt'te CPI hesap limiti neden önemli?
→ simd/0339-increase-cpi-account-info-limit.md

# x25519 ile AES-256-GCM nasıl birleştirilir?
→ noble/noble-curves-README.md (x25519 ECDH) + noble/noble-ciphers-README.md (GCM)

# Light Protocol BuyerSlot nasıl compress edilir?
→ light-protocol/compressed-account-README.md + light-protocol/DOCS.md

# Keeper upstream'e x402 ödemesi nasıl yapar?
→ x402/client-server.md + x402/facilitator.md
```
