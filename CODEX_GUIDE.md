# PreDataPool — Codex Rehberi

> Bu dosya ChatGPT Codex'in projeye cold-start yapabilmesi için hazırlanmıştır.
> Son güncelleme: 2026-05-11

---

## 1. Projenin Özü

**PreDataPool**, birden fazla yapay zeka ajanının/yada farklı makinelerin iotlerin  aynı API verisini tek seferinde çekip maliyeti paylaşmasını sağlayan bir Solana L2-tarzı protokoldür.

### Temel Sorun

```
cloud-flaerin off-chain yaptığı veri tasarrufu gibi ama onchain hali bu mpp-x402-makine ödemeleri-iot lere özel özelleşmiş olrusa daha iyi olur .
iot/edge computig kategorisnde.
Agent A → API → $0.10 öder → veriyi kullanır
Agent B → API → $0.10 öder → AYNI veriyi kullanır   ← gereksiz çift ödeme
```

### Çözüm

```
Agent A → PreDataPool matcher → API'ye tek istek → $0.10 / N buyer
Agent B → PreDataPool matcher → cache hit        → $0.10 / N buyer
                                                     N kişi paylaşır → N×tasarruf
```

### Ekonomik Model

- **Buyer-side time-decay:** Veri eskidikçe fiyat düşer (AoI — Age of Information)  
- **Provider gelir payı:** Provider, her erişimde `provider_share_bps` oranında USDC alır  
- **Sponsor rebate:** Fetch'i tetikleyen erken alıcılar, post-fetch gelirden geri ödeme alır  
- **x402 ödeme döngüsü:** Keeper upstream API'ye `@solana/mpp` ile ödeme yapar gelecekte bu solandaki ligh protocol ile ödemeler birleştirilebir verimlilik iiçin.
- **ekonkmik tasarrufu** provider zrar uğratılmaz aksine tasaruf edilen hesaplama malieyeti paylaşır hereks kaznaçlı olur.darboğaz azalır.öleklenme artar.

---

## 2. Teknoloji Yığını

| Katman | Teknoloji |
|---|---|
| Blockchain | Solana (devnet) |
| Program | Anchor 0.32.1 (Rust) |
| Sıkıştırma | Light Protocol (compressed BuyerSlot) |
| Ödeme | x402 / `@solana/mpp` |
| Server | Node.js + Express + TypeScript |
| Cache | SQLite (`better-sqlite3`)-UYGUN GÖRÜRSEN hız önemli tabikİ |
| Şifreleme | AES-256-GCM + ECIES x25519 (`@noble/*`) |
| Frontend | Next.js 16 + React 19 + Tailwind v4 |
| Solana Client | `@solana/kit`, `@coral-xyz/anchor` |

---

## 3. Dizin Yapısı

```
predatapool/
├── anchor/                          # Solana programı (Rust/Anchor)
│   └── programs/datapool/src/
│       ├── lib.rs                   # Tüm instruction dispatch'leri
│       ├── state.rs                 # DataPool, BuyerSlot, CompressedBuyerSlot
│       ├── error.rs                 # DataPoolError enum
│       ├── receipt.rs               # JoinReceipt canonical layout
│       ├── instructions/
│       │   ├── mod.rs
│       │   ├── initialize_pool.rs
│       │   ├── join_pool.rs
│       │   ├── trigger_fetch.rs
│       │   ├── register_dataset.rs  # key_commitment kabul eder
│       │   ├── settle_receipt.rs    # Light CPI + Ed25519 verify
│       │   ├── claim_rebate.rs      # Sponsor geri ödemesi
│       │   └── claim_provider_revenue.rs
│       └── tests.rs                 # Unit testler (DataPool math)
├── server/src/                      # Off-chain keeper + matching server
│   ├── index.ts                     # HTTP API (Express)
│   ├── matcher.ts                   # Pool oluşturma / birleştirme mantığı
│   ├── keeper.ts                    # Anchor program çağrıları
│   ├── store.ts                     # SQLite PoolStore (cache)
│   ├── crypto.ts                    # AES-GCM + ECIES şifreleme
│   ├── fetcher.ts                   # Upstream HTTP + x402 ödeme
│   ├── providers.ts                 # Provider kayıt defteri (endpoint → agreement)
│   ├── decay.ts                     # DECAY_PRESETS + currentPrice
│   ├── batch.ts                     # Off-chain receipt kuyruğu
│   ├── receipt.ts                   # JoinReceipt canonical serializasyon
│   ├── light.ts                     # Light Protocol CPI hazırlık
│   ├── mock-upstream.ts             # Test upstream (MPP/x402 konuşur)
│   └── smoke-x402.ts                # x402 entegrasyon smoke test
└── app/                             # Next.js frontend
    ├── lib/
    │   ├── crypto.ts                # BUYER-SIDE şifre çözme (yeni)
    │   ├── server-api.ts            # HTTP client SDK
    │   ├── lifecycle.ts             # Pool yaşam döngüsü vocab
    │   ├── program.ts               # On-chain PDA derivation
    │   ├── receipt.ts               # JoinReceipt yapısı
    │   └── hooks/
    │       ├── use-sign-receipt.ts  # Wallet receipt imzalama
    │       └── use-approve-delegate.ts
    └── components/
        ├── pool-card.tsx            # Ana UI bileşeni
        ├── pool-list.tsx            # Pool listesi
        ├── kpi-strip.tsx            # KPI şeridi
        └── datapool-request-form.tsx
```

