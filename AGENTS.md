# AGENTS.md — PreDataPool

> Codex ve tüm kodlama ajanları için değişmez kurallar ve proje rehberi.
> Bu dosya her session'da otomatik okunur. Kısaltma: yok. Kural: bağlayıcı.

---

## 1. Proje Özeti

**PreDataPool** — birden fazla AI ajanının aynı API verisini tek seferinde
çekip maliyeti (hem veri hem Solana işlem ücreti) paylaştığı bir protokol.

- Solana devnet / Anchor 0.32.1
- Off-chain: Node.js matching server + SQLite cache + AES-GCM at-rest encryption
- On-chain: DataPool PDA, CompressedBuyerSlot (Light Protocol), x402 ödeme
- Frontend: Next.js 16 + React 19 + Tailwind v4

**Detaylı bağlam için:** `CODEX_GUIDE.md` — tüm mimari, endpoint'ler,
şifreleme protokolü, tamamlanan vs eksik özellikler.

---

## 2. Dizin Haritası

```
predatapool/
├── AGENTS.md              ← bu dosya — değişmez kurallar
├── CODEX_GUIDE.md         ← tam proje rehberi
├── anchor/                ← Rust/Anchor on-chain programı
│   └── programs/datapool/src/
│       ├── lib.rs         ← instruction dispatch
│       ├── state.rs       ← DataPool, BuyerSlot, CompressedBuyerSlot
│       └── instructions/  ← her instruction ayrı dosya
├── server/src/            ← off-chain keeper + HTTP API
│   ├── index.ts           ← Express HTTP server
│   ├── crypto.ts          ← AES-GCM + ECIES şifreleme
│   ├── store.ts           ← SQLite PoolStore
│   ├── keeper.ts          ← Anchor program çağrıları
│   ├── matcher.ts         ← pool oluşturma / birleştirme
│   └── providers.ts       ← provider kayıt defteri
└── app/                   ← Next.js frontend
    ├── lib/crypto.ts      ← buyer-side şifre çözme
    ├── lib/server-api.ts  ← HTTP client SDK
    └── components/        ← UI bileşenleri
```

---

## 3. Build ve Test Komutları

### TypeScript (frontend + server)
```bash
npx tsc --noEmit                          # type check — her değişiklik sonrası çalıştır
npm run dev                               # Next.js dev server (port 3000)
```

### Server
```bash
cd server && npm run dev                  # matching server (port 3001)
cd server && npm run mock-upstream        # x402/MPP test upstream (port 4001)
cd server && npx tsx --test src/crypto.test.ts   # crypto testleri (10 test)
cd server && npx tsx --test src/store.test.ts    # store testleri (6 test)
cd server && npx tsx src/smoke-x402.ts    # x402 entegrasyon (mock-upstream gerekli)
```

### Anchor (Rust)
```bash
# PATH ayarı — Solana CLI ve Cargo ikisi de gerekli
export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$PATH"

cd anchor && anchor build                 # Rust derle + IDL üret
cd anchor && anchor test --skip-deploy    # unit testler (LiteSVM)
cd anchor && anchor deploy                # devnet'e deploy
```

### Codama (TypeScript client üretimi)
```bash
npm run codama:js    # anchor build sonrası çalıştır
```

---

## 4. Değişmez Kurallar

### 4.1 Güvenlik

- **ASLA** plaintext payload'ı SQLite'a yazma — her zaman AES-256-GCM şifreli kaydet
- **ASLA** `K_pool`'u HTTP response'ta düz metin döndürme — sadece ECIES wrap
- **ASLA** `key_commitment` ve `data_hash` doğrulamasını atlatma
- `seenKeyReqNonces` — nonce replay check her `/pool/:hash/key` isteğinde zorunlu
- SQL parametrelerini her zaman parametreli sorgularla geç (better-sqlite3 `?` bind)
- XSS: kullanıcıdan gelen veriyi DOM'a `innerHTML` ile ekleme
- Keeper keypair yolunu asla hardcode etme — `KEEPER_KEYPAIR_PATH` env kullan

### 4.2 Anchor / Rust

- `DataPool::STORAGE_URI_MAX_LEN = 128` — bu sabit on-chain ve server'da eşit olmalı
- `SCHEMA_VERSION` (`store.ts`) — her `PayloadRecord` şema değişikliğinde artır
- `state.rs`'e yeni alan eklendiğinde `initialize_pool`'da o alanı sıfırla
- `tests.rs`'deki `DataPool` struct literal'larına yeni alan eklendiğinde güncelle
- Anchor build her zaman `anchor/` dizininden çalıştırılır, repo kökünden değil
- IDL değişikliği → `npm run codama:js` zorunlu

