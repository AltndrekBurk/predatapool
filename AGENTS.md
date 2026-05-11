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

## 7. Harici Dokümantasyon

**Tüm indirilen dokümanlar:** `docs/external/` klasöründe yerel kopya olarak mevcut.
Tam liste ve açıklamalar için: `docs/external/INDEX.md`

```
docs/external/
├── simd/        9 dosya  — Solana Improvement Documents
├── anchor/      9 dosya  — Anchor kısıtlar, hata kodları, Solana core (PDA, CPI, tx)
├── light-protocol/ 5 dosya — ZK Compression, compressed accounts
├── x402/        9 dosya  — x402 protokol spec, client-server, facilitator, FAQ
└── noble/       3 dosya  — AES-GCM, x25519 ECIES, SHA-256/HKDF README'leri
```

### Hızlı Referans

| İhtiyaç | Yerel Dosya |
|---|---|
| Anchor `constraint =` syntax | `docs/external/anchor/account-constraints.md` |
| PDA türetme | `docs/external/anchor/solana-pda.md` |
| CPI nasıl çalışır | `docs/external/anchor/solana-cpi.md` |
| SPL Token / USDC hesapları | `docs/external/anchor/solana-tokens.md` |
| Transaction yapısı | `docs/external/anchor/solana-transactions.md` |
| Light CPI account limiti | `docs/external/simd/0339-increase-cpi-account-info-limit.md` |
| AoI / timely vote credits | `docs/external/simd/0033-timely-vote-credits.md` |
| x402 keeper-upstream akışı | `docs/external/x402/client-server.md` |
| x402 facilitator rolü | `docs/external/x402/facilitator.md` |
| AES-256-GCM kullanımı | `docs/external/noble/noble-ciphers-README.md` |
| x25519 ECDH + HKDF | `docs/external/noble/noble-curves-README.md` |
| CompressedBuyerSlot | `docs/external/light-protocol/compressed-account-README.md` |

### Kaynak URL'leri (güncel versiyon için)
- Solana Docs: https://solana.com/docs
- SIMD Repo: https://github.com/solana-foundation/solana-improvement-documents
- Anchor Docs: https://www.anchor-lang.com/docs
- Light Protocol: https://docs.lightprotocol.com
- x402: https://x402.org / https://github.com/coinbase/x402
- @noble: https://github.com/paulmillr/noble-ciphers

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