---

## 4. On-Chain Program (Anchor)

### Program ID
`62pKxmwZxC7SA4TSYW7FYAxewRU6UXKT2bh7xC55Kg4D` (devnet)

### DataPool State Alanları

```rust
pub struct DataPool {
    pub request_hash: [u8; 32],        // SHA-256(canonical request)
    pub keeper: Pubkey,
    pub usdc_mint: Pubkey,
    pub escrow: Pubkey,
    pub base_price_usdc: u64,          // Micro-USDC (6 decimal)
    pub min_buyers: u8,
    pub buyer_count: u8,
    pub total_collected: u64,
    pub total_distributed: u64,
    pub fetched_at: i64,               // 0 = henüz çekilmedi
    pub data_hash: [u8; 32],           // SHA-256(plaintext payload)
    pub decay_bps_per_hour: u16,       // 100 = %1/saat
    pub is_open: bool,
    pub provider: Pubkey,
    pub provider_share_bps: u16,       // Post-fetch gelirden provider payı
    pub provider_decay_bps_per_hour: u16,
    pub provider_paid: u64,            // İnkremental claim için
    pub pre_fetch_collected: u64,      // Sponsor rebate hesabı için
    pub storage_uri: String,           // max 128 char — payload URL
    pub key_commitment: [u8; 32],      // SHA-256("DATAPOOL_K_V1" || K_pool)
    pub bump: u8,
}
```

### PDA Türetme

```typescript
// DataPool PDA
["data_pool", request_hash_bytes]  →  pool account

// Escrow token account PDA
["escrow", request_hash_bytes]     →  USDC escrow

// Escrow authority PDA
["escrow_authority", pool_pubkey]  →  escrow transfer signer

// Protocol delegate PDA (global — tüm poollar için tek)
["protocol_delegate"]              →  buyer token delegate
```

### Instruction'lar

| Instruction | Kim Çağırır | Ne Yapar |
|---|---|---|
| `initialize_pool` | Keeper | Yeni DataPool hesabı açar |
| `join_pool` | Buyer | Legacy: USDC yatırır, BuyerSlot açar |
| `trigger_fetch` | Keeper | Pool'u "fetched" olarak işaretler, data_hash yazar |
| `register_dataset` | Keeper | storage_uri + key_commitment yazar, is_open=true |
| `settle_receipt` | Keeper | Ed25519 verify + CompressedBuyerSlot oluşturur |
| `claim_rebate` | Buyer (sponsor) | Pre-fetch sponsor geri ödemesi alır |
| `claim_provider_revenue` | Provider | Time-decayed gelir payını çeker |

---

## 5. Server HTTP API

Çalışma portu: `3001` (varsayılan)  
ENV: `PORT`, `SERVER_BASE_URL`, `SOLANA_RPC_URL`, `KEEPER_KEYPAIR_PATH`