### 4.3 Kod Kalitesi

- Yorum yaz: **sadece** neden (why) açıksa — ne (what) yazan yorum yazma
- `any` kullanma — tip güvenli kod yaz; zorunluysa `as never` (mevcut pattern)
- Hata mesajlarını kullanıcıya dönük yap — `String(err)` değil `(err as Error).message`
- Test ekle: her yeni kripto fonksiyonu için en az round-trip + tamper testi
- `npx tsc --noEmit` sıfır hata verene kadar commit etme

### 4.4 Mimari

- HTTP endpoint eklersen `CODEX_GUIDE.md` Bölüm 5'i güncelle
- Rust instruction eklenirse `CODEX_GUIDE.md` Bölüm 4'ü güncelle
- `providers.ts` statik kayıt defteri — production'da on-chain hesap olmalı (TODO)
- `seenKeyReqNonces` in-memory — server restart'ta sıfırlanır; bunu bilerek kullan

### 4.5 Git

- Commit mesajı formatı: `type(scope): açıklama`
  - `feat`, `fix`, `refactor`, `test`, `docs`, `chore`
  - Örnek: `feat(anchor): register_dataset key_commitment argümanı`
- Her Anchor değişikliği → rebuild → IDL commit'e dahil et
- `anchor/target/` `.gitignore`'da değilse binary'leri commit etme

---

## 5. "Tamamlandı" Kriterleri

Bir görev tamamlandı sayılır, ancak ve ancak:

1. `npx tsc --noEmit` — sıfır hata
2. İlgili testler çalışır ve geçer (`crypto.test.ts`, `store.test.ts`, vs.)
3. Anchor değişikliği varsa → `anchor build` başarılı, IDL güncellendi
4. Yeni endpoint/instruction → `CODEX_GUIDE.md` güncellendi
5. Güvenlik kuralları ihlali yok (yukarıdaki 4.1 listesi)

---

## 6. Kritik Eksikler (Sıradaki Görevler)

