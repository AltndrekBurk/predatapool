# PreDataPool — Net MVP Rehberi

Son guncelleme: 2026-05-11

Bu dosya projenin kisa karar rehberidir. Ayrintili veya emin olunmayan her teknik konu icin once `docs/external/` altindaki yerel dokumanlara bakilir. Varsayimla ilerlemek yasak.

## 1. Net Hedef

PreDataPool, **DePIN, IoT ve edge compute icin Solana-native bir request coalescing katmanidir** — Cloudflare'in "tek fetch, N caller paylasimi" deseninin M2M ekonomisine uyarlanmis hali. Ayni canonical public request'i hedefleyen birden fazla ajan/makine icin tek upstream fetch + tek provider odemesi yapar, sifrelenmis ve dogrulanabilir reuse sunar, Solana'da tek batch'te settle eder.

"Coalescing" notu: MVP **veri katmaninda** coalesce eder (ayni canonical request + taze AoI window = ayni pool + ayni payload + ayni upstream odemesi). Caller tarafi UX su an polling tabanli; bunu paylasimli in-flight promise'a cevirmek SDK fan-in isidir (bkz. AGENTS.md §5.3).

Ilk MVP yalnizca public ve paylasilabilir veriye odaklanir:

- hava durumu
- public kripto fiyat/OHLC verisi
- public sensor/IoT okumasi
- demo icin mock x402 upstream

MVP disi:

- hassas/private veri
- ultra dusuk gecikmeli trading verisi
- provider marketplace
- tam mainnet ekonomisi
- zorunlu Light Protocol compression

## 2. Problem

Iki bagimsiz ajan ayni API verisini ayri ayri alinca:

- upstream iki kez calisir
- x402 odemesi iki kez tetiklenebilir
- ayni veri icin tekrar dogrulama ve tekrar transfer olur
- provider tarafinda compute/bandwidth gereksiz artar

Asil problem Solana tx ucreti degil; provider veri uretim, rate-limit, compute ve bandwidth maliyetidir.

## 3. MVP Islem Akisi

```
1. Agent request hazirlar.
2. SDK/server canonical request key hesaplar.
3. Pool server freshness window icinde ayni key'i arar.
4. Cache miss:
   - upstream x402/API-key/free fetch yapilir
   - raw bytes SHA-256 ile hashlenir
   - payload AES-GCM ile sifrelenir
   - DataEnvelope v0 metadata uretilir
   - on-chain data_hash/key_commitment kaydedilir
5. Cache hit:
   - envelope/payload expiry kontrol edilir
   - buyer authorization kontrol edilir
   - K_pool sadece yetkili buyer icin wrap edilir
   - buyer decrypt eder ve data_hash/merkle_root dogrular
6. Reuse settlement:
   - buyer receipt/payment kaydi olusur
   - provider/fetcher/protocol gelir modeli metadata veya on-chain config'ten okunur
```

Temel invariant:

```
same canonical request + fresh AoI window = same pool + same payload
```

Future SDK relay rule:

```ts
const response = await fetch(url, options);
pool.relay(buildEnvelope(response)).catch((err) => logger.error("relay failed", { err }));
return response;
```

Agent fetch path'i pool relay yuzunden bloklanmaz.

## 4. Canonical Request

Pool anahtari su alanlardan turetilir:

- provider id
- HTTP method
- host + path
- normalize params
- freshness window

Query sirasi, trailing slash, param sirasina bagli farklar ayni istegi farkli pool yapmamali. Bu konuda mevcut kod degistirilecekse once `server/src/matcher.ts` ve ilgili testler okunur.

## 5. AoI / Freshness Modeli

Age of Information bu projenin fiyat ve cache mantiginin bilimsel temelidir.

```
AoI(t) = t - fetched_at
valid_until = fetched_at + freshness_window
price(t) = base_price * decay(AoI)
```

MVP icin mevcut lineer decay kabul edilebilir. Hedef model ustel decay'dir:

```
freshness_score(t) = exp(-lambda * (t - fetched_at))
```

Yeni kategori uydurulmaz; once asagidaki tablo guncellenir.

Veri tipi referansi:

| Category | tau_decay | lambda | Example |
|---|---:|---:|---|
| `price.realtime` | 2s | 1.5 | CEX/DEX tickers |
| `price.ohlc` | 60s | 0.05 | OHLC feeds |
| `weather.current` | 300s | 0.01 | Open-Meteo, NOAA |
| `weather.forecast` | 3600s | 0.001 | hourly forecast |
| `chain.block` | 400ms | 5.0 | Solana slot data |
| `chain.account` | 5s | 0.5 | on-chain account state |
| `iot.sensor` | 10s | 0.2 | edge sensor reading |
| `reference.static` | 86400s | 0.00001 | metadata/company data |

## 6. DataEnvelope Hedefi

MVP'nin guven hedefi once hash + key commitment'tir. Sonraki guclendirme `DataEnvelope` olmalidir:

```
type DataEnvelope = {
  payload: Uint8Array;
  source_url: string;
  fetched_at: number;
  expires_at: number;
  merkle_root: Uint8Array; // SHA256(payload || source_url || fetched_at || expires_at)
  provider_sig?: Uint8Array;
  keeper_sig: Uint8Array;
};
```

Ilk MVP'de provider imzasi zorunlu degil; keeper imzasi ve on-chain data_hash yeterli demo kaniti olabilir. Provider onboarding baslayinca provider imzasi kritik hale gelir.

Pool node cache hit'i verified saymadan once:

1. hash/root recomputation match
2. required signatures valid
3. `expires_at > Date.now()`
4. data source public/pool-eligible

## 7. Ekonomi

Provider zarara sokulmaz. Mantik:

```
R_provider = pool_fee * provider_ratio
R_fetcher  = pool_fee * fetcher_ratio
R_protocol = pool_fee * protocol_ratio
```

Ratios on-chain config veya versioned protocol metadata'dan okunur. SDK/client icinde is orani hardcode edilmez.

MVP icin hedef "tam ekonomik kanit" degil, su kanittir:

- ayni request ikinci kez upstream'e gitmiyor
- cache hit kullanan buyer dogrulanmis payload aliyor
- provider/share parametreleri on-chain veya metadata'da gorunuyor

## 8. Privacy / Opt-Out

Varsayilan MVP yalnizca public veri icindir.

Kurallar:

- User-specific auth header, cookie, bearer token, wallet-specific endpoint cache'e alinmaz.
- Params icinde `user`, `account`, `wallet`, `address`, `private`, `token`, `secret` gibi alanlar varsa public pool'a sokmadan once acik karar gerekir.
- Hassas veri icin opt-out veya private pool tasarimi yapilmadan production iddiasi yoktur.

## 9. Zorunlu Yerel Referanslar

Her teknik kararda once `docs/external/` kontrol edilir:

| Konu | Dosya |
|---|---|
| x402 client/server akisi | `docs/external/x402/client-server.md` |
| x402 facilitator ve duplicate settlement | `docs/external/x402/facilitator.md` |
| HTTP 402 semantigi | `docs/external/x402/http-402.md` |
| PDA ve canonical bump | `docs/external/anchor/solana-pda.md` |
| Anchor constraints | `docs/external/anchor/account-constraints.md` |
| CPI | `docs/external/anchor/solana-cpi.md` |
| SPL token/USDC | `docs/external/anchor/solana-tokens.md` |
| AES-GCM | `docs/external/noble/noble-ciphers-README.md` |
| ed25519/x25519/HKDF | `docs/external/noble/noble-curves-README.md` ve `docs/external/noble/noble-hashes-README.md` |
| Light Protocol | `docs/external/light-protocol/*` |

Kural: Dokumanla celisen kod yazilmaz. Dokuman yetersizse "bilmiyoruz" denir ve dosya/yorum/TODO ile sinir net yazilir.

## 10. Kodlama Kisitlari

- Varsayim yapma; once ilgili docs ve mevcut kodu oku.
- Yeni endpoint eklenirse bu rehber ve client tipi guncellenir.
- Yeni schema alani eklenirse `SCHEMA_VERSION` artirilir.
- Plaintext payload SQLite'a yazilmaz.
- `K_pool` HTTP response'ta plaintext donmez.
- Key delivery sadece yetkili buyer icin yapilir; off-chain membership tek basina yeterli sayilmaz, hedef on-chain/receipt kanitidir.
- Parametreli SQL disinda sorgu yazilmaz.
- `innerHTML` kullanilmaz.
- `any` kullanma; zorunluysa nedenini yaz.
- Kripto kodunda round-trip ve tamper testi olmadan degisiklik tamam sayilmaz.
- Anchor state alanlari eklenirse initialize ve test literal'lari ayni committe guncellenir.
- Anchor build sadece `anchor/` icinden dusunulur.
- IDL degisirse Codama client yenilenir.

## 11. Hemen Sonraki Is Sirasi

1. README ve package metadata'yi starter projeden PreDataPool'a cevir.
2. Root dependency/lock durumunu netlestir.
3. MVP flow'u tek kaynaga indir: off-chain pool vs on-chain receipt ayrimini temizle.
4. Key delivery icin gercek yetki modelini netlestir: buyer cache'e sadece odeme/receipt sonrasi erissin.
5. DataEnvelope v0 ekle: keeper_sig + merkle_root + source_url + expires_at.
6. Public-data opt-out kurallarini matcher/fetcher seviyesinde uygula.
7. Revenue ratios icin on-chain config veya versioned metadata kaynagini netlestir.
8. SDK'yi ancak bu akistan sonra ayir.

## 12. Basari Kriteri

Demo basarili sayilirsa:

- iki ayni request tek upstream fetch yapar
- ikinci buyer cache hit alir
- payload encrypted at-rest kalir
- buyer decrypt sonrasi data_hash dogrular
- x402/mock payment flow belgelenir
- rehberdeki docs referanslariyla celisen tasarim kalmaz