```
POST /request                  ← Yeni data isteği / pool'a katıl
GET  /pools                    ← Tüm pool listesi
GET  /pool/:hash               ← Tek pool detayı
GET  /pool/:hash/metadata      ← Read-side SDK sözleşmesi (v1)
GET  /pool/:hash/payload       ← Şifreli payload baytları (AES-GCM ciphertext)
POST /pool/:hash/key           ← ECIES wrapped K_pool teslimi (imza gerekli)
GET  /pool/:hash/batch         ← Bekleyen receipt kuyruğu (debug)
POST /receipt                  ← Signed JoinReceipt kabul et
GET  /batches                  ← Pending receipt'li tüm pool'lar
GET  /health                   ← Sağlık kontrolü
```

### POST /request Gövdesi

```json
{
  "endpoint": "https://api.weatherxm.com/v1/cells",
  "method": "GET",
  "params": { "lat": "41.0", "lon": "29.0" },
  "buyerPubkey": "<base58>",
  "dataType": "weather",
  "freshnessWindowSecs": 60
}
```

### POST /pool/:hash/key Gövdesi

```json
{
  "buyer": "<base58 wallet>",
  "encPubkey": "<32-byte hex x25519 pubkey>",
  "nonce": "<unix-ms as string>",
  "signature": "<64-byte hex ed25519 sig>"
}
```

İmzalanan mesaj (deterministic):
```
"DATAPOOL_KEYREQ_V1" || pool_hash (32B) || encPubkey (32B) || nonce (8B BE)
```

---

## 6. Şifreleme Protokolü

### At-Rest Şifreleme (server/src/crypto.ts)

```
K_pool := random 256-bit      // Per-pool simetrik anahtar
C := AES-256-GCM(K_pool, plaintext, iv=random96)
key_commitment := SHA-256("DATAPOOL_K_V1" || K_pool)   // On-chain kaydedilir

// Buyer için anahtar teslimatı (ECIES):
eph := fresh x25519 keypair
shared := x25519(eph_priv, buyer_x25519_pub)
wrap_key := HKDF-SHA256(shared, salt=eph_pub, info="DATAPOOL_WRAP_V1", L=32)
blob := AES-256-GCM(wrap_key, K_pool, iv=0)
wrapped := eph_pub (32B) || blob (48B) = 80 bayt
```

### Buyer-Side Çözme (app/lib/crypto.ts)

```typescript
// 1. X25519 keypair türet (session cache'li — wallet'ı 1 kez imzalar)
deriveBuyerX25519(signMessage, walletRef)

// 2. Tam decrypt akışı
fetchDecryptAndVerify({
  poolHashHex, buyerPubkey, dataHash,
  signMessage, walletRef
})
// İç adımlar:
// a. X25519 keypair türet (cache hit varsa atla)
// b. Key-request mesajını imzala
// c. POST /pool/:hash/key → wrapped K_pool al
// d. GET /pool/:hash/payload → ciphertext + IV header
// e. K_pool'u unwrap et
// f. key_commitment doğrula
// g. AES-256-GCM decrypt
// h. SHA-256(plaintext) == data_hash doğrula
```

### Güven Zinciri

```
On-chain key_commitment = SHA-256("DATAPOOL_K_V1" || K_pool)
  → Buyer, unwrap ettiği K_pool'un commitment'ı eşleşiyor mu diye kontrol eder
  → Keeper farklı buyer'lara farklı K_pool veremez (commitment tekil)

On-chain data_hash = SHA-256(plaintext)
  → Decrypt sonrası plaintext hash'i on-chain ile karşılaştırılır
  → Keeper sahte veri yazamaz
```

---

## 7. Pool Yaşam Döngüsü

```
pending   → fetching  → fetched   → stale (expires_at geçti)
           (min_buyers    (data + key_commitment
            dolduğunda)    on-chain'e yazıldı)
```

Frontend'deki `poolLifecycle()` fonksiyonu (`app/lib/lifecycle.ts`) bu durumları
etiket ve rozet olarak çevirir:

| Durum | Etiket | Anlamı |
|---|---|---|
| pending | Waiting for buyers | min_buyers dolmadı |
| fetching | Fetching data | Keeper upstream'e istek attı |
| fetched + geçerli | Cached | Veri taze, payload sunuluyor |
| fetched + süresi dolmuş | Stale | TTL geçti, sonraki istek yeniden çeker |

---

## 8. Decay (AoI Tabanlı Fiyatlama)