Şu an en yüksek öncelikli eksikler (`CODEX_GUIDE.md` Bölüm 11'de detay):

1. **DataEnvelope + provider imzası** — keeper dürüst varsayımı kırılabilmeli
2. **Agent SDK paketi** — `@predatapool/sdk` npm paketi
3. **WeatherXM gerçek entegrasyon** — API key ile gerçek test
4. **Privacy / opt-out** — hassas veri havuz dışı kalabilmeli

---

## 7. Solana Harici Kaynaklar

Kod yazarken aşağıdaki dokümanlara başvur. Şüphe durumunda önce resmi
kaynağı oku, sonra implement et.

### 7.1 Temel Solana

| Kaynak | URL | Kullanım |
|---|---|---|
| Solana Docs (Ana) | https://solana.com/docs | Genel mimari, hesap modeli |
| Solana Programlama Modeli | https://solana.com/docs/core/accounts | Account, PDA, rent |
| Program Deploy | https://solana.com/docs/programs/deploying | Devnet deploy adımları |
| Transaction Anatomy | https://solana.com/docs/core/transactions | İx yapısı, compute budget |
| Solana Cookbook | https://solanacookbook.com | Pratik kod örnekleri |

### 7.2 Solana Improvement Documents (SIMD)

Protokol seviyesi değişiklikler ve öneriler:

```
Repo: https://github.com/solana-foundation/solana-improvement-documents
Dizin: proposals/
Format: SIMD-NNNN.md
```

**Bu projede alakalı SIMD'ler:**

| SIMD | Konu | Neden Önemli |
|---|---|---|
| SIMD-0083 | Ed25519 native program | `settle_receipt` ix[0]'daki Ed25519 verify |
| SIMD-0033 | Timely vote credits | AoI (veri tazeliği) ile ilgili zamanlama |
| SIMD-0096 | Token-2022 extensions | USDC ödeme katmanı gelişimi |
| SIMD-0045 | On-chain randomness | Gelecekte verifiable delay gerekirse |

SIMD okuma kılavuzu:
```bash
# Spesifik bir SIMD'i incele
curl -s https://raw.githubusercontent.com/solana-foundation/solana-improvement-documents/main/proposals/SIMD-0083.md
```

### 7.3 Anchor Framework

| Kaynak | URL |
|---|---|
| Anchor Docs (Ana) | https://www.anchor-lang.com/docs |
| Anchor Account Constraints | https://www.anchor-lang.com/docs/account-constraints |
| Anchor Error Codes | https://www.anchor-lang.com/docs/errors |
| Anchor Rust API | https://docs.rs/anchor-lang/latest/anchor_lang |
| Anchor Sealevel Tests | https://www.anchor-lang.com/docs/testing |

**Bu projede kullanılan Anchor özelliğleri:**
- `#[account]` + `#[derive(InitSpace)]` — DataPool, BuyerSlot
- `#[max_len(128)]` — `storage_uri` alanı
- `constraint = ...` — keeper, fetched_at doğrulamaları
- `seeds = [...]` + `bump` — PDA derivation

### 7.4 Light Protocol (Compressed Accounts)

| Kaynak | URL |
|---|---|
| Light Protocol Docs | https://docs.lightprotocol.com |
| Light SDK (Rust) | https://docs.rs/light-sdk/latest/light_sdk |
| Photon RPC API | https://docs.helius.dev/photon-api (Helius Photon) |
| ZK Compression Overview | https://www.zkcompression.com |

**Bu projede nasıl kullanılıyor:**
- `CompressedBuyerSlot` → Light Protocol state Merkle tree yaprağı
- `settle_receipt` → `prepareSettleReceiptCpi` (server/src/light.ts) ile CPI
- Photon RPC → validity proof + address tree bilgisi (off-chain)
- Maliyet avantajı: ~0.002 SOL/slot → ~0 SOL (sadece leaf hash)

### 7.5 x402 / MPP Ödeme Protokolü

| Kaynak | URL |
|---|---|
| x402 Spec | https://x402.org |
| @solana/mpp | https://www.npmjs.com/package/@solana/mpp |
| HTTP 402 RFC | https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/402 |

**Bu projede nasıl kullanılıyor:**
- `server/src/fetcher.ts` → `solana.charge({ signer, rpcUrl })` — keeper upstream'e öder
- `server/src/mock-upstream.ts` → 402 döndüren test server
- `server/src/smoke-x402.ts` → entegrasyon smoke testi

### 7.6 Kriptografi Kütüphaneleri

| Kütüphane | Kaynak | Bu Projede |
|---|---|---|
| @noble/ciphers | https://paulmillr.com/noble | AES-256-GCM şifreleme |
| @noble/curves | https://paulmillr.com/noble | x25519 ECIES, ed25519 |
| @noble/hashes | https://paulmillr.com/noble | SHA-256, HKDF |
| Noble genel güvenlik | https://github.com/paulmillr/noble-ciphers#security | Audit durumu |

**Kritik:** Noble kütüphaneleri audit edilmiştir; başka bir kriptografi
kütüphanesi ekleme — önce güvenlik denetimine bak.

### 7.7 SPL Token (USDC)

| Kaynak | URL |
|---|---|
| SPL Token Docs | https://spl.solana.com/token |
| Associated Token Account | https://spl.solana.com/associated-token-account |
| Token Program (Rust) | https://docs.rs/spl-token/latest/spl_token |

### 7.8 Solana Kit (@solana/kit)

| Kaynak | URL |
|---|---|
| @solana/kit Repo | https://github.com/anza-xyz/kit |
| TransactionSigner | https://github.com/anza-xyz/kit/blob/main/packages/signers |
| RPC Types | https://github.com/anza-xyz/kit/blob/main/packages/rpc-types |

---

## 8. Yaygın Hatalar (Geçmişten)

| Hata | Doğru Yol |
|---|---|
| `pre_fetch_collected` hesaplamak için `base_price × buyer_count` kullanmak | On-chain alanı oku — `settle_receipt` yazıyor, `claim_rebate` okuyor |
| `anchor build` repo kökünden çalıştırmak | `cd anchor && anchor build` |
| `PayloadRecord.body` alanına yazmak | Schema v2: `ciphertext`, `iv`, `poolKey`, `keyCommitment` |
| `fetchAndVerify` ile şifreli payload doğrulamak | `fetchDecryptAndVerify` kullan (app/lib/crypto.ts) |
| Anchor state'e alan ekleyip `initialize_pool`'da sıfırlamamak | Her yeni alan `initialize_pool`'da başlangıç değeri almalı |
| `DataPool` struct literal'ı `tests.rs`'de güncellememeye | Rust derleyicisi `missing field` hatası verir |

---

## 9. Planlama Rehberi

Karmaşık görev başlamadan önce:

1. `CODEX_GUIDE.md` Bölüm 11'deki eksik listesini kontrol et
2. Etkilenen dosyaları listele (Anchor + server + frontend üçlüsü sık etkilenir)
3. Şema değişikliği varsa `SCHEMA_VERSION`'ı artır
4. Önce unit test yaz, sonra implement et (crypto.ts pattern'ı izle)
5. `npx tsc --noEmit` ile bitir

---

*Bu dosyayı güncellemek için: yeni bir kural keşfedildiğinde veya iki kez aynı hata yapıldığında ilgili bölüme ekle.*