```typescript
// server/src/decay.ts
DECAY_PRESETS = {
  weather:      { basePriceUsdc: 100_000, decayBpsPerHour: 100  },  // $0.10, -1%/saat
  gps_rtk:      { basePriceUsdc: 500_000, decayBpsPerHour: 667  },  // $0.50, -6.67%/saat
  map_imagery:  { basePriceUsdc:  20_000, decayBpsPerHour:   1  },  // $0.02, -0.01%/saat
  iot_sensor:   { basePriceUsdc:  10_000, decayBpsPerHour: 200  },  // $0.01, -2%/saat
  api_response: { basePriceUsdc:  50_000, decayBpsPerHour: 500  },  // $0.05, -5%/saat
}

// On-chain eşdeğer (state.rs):
current_price(t) = base_price × max(0, 10000 - decay_bps × hours_elapsed) / 10000
                   minimum: 1 micro-USDC
```

---

## 9. Provider Kayıt Defteri (server/src/providers.ts)

Şu an statik in-memory harita. Her giriş:

```typescript
interface ProviderAgreement {
  provider: PublicKey;          // Provider cüzdanı
  basePriceUsdc: number;        // Buyer başlangıç fiyatı
  buyerDecayBpsPerHour: number; // Buyer decay hızı
  providerShareBps: number;     // Post-fetch gelirden provider payı
  providerDecayBpsPerHour: number; // Provider hakkının eskime hızı
  minBuyers: number;            // Fetch için minimum alıcı sayısı
  freshnessWindowSecs: number;  // Cache geçerlilik süresi
  upstream: UpstreamPayment;    // { kind: "free" | "apiKey" | "mpp" }
}
```

Kayıtlı providerlar:
- `api.weatherxm.com` — API key, $0.10, 60s freshness
- `hivemapper-api.com` — API key, $0.05, 86400s freshness
- `localhost:4001` — MPP/x402 (mock-upstream)

---

## 10. Receipt Batching (Off-Chain Ödeme)

`join_pool` on-chain çok pahalı → off-chain ed25519 receipt sistemi:

```
Buyer → imzalar JoinReceipt (104 bayt) → POST /receipt
Keeper → biriktirip → settle_receipt(Ed25519 ix + CPI) → on-chain
```

```typescript
// server/src/receipt.ts — canonical layout (104 bayt)
pool_hash (32) | buyer (32) | max_price (8) | nonce (8) | deadline (8) | padding (16)
```

CompressedBuyerSlot → Light Protocol Merkle tree'ye yazar (~0.002 SOL yerine ~0 SOL rent)

---

## 11. Mevcut Durum: Tamamlanan vs Eksik

### ✅ Tamamlanan

- Canonical request hash + pool matching
- x402 / `@solana/mpp` ödeme döngüsü (mock-upstream ile çalışır)
- SQLite persistent cache + TTL + prune
- AES-256-GCM at-rest şifreleme
- ECIES x25519 key delivery (`/pool/:hash/key`)
- `key_commitment` on-chain (register_dataset)
- Buyer-side fetchDecryptAndVerify (app/lib/crypto.ts)
- AoI time-decay fiyatlama (on-chain + off-chain)
- Provider gelir payı + claim_provider_revenue
- Sponsor rebate + claim_rebate (pre_fetch_collected bug düzeltildi)
- Off-chain receipt batching + settle_receipt (Light CPI)
- Frontend: lifecycle vocab, KPI strip, Verify Payload (decrypt+verify), PDA explorer

### 🔴 Kritik Eksikler (Öncelik Sırasıyla)

#### 1. DataEnvelope — Provider İmzası Yok

Provider'ın gerçekten bu veriyi ürettiğini kanıtlayan imza yok.  
Keeper şu an hem `data_hash`'i hem `key_commitment`'ı seçiyor — dürüst keeper varsayımı kırılamıyor.

**Hedef yapı:**
```
DataEnvelope {
  payload_bytes,
  source_url,
  fetched_at,
  expires_at,
  merkle_root: SHA-256(payload || source_url || fetched_at),
  provider_sig: Ed25519(merkle_root, provider_private_key),  ← EKSİK
  keeper_sig:   Ed25519(merkle_root, keeper_private_key),    ← EKSİK
}
```

**Nerede eklenmeli:**
- `server/src/fetcher.ts` — Provider'dan imza talep et
- `server/src/index.ts` — Envelope'u store'a kaydet
- `anchor/programs/datapool/src/state.rs` — `merkle_root: [u8; 32]` ekle
- `anchor/programs/datapool/src/instructions/register_dataset.rs` — Merkle root kabul et

#### 2. Agent SDK Paketi Yok

Ajan geliştiricisi ne entegre etsin? HTTP API var ama:
- `npm` paketi yok (`@predatapool/sdk`)
- Dokümantasyon yok
- Örnek ajan kodu yok

**Hedef:**
```typescript
import { DataPool } from "@predatapool/sdk";
const pool = new DataPool({ serverUrl: "...", wallet });
const data = await pool.fetch("https://api.weatherxm.com/...", { params });
```

**Nerede oluşturulmalı:**
- `sdk/` dizini — `app/lib/server-api.ts` + `app/lib/crypto.ts` temel alınabilir
- `sdk/package.json` — `name: "@predatapool/sdk"`, `publishConfig`

#### 3. Gerçek Provider Entegrasyonu Yok

`WeatherXM` ve `Hivemapper` kayıtlı ama sadece `mock-upstream` çalışır durumda.

**Yapılacak:**
- WeatherXM API key ile gerçek istek testi
- Provider'ın gerçekten on-chain `claim_provider_revenue` çağırması

#### 4. Privacy / Opt-Out Yok

Hassas veri paylaşmak istemeyen buyer/provider için mekanizma yok.

---

## 12. Geliştirme Ortamı

### Kurulum

```bash
# Bağımlılıklar
npm install

# Anchor build (Rust programı)
export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$PATH"
anchor build   # anchor/ dizininde çalıştır

# Codama TypeScript client üret
npm run codama:js
```

### Ortam Değişkenleri

```bash
# server/.env (örnek)
PROGRAM_ID=62pKxmwZxC7SA4TSYW7FYAxewRU6UXKT2bh7xC55Kg4D
SOLANA_RPC_URL=https://api.devnet.solana.com
KEEPER_KEYPAIR_PATH=~/.config/solana/id.json
USDC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
SERVER_BASE_URL=http://localhost:3001
DATAPOOL_STORE_PATH=cache/datapool.db
SETTLE_INTERVAL_MS=5000
PRUNE_INTERVAL_MS=30000

# Provider pubkey'leri (opsiyonel)
WEATHERXM_API_KEY=...
WEATHERXM_PROVIDER_PUBKEY=...
MOCK_PROVIDER_PUBKEY=...
```

### Çalıştırma

```bash
# Terminal 1 — Mock upstream (x402/MPP test server)
cd server && npm run mock-upstream

# Terminal 2 — Matching server
cd server && npm run dev

# Terminal 3 — Frontend
npm run dev   # http://localhost:3000
```

### Test

```bash
# Crypto testleri (10 test)
cd server && npx tsx --test src/crypto.test.ts

# Store testleri (6 test)
cd server && npx tsx --test src/store.test.ts

# x402 smoke test (mock-upstream çalışıyor olmalı)
cd server && npx tsx src/smoke-x402.ts

# Anchor unit testleri
anchor test --skip-deploy

# TypeScript type check (frontend + server)
npx tsc --noEmit
```

---

## 13. Kritik Kararlar ve Gerekçeler

| Karar | Gerekçe |
|---|---|
| SQLite (better-sqlite3) | Senkron API, sıfır harici daemon, yeterli throughput |
| Schema sürümü (SCHEMA_VERSION=2) | Encrypted schema → eski DB'yi sıfırla, rebuild doğal |
| ECIES x25519 (noble/curves) | Ed25519 cüzdan public key'den doğrudan x25519 türetme mümkün (edwardsToMontgomeryPub) |
| Zero-IV in ECIES wrap | Her wrap için taze ephemeral key → nonce reuse güvenli |
| Off-chain receipt | on-chain join_pool ~0.00025 SOL × N buyer — Light CPI ile compress edildi |
| pre_fetch_collected | sponsor rebate hesabı doğru: post_fetch_revenue = total_collected - pre_fetch_collected |
| Session-cached x25519 derivation | WeakMap cache → her decrypt için wallet prompt yok |

---

## 14. Bilinen Sorunlar

| Sorun | Durum | Konum |
|---|---|---|
| Wallet mesaj ön-eki | Bazı cüzdanlar signMessage'a prefix ekler → key-request 403 verebilir | app/lib/crypto.ts:signMessage |
| Keeper float | Keeper kendi cüzdanından x402 öder, geri alamaz | server/src/fetcher.ts — USDC float TODO |
| Tek keeper | SPOF — keeper çöktüğünde fetch durur | server/src/keeper.ts |
| In-memory nonce set | Server restart → replay protection sıfırlanır | server/src/index.ts:seenKeyReqNonces |
| Provider imzası yok | Keeper dürüst varsayımı kırılamıyor | server/src/crypto.ts — DataEnvelope eksik |

---

## 15. Sonraki Adımlar (Önerilen Sıra)

```
1. DataEnvelope + provider imzası
   → server/src/fetcher.ts: upstream'den imza talep et
   → server/src/store.ts: PayloadRecord'a merkle_root + provider_sig ekle
   → anchor state.rs: merkle_root alanı
   → anchor register_dataset.rs: merkle_root argümanı

2. Agent SDK paketi
   → sdk/src/index.ts: DataPool class (fetch + verify wrapper)
   → sdk/package.json: @predatapool/sdk

3. WeatherXM gerçek entegrasyon
   → WEATHERXM_API_KEY ile providers.ts testi
   → Gerçek provider claim_provider_revenue akışı

4. Keeper çoklama / fault tolerance
   → Keeper state paylaşımı (Redis veya on-chain mutex)

5. AoI-aware eviction
   → store.ts prune: basit TTL yerine veri tipine göre öncelikli temizlik
```

---

## 16. Harici Kaynaklar ve Dokümantasyon

### Solana Çekirdeği
| Kaynak | URL |
|---|---|
| Solana Docs | https://solana.com/docs |
| Hesap Modeli | https://solana.com/docs/core/accounts |
| Transaction Anatomy | https://solana.com/docs/core/transactions |
| Program Deploy | https://solana.com/docs/programs/deploying |
| Solana Cookbook | https://solanacookbook.com |

### Solana Improvement Documents (SIMD)
Protokol seviyesi değişiklik önerileri — özellikle `Ed25519` verify (SIMD-0083) ve
token extension'lar (SIMD-0096) bu proje için kritik.

```
Repo:    https://github.com/solana-foundation/solana-improvement-documents
Dizin:   proposals/SIMD-NNNN.md
Okuma:   curl -s https://raw.githubusercontent.com/solana-foundation/\
               solana-improvement-documents/main/proposals/SIMD-0083.md
```

### Anchor Framework
| Kaynak | URL |
|---|---|
| Anchor Docs | https://www.anchor-lang.com/docs |
| Account Constraints | https://www.anchor-lang.com/docs/account-constraints |
| Anchor Rust API | https://docs.rs/anchor-lang/latest/anchor_lang |

### Light Protocol (ZK Compression)
| Kaynak | URL |
|---|---|
| Light Protocol Docs | https://docs.lightprotocol.com |
| ZK Compression Overview | https://www.zkcompression.com |
| Photon RPC (Helius) | https://docs.helius.dev/photon-api |

### x402 / MPP
| Kaynak | URL |
|---|---|
| x402 Spec | https://x402.org |
| @solana/mpp npm | https://www.npmjs.com/package/@solana/mpp |

### Kriptografi (@noble)
| Kütüphane | URL |
|---|---|
| noble-ciphers (AES-GCM) | https://github.com/paulmillr/noble-ciphers |
| noble-curves (x25519) | https://github.com/paulmillr/noble-curves |
| noble-hashes (SHA-256/HKDF) | https://github.com/paulmillr/noble-hashes |

### SPL Token / @solana/kit
| Kaynak | URL |
|---|---|
| SPL Token | https://spl.solana.com/token |
| @solana/kit Repo | https://github.com/anza-xyz/kit |

---

## 17. GitHub

Repo: `https://github.com/AltndrekBurk/predatapool`  
Branch: `main`  
Son commit: `2e108b44` — at-rest encryption + ECIES key delivery  
Kural dosyası: `AGENTS.md` (Codex her session'da otomatik okur)
