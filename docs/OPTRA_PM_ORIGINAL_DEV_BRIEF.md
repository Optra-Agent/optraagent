# Optra Agent: Developer Product Brief

| Field | Value |
|---|---|
| Brief ID (usulan) | **ORC-20261111-01** |
| Status | Working Brief (menunggu approve Caesar) |
| Owner | Caesar |
| Tanggal | 2026-11-11 (Asia/Makassar, WITA) |
| Authors | FORGE (ide, spesifikasi, branding & copy). **FORGE tidak membangun kode.** |
| Audience | Dev Caesar (FE, BE, smart contract), desainer, Caesar |
| Chain | Robinhood Chain mainnet **4663** (testnet/staging mengikuti docs RH) |
| Nama produk | **Optra Agent** (short: **Optra**) |
| Sumber kebenaran | `/workspace/briefs/optra-agent-summary.md` (disetujui Caesar sebagai dasar brief) |
| Pola acuan | Zolva (`/workspace/research/zolva-agent-deep-dive.md`): mekanik disamakan, pembeda = **options** + **dual mode** |

**Disclaimer:** Bukan saran investasi. Bukan saran beli/jual saham, token, atau options. Semua angka pihak ketiga di brief ini adalah klaim sumber dan belum diaudit onchain.

### Cara membaca brief ini
- **[USULAN]**: angka atau pilihan dari FORGE. Boleh diubah dev/Caesar, tapi harus diputuskan sebelum ship.
- **[VERIFIKASI DEV]**: fakta pihak ketiga yang belum terbukti. Wajib dicek dev sebelum dibangun di atasnya.
- **[PLACEHOLDER]**: angka sementara supaya UI/API bisa dirancang. Jangan dipakai di copy publik.
- **[ASUMSI]**: anggapan FORGE yang belum ada buktinya.
- Copy produk (landing/app) ditulis dalam **bahasa Inggris**. Penjelasan untuk dev ditulis dalam Bahasa Indonesia.

---

## 0. Ringkasan untuk Caesar (1 menit)

1. **Optra Agent = desk options yang dijalankan agent AI** di Robinhood Chain. Agent membeli atau menulis call/put dengan aturan bernama **hook**. Ada 36 hook dalam 6 tahap.
2. **Brand-nya agent-first.** Hero, nav, dan urutan landing menonjolkan House Agents, Custom Agents, Forge, The Listing, Optra Tape, dan hooks di Uniswap v4. Manual trading tetap ada sebagai mode kedua ("Two modes. One book.").
3. **Mekaniknya sama dengan Zolva:** aturan → backtest 30 hari per jam → paper → (live dengan cap) → agent memutuskan tiap jam dan menulis alasannya. Rule engine yang memutuskan. AI hanya menerjemahkan prompt jadi hook dan boleh memveto pembukaan posisi. Ada Public API, MCP, x402 (USDG), dan halaman Verify.
4. **Venue v1 = Jalur A:** agent mengeksekusi di venue yang sudah ada (CallPut dan/atau Zeno) setelah dev memverifikasi kontraknya. **Jalur B** (vault options sendiri berbasis v4 hook) masuk fase 2.
5. **Klaim Uniswap v4 dibuat jujur:** v1 hanya memasang hook Breaker + Sessions (Haltr, Venux, Corpax, Sessia) sebagai kontrak v4 `beforeSwap` di pool spot milik Optra. 32 hook lainnya berjalan di rule engine offchain. Copy "built on Uniswap v4 hooks" baru boleh dipakai kalau kontrak itu benar-benar live. Kalau belum, pakai "inspired by Uniswap v4 hooks".

---

## 1. Product one-liner & elevator pitch

### 1.1 One-liner (internal)
**Optra Agent adalah desk options berbasis agent AI untuk saham di Robinhood Chain. House Agent buatan Optra atau Custom Agent rakitan user menjalankan call & put 24/7 memakai 36 hook (sebagian dibangun sebagai Uniswap v4 hooks). Setiap keputusan dibacktest, dijalankan di paper dulu, dan dijelaskan di Optra Tape. User tetap bisa trading manual di buku yang sama.**

### 1.2 Elevator pitch
Di Robinhood Chain sudah ada platform agent (Zolva, Oreno, Heurix), tapi semuanya main di spot atau perps. Venue options (CallPut, Zeno) juga sudah ada, tapi semuanya manual. **Belum ada yang menyatukan agent dengan options.** Options adalah instrumen yang paling butuh disiplin: take profit, roll, cut loss, dan keluar sebelum earnings. Itu pekerjaan yang cocok untuk agent. Optra memberi agent options yang bisa dirakit seperti Lego (hook), dibuktikan dengan backtest dan paper, dan transparan per jam. Platform ini juga terbuka untuk agent lain lewat API, MCP, dan x402.

---

## 2. Problem

1. **Options rumit untuk awam**: strike, expiry, Greeks.
2. **Options butuh disiplin.** Kebanyakan orang rugi karena emosi: telat take profit, lupa roll, memegang posisi saat earnings.
3. **Ada celah pasar di RH Chain.** Platform agent tidak punya options, dan venue options tidak punya agent. [Klaim lanskap per riset 11 Nov; [VERIFIKASI DEV] ulang sebelum launch.]
4. **Banyak "AI trading" yang overclaim.** Contohnya Zolva: 25 dari 26 agent publik buatan tim sendiri, dan tes internal x402 diklaim sebagai traksi. Optra harus menang dengan cara yang **jujur dan bisa dicek**.

---

## 3. Goals & Non-goals

### 3.1 Goals
- **G1. Agent-first.** Produk, nav, dan landing berpusat pada agent: House, Custom, Forge, The Listing, Tape.
- **G2. 36 hook dalam 6 tahap** (Gate, Strike, Size, Pulse, Expiry, Breaker) yang bisa dirakit, divalidasi, dan dibaca manusia.
- **G3. Mekanik Zolva:** rule → backtest 30 hari per jam → paper → live (cap) → keputusan per jam dengan alasan tertulis.
- **G4. AI sebagai penerjemah + veto**, bukan pengambil keputusan. Keputusan selalu deterministik dari rule engine.
- **G5. Dual mode:** Agent Mode (utama) + Manual Mode (pendukung) dalam **satu Optra Book** dengan label pengendali.
- **G6. Developer layer:** Public API gratis, MCP server, x402 paid API dibayar USDG di RH Chain.
- **G7. Trust:** halaman Optra Verify sejak hari pertama, label Live/Paper/Planned di semua klaim, dan tes internal diberi label tes.
- **G8. Uniswap v4 hooks yang nyata** untuk minimal Breaker + Sessions (lihat §8). Klaim copy mengikuti status deploy.
- **G9. Real money dibuka bertahap dengan gate & cap** setelah venue terbukti.

### 3.2 Non-goals (v1)
- Bukan venue/AMM options sendiri di v1. Itu Jalur B, fase 2.
- Tidak ada **naked short option** (jual call/put tanpa jaminan). Penulisan opsi hanya boleh covered (pakai token yang dipegang) atau cash-secured (pakai USDG).
- Tidak ada pooled fund atau vault yang mengelola dana orang lain di v1. "Follow" di The Listing = menyalin resep ke agent milik follower sendiri.
- Bukan perps dan bukan spot trading terminal. Spot hanya dipakai sebagai kaki hedge/covered.
- Tidak menjanjikan profit, tidak memprediksi harga.
- Tidak memakai nama/logo NYSE, dan tidak mengklaim partnership dengan NYSE, Robinhood, Uniswap, CallPut, atau Zeno.
- Token project bukan bagian brief ini. Kalau nanti ada, harus dipisah total dari performa agent (pelajaran dari Zolva).

---

## 4. Users & JTBD

| Persona | JTBD | Fitur utama |
|---|---|---|
| P1 Holder stock token | "Aku pegang NVDA token, mau dapat penghasilan mingguan tanpa paham options." | House Agent Covered Call, Paper Floor, Tape |
| P2 Trader sibuk | "Aku punya ide strategi, mau dijalankan disiplin 24 jam tanpa emosi." | Forge, Custom Agents, Lab, Breaker |
| P3 Creator strategi | "Aku mau track record publik yang terkunci dan dapat fee kalau diikuti." | The Listing, Verify |
| P4 Pemula | "Aku mau belajar options tanpa risiko." | Paper Floor, template House Agents, Risk Desk bahasa awam |
| P5 Developer / AI agent lain | "Aku mau data hook, backtest, dan sinyal lewat API/MCP, bayar per call." | Public API, MCP, x402 |
| P6 Manual trader (sekunder) | "Aku mau beli call/put sendiri, tapi pengelolaannya otomatis." | Optra Floor + hook Pulse/Expiry |

---

## 5. Venue & jalur eksekusi

### 5.1 Keputusan default
- **v1 = Jalur A:** Optra **tidak menjadi venue**. Agent dan manual order dieksekusi di venue options yang sudah ada di RH Chain lewat **Execution Adapter**.
  - **Adapter 1: CallPut** (opsi **sintetis** atas harga saham/ETF, request-based/asinkron, kolateral USDG; klaim 20 underlying di RH).
  - **Adapter 2: Zeno Markets** (`ZenoOptionsEngine` `0xA58fc1027E05A9eE7c2b60d9A22EeD4aed3860b5`, vault + oracle). **Belum terbukti fill end-to-end.**
  - Dev boleh mulai dengan satu adapter saja, yaitu yang lolos verifikasi duluan.
- **Fase 2 = Jalur B:** vault/market options milik Optra yang dibangun sebagai Uniswap v4 hooks, dengan pola STORMM/SOLO (Clutch) dan Panoptic sebagai referensi. Jalur ini butuh pricing, market maker/LP, risk engine, dan audit. Ada di §21 (P5) sebagai riset, bukan scope v1.

### 5.2 Checklist verifikasi venue (WAJIB sebelum adapter dibangun) [VERIFIKASI DEV]

| # | Item | CallPut | Zeno | Kenapa penting |
|---|---|---|---|---|
| V1 | Alamat kontrak mainnet 4663 + ABI + source verified | ☐ | ☐ (alamat OptionsEngine dari post official) | Adapter & halaman Verify |
| V2 | Daftar underlying di RH + mapping ke stock token RH (alamat ERC-20) | ☐ | ☐ | Katalog market Optra |
| V3 | **Sisi yang didukung: buy-to-open saja, atau juga write/sell-to-open (covered/cash-secured)?** | ☐ | ☐ | **Menentukan House Agent mana yang bisa live** (§13.3) |
| V4 | Grid strike & expiry (harian/mingguan/bulanan?), ukuran kontrak minimum | ☐ | ☐ | Hook Strike (Percy, Deltra, Tenora) |
| V5 | Cara quote premi (RFQ/request asinkron? berapa lama sampai fill? fill rate?) | ☐ | ☐ | Loop per jam, state order `pending` |
| V6 | Close sebelum expiry didukung? Biayanya? | ☐ | ☐ | Pulse (Profira, Stopra, Rolla) |
| V7 | Settlement: sumber harga, waktu, cash-settled USDG atau in-kind | ☐ | ☐ | Settla, Lastra, PnL |
| V8 | Fee (open/close/settle) | ☐ | ☐ | Lab, Book, fee Optra |
| V9 | Akses programatik: ToS mengizinkan bot/agent? Rate limit? API offchain atau langsung kontrak? | ☐ | ☐ | Legal + reliability |
| V10 | **Data historis premi/IV** tersedia? | ☐ | ☐ | Kualitas backtest (§13.6) |
| V11 | Apakah posisi dimiliki wallet user (bukan pooled)? Bisa dipanggil dari smart account/session key? | ☐ | ☐ | Custody (§9) |
| V12 | Uji end-to-end di mainnet dengan nominal kecil (wallet dev): open → close → settle | ☐ | ☐ | Gate real money G1 |

**Aturan:** sebuah venue baru boleh muncul sebagai pilihan "live" setelah V1–V12 lengkap dan Caesar menandatangani hasilnya. Sebelum itu, venue hanya dipakai sebagai **sumber quote untuk paper**, kalau quote-nya bisa dibaca tanpa transaksi.

### 5.3 Bahasa underlying (wajib konsisten di UI & copy)
Ada tiga hal berbeda yang tidak boleh dicampur:
1. **Stock token RH**: token ERC-20 yang memberi eksposur ekonomi, bukan hak saham.
2. **Opsi sintetis atas harga saham**: misalnya CallPut. Opsinya merujuk ke harga saham, bukan ke token, dan tidak memberi dividen/hak suara/delivery.
3. **Saham asli ber-hak**: bukan produk Optra.

Copy wajib (tooltip/footnote): `Options on Optra are synthetic and settle in USDG against the stock price. They are not shares and not stock tokens.` Kalau venue settle in-kind dalam stock token, teks ini disesuaikan setelah V7.

---

## 6. Arsitektur

### 6.1 Diagram

```
                ┌──────────────────────── Frontend (Next.js) ────────────────────────┐
                │ Landing · Agents · Forge · Listing · Tape · Lab · Floor · Book ·    │
                │ Risk Desk · Developers · Verify                                    │
                └───────────────┬────────────────────────────────────────────────────┘
                                │ REST/WS (session auth)        Public API / MCP / x402
                ┌───────────────▼───────────────┐      ┌───────────────────────────────┐
                │ App API (BE)                  │◄────►│ Developer Gateway             │
                │ auth, agents, orders, book    │      │ /api/public/v1, /mcp,         │
                └──┬──────────┬──────────┬──────┘      │ /api/x402/v1 + facilitator    │
                   │          │          │             └───────────────────────────────┘
        ┌──────────▼──┐ ┌─────▼──────┐ ┌─▼────────────────┐
        │ Rule Engine │ │ AI Layer   │ │ Backtest (Lab)   │  ← parity: engine sama
        │ runTick()   │ │ compose,   │ │ 30d hourly       │
        │ 36 hooks    │ │ veto       │ │                  │
        └──────┬──────┘ └────────────┘ └──────────────────┘
               │ intents (open/close/roll/hedge)
        ┌──────▼─────────────────────┐        ┌──────────────────────────────┐
        │ Execution Layer            │        │ Onchain (RH 4663)            │
        │ - PaperAdapter             │        │ - OptraGuardHook (v4)        │
        │ - CallPutAdapter           │──────► │   Haltr/Venux/Corpax/Sessia  │
        │ - ZenoAdapter              │        │ - GuardRegistry              │
        │ - SpotAdapter (v4 pool)    │        │ - Optra v4 pools (spot legs) │
        └──────┬─────────────────────┘        │ - Venue contracts (3rd party)│
               │                              └──────────────────────────────┘
        ┌──────▼────────────────────────────────────────────┐
        │ Data Layer: prices (onchain pools + oracle),      │
        │ currentMultiplier (ERC-8056), venue quotes/IV,    │
        │ earnings & corporate-action calendar, sessions    │
        └───────────────────────────────────────────────────┘
        Storage: Postgres (Supabase-like) · Cron: hourly tick + 5-min breaker monitor
```

### 6.2 Komponen

| Komponen | Tanggung jawab | Usulan stack | Catatan |
|---|---|---|---|
| Frontend | Landing + app | Next.js + TS, viem/wagmi, Tailwind | Pola Zolva. Bahasa UI English |
| App API | Auth, CRUD agent, order manual, book, notifikasi | Next.js route handlers / Workers | Idempotent |
| Rule Engine | Mengevaluasi hook per tick → intent | TS modul murni (tanpa I/O) | **Satu engine untuk live, paper, dan backtest** (parity test wajib, seperti Zolva) |
| AI Layer | (a) Forge: prompt → recipe JSON, (b) veto opsional | Provider LLM via router (pola OpenRouter), JSON schema strict, temperature rendah | AI tidak pernah membuat order |
| Backtest (Lab) | Replay 30 hari per jam | Worker terpisah, panggil Rule Engine | Premi modeled vs recorded (§13.6) |
| Execution Layer | Intent → order venue/paper/spot | Adapter per venue | State machine order §10.6 |
| Onchain | Guard hook v4 + registry + pool spot Optra | Solidity + Foundry | §8 |
| Data Layer | Harga, multiplier, quote venue, kalender | Indexer RPC RH + cron | §6.4 |
| Storage | Semua entitas §10 | Postgres | Log Tape append-only |
| Cron | Tick per jam (mnt :05) + backup (mnt :07), breaker monitor 5 menit, event tick saat sesi buka | Cloudflare cron + pg_cron (pola Zolva) | Idempotent per `tick_id` |
| Developer Gateway | Public API, MCP, x402 + facilitator | Route terpisah, rate limit | §15 |

### 6.3 Auth & wallet
- Login lewat **email / Google / wallet** dengan provider embedded wallet sejenis Privy (pola Zolva). Login gratis tanpa gas.
- Paper: cukup akun.
- Live: syaratnya tergantung model custody yang dipilih (§9). Default usulan: **smart account dengan session key**. Untuk pola Zolva, embedded wallet + signer policy.
- Semua wallet yang dimiliki atau dioperasikan Optra (fee recipient, x402 payTo, relayer, deployer, dev) **wajib** tercantum di Verify. Zolva lupa mencantumkan dev wallet; Optra tidak boleh mengulang.

### 6.4 Data feeds

| Data | Sumber [VERIFIKASI DEV] | Frekuensi | Pembersihan |
|---|---|---|---|
| Harga stock token | Pool USDG onchain (v3 `slot0` / v4 `extsload` PoolManager; pola Zolva, PoolManager `0x8366…0951` per catatan Zolva, alamat lengkap wajib dicek) + feed oracle resmi per docs RH bila ada | per jam (live: per 5 menit untuk breaker) | Outlier >15% diabaikan kecuali bertahan 3 jam. Cross-check oracle (tolak bila deviasi >2%) [USULAN, pola Zolva] |
| Allowlist token | Alamat per token, dicek ke daftar aset resmi Robinhood (pola Zolva) | harian | Cegah token tiruan |
| `currentMultiplier` (ERC-8056) | `eth_call` ke kontrak stock token | per jam | §6.5 |
| Quote & IV options | Adapter venue (quote premi per strike/expiry) | per jam + saat dibutuhkan | IV dihitung Optra dari premi (inversi Black-Scholes) bila venue tidak memberi IV. Simpan semua quote, karena ini jadi data backtest masa depan |
| Earnings calendar | **OPEN**: sumber eksternal (API kalender) | harian | [ASUMSI] belum ada sumber onchain |
| Corporate actions | Perubahan `currentMultiplier` + kalender eksternal | per jam | Feed onchain resmi belum ada (Zolva sendiri meminta ke Robinhood) |
| Sesi pasar US | Jadwal NYSE/Nasdaq regular hours + hari libur (data publik, tanpa memakai brand NYSE) | statis + kalender libur | Konversi ke WITA untuk UI |

### 6.5 Penanganan `currentMultiplier` (ERC-8056)
Menurut catatan Zolva, stock token RH punya `currentMultiplier` (ERC-8056) yang mencerminkan corporate action (nilai teramati sampai ~1,0027). **Semantik persisnya [VERIFIKASI DEV]** dari standar dan docs RH. Aturan usulan:
1. **Effective shares** = `balance × currentMultiplier` (kalau semantiknya memang begitu). Dipakai Coverix (jumlah covered call) dan Risk Desk.
2. **Harga per saham vs harga per token:** opsi venue (CallPut) merujuk harga saham, sedangkan pool onchain memberi harga per token. Konversinya `sharePrice ≈ tokenPrice / currentMultiplier` [ASUMSI, wajib dicek]. Semua hook harga memakai **share price** yang sama dengan venue.
3. **Backtest:** seri harga historis dinormalisasi memakai multiplier per jam supaya split/dividen tidak terbaca sebagai gap palsu.
4. **Event:** perubahan multiplier ≥ 0,0001 memicu event `corporate_action.detected` yang dibaca Corpax (§7) dan ditampilkan di Tape.
5. Output data: `GET /markets/{symbol}` menyertakan `multiplier`, `multiplierUpdatedAt`, `sharePrice`, `tokenPrice`.

---

## 7. Siklus 6 tahap & 36 hook: spesifikasi

### 7.1 Konsep
- **Hook** = satu aturan bernama, dengan parameter, yang dievaluasi rule engine pada tahap tertentu.
- **Recipe** = rangkaian hook milik satu agent (JSON, versioned, di-hash saat launch).
- **Tahap:** `gate → strike → size → (posisi terbuka) → pulse → expiry`, dengan `breaker` aktif sepanjang waktu.
- Setiap evaluasi hook menghasilkan **HookResult** yang ditulis ke Tape:

```json
{
  "hook": "volra",
  "stage": "gate",
  "status": "pass",
  "value": 0.62,
  "threshold": 0.45,
  "unit": "iv30",
  "text": "Volra ✓ NVDA IV 62% ≥ 45%",
  "dataRefs": ["quote:callput:NVDA:2026-11-18:2026-11-11T05:00Z"]
}
```
`status` ∈ `pass | block | select | size | action | noop | error`. Hook berstatus `error` (misalnya data hilang) dianggap **block** untuk entry dan **noop** untuk exit. Data hilang tidak boleh membuka posisi.

### 7.2 Aturan komposisi (validator Forge)
1. **Gate:** 0–5 hook, semuanya AND. Opsi `any` boleh untuk grup (maks 1 grup OR) [USULAN].
2. **Strike:** wajib tepat 1 **expiry selector** (Tenora). Selain itu wajib tepat satu pilihan **struktur**: (a) single-leg dengan tepat 1 selector strike (Deltra **atau** Percy), Premo opsional sebagai filter; atau (b) satu structure hook (Spreadix / Strangl / Collara) yang sudah memuat selector internal.
3. **Size:** wajib Capra (default otomatis). Kelvo, Laddr, dan Coverix opsional. **Coverix wajib** untuk recipe yang menulis call covered.
4. **Pulse:** 0–7. Kalau Profira dan Stopra sama-sama aktif, Stopra dievaluasi dulu.
5. **Expiry:** maksimal 1 aksi utama per posisi. Urutannya Settla → Nextra → Lastra (lihat 7.8).
6. **Breaker:** **Daylo, Drawra, Exposa, dan Venux selalu aktif dengan default** dan tidak bisa dihapus (hanya parameternya yang bisa diubah dalam batas). Haltr default aktif.
7. Menulis opsi (short leg) hanya boleh kalau recipe memuat Coverix (covered) atau mode `cashSecured: true` (USDG dikunci sebesar strike × size).
8. Validator mengembalikan error yang bisa dibaca manusia, misalnya `Strike stage needs an expiry (add Tenora).`

### 7.3 Urutan evaluasi per tick (per agent)
```
1. Breaker check (Haltr, Daylo, Drawra, Exposa, Venux) → bisa set mode: normal | no_new_entries | stopped
2. Untuk setiap posisi terbuka milik agent:
     Pulse hooks (Stopra → Trailo → Profira → Thetix → Rescu → Rolla → Hedgra)
     Expiry hooks (Settla → Nextra → Lastra)
   → intent exit/roll/hedge (exit tidak pernah diblokir oleh Gate, AI veto, atau Sessia; Venux boleh menunda maks N tick)
3. Kalau mode = normal dan slot posisi tersedia:
     Gate (termasuk Corpax, Sessia) → Strike → Size → intent open
4. AI veto (opsional) hanya untuk intent open/roll yang menambah risiko
5. Kirim intent ke Execution Layer → order
6. Tulis Decision ke Tape (selalu, termasuk "hold"/"skip")
```

### 7.4 Tahap 1: Gate (10 hook)

| Hook | Kegunaan | Input data | Parameter (default; range) | Logika | Output (Tape / event) | v1 |
|---|---|---|---|---|---|---|
| **Volra** | Buka hanya saat IV sesuai (tinggi untuk jual premi, rendah untuk beli) | IV ATM tenor terdekat dari quote venue; riwayat IV 30 hari | `metric: ivRank\|ivAbs` (ivRank); `op: above\|below` (above); `threshold` ivRank 50 (0–100) / ivAbs 40% (5–300%) | `pass` jika metric op threshold. ivRank = posisi IV hari ini dalam min–max 30 hari | `Volra ✓ NVDA IV rank 68 ≥ 50` / `Volra ✗ TSLA IV rank 22 < 50` | offchain |
| **Trendix** | Entry searah tren | Candle harga share | `timeframe: 1h\|1d` (1d); `fast` 20 (5–100); `slow` 50 (10–200); `direction: bullish\|bearish` (bullish) | bullish: price > SMA fast > SMA slow | `Trendix ✓ AAPL 231.4 > SMA20 228.9 > SMA50 224.1` | offchain |
| **Earnex** | Hindari atau incar earnings | Kalender earnings | `mode: block\|only` (block); `daysBefore` 2 (0–10); `daysAfter` 1 (0–5) | block: `block` jika sekarang ∈ [E−before, E+after]. only: `pass` hanya di jendela itu | `Earnex ✗ NVDA earnings in 1d (blocked)` / `Earnex ✓ earnings window open` | offchain |
| **Gapro** | Reaksi gap harga setelah open/weekend | Harga terakhir sebelum jeda sesi vs harga pertama setelahnya | `minGapPct` 2% (0,5–10); `direction: up\|down\|any` (any); `action: requireGap\|blockOnGap` (blockOnGap); `validHours` 2 (1–8) | Hitung gap% di awal sesi; berlaku `validHours` | `Gapro ✗ TSLA gapped −3.4% at open (blocked 2h)` | offchain |
| **Rangel** | Buka hanya dalam rentang harga | Harga share | `mode: absolute\|bandAroundSMA` (band); `min/max` atau `bandPct` ±5% (1–30) di sekitar SMA20 1d | `pass` jika harga dalam rentang | `Rangel ✓ SPY 512.0 within 488–540` | offchain |
| **Momira** | Syarat momentum | RSI(14) 1h, perubahan % | `mode: rsi\|change` (rsi); RSI `op` above, `level` 50 (5–95); change `pct` +2% (±0,5–20) dalam `hours` 24 (1–168) | Bandingkan | `Momira ✓ RSI14 57 > 50` | offchain |
| **Skewr** | Sentimen dari harga put vs call | IV put & call OTM setara (atau rasio premi) | `measure: ivSkew\|premiumRatio` (ivSkew); `op` below; `threshold` 5 vol pts (−30–30) | ivSkew = IV(put −X%) − IV(call +X%), X = 5% | `Skewr ✓ put skew 3.1 < 5 (calm sentiment)` | offchain. **Butuh venue quote put & call** [V2/V4] |
| **Calmo** | Buka hanya kalau pasar tenang | Realized vol 24h & 30d, move 1h terbesar | `rvRatioMax` 1,2 (0,5–3); `maxHourlyMovePct` 3% (0,5–10) | `pass` jika RV24/RV30 ≤ max dan tidak ada move 1h > max dalam 24 jam | `Calmo ✓ RV ratio 0.9, max 1h move 1.1%` | offchain |
| **Corpax** | Pause saat split/dividen/corporate action | Event multiplier (§6.5) + kalender | `pauseHoursBefore` 24 (0–72); `pauseHoursAfter` 24 (0–72); `flagOpenPositions` true | `block` entry dalam jendela. Kalau multiplier berubah tak terjadwal → block 24 jam + event | `Corpax ✗ AAPL multiplier changed 1.0000→1.0027 (paused 24h)` · event `corporate_action.detected` | **offchain + onchain** (status dipost ke GuardRegistry, ditegakkan OptraGuardHook di spot leg) |
| **Sessia** | Eksekusi hanya di sesi tertentu | Jam sekarang vs kalender sesi (§13.10) | `sessions[]` ⊂ {openingBell, regular, closingBell, extended, overnight, weekend} (regular); `appliesTo: entries\|all` (entries) | `pass` jika sekarang di sesi terpilih | `Sessia ✓ Opening Bell (09:30–10:30 ET · 22:30–23:30 WITA)` | **offchain + onchain** (OptraGuardHook cek jadwal saat swap) |

### 7.5 Tahap 2: Strike (7 hook)

| Hook | Kegunaan | Input | Parameter (default; range) | Logika | Output | v1 |
|---|---|---|---|---|---|---|
| **Deltra** | Pilih strike dari target delta | Chain venue + Greeks hitungan Optra | `type: call\|put`; `side: buy\|sell`; `targetDelta` 0,25 (0,05–0,95); `tolerance` 0,05 | Strike dengan \|delta − target\| terkecil dalam toleransi. Kalau tidak ada → `block` | `Deltra → NVDA 7-Day 152C, Δ0.26 (target 0.25)` | offchain |
| **Percy** | Strike dari jarak % harga | Harga share, grid strike | `type`, `side`; `otmPct` 5% (−20–30; negatif = ITM); `rounding: nearest\|up\|down` (nearest) | target = price×(1±otm%) → strike grid terdekat | `Percy → 5% OTM: target 151.2 → strike 152` | offchain |
| **Tenora** | Pilih expiry | Daftar expiry venue | `cycle: daily\|weekly\|monthly` (weekly); `targetDTE` 7 (1–45); `minDTE` 2 (0–30) | Expiry terdekat ke targetDTE dengan DTE ≥ minDTE | `Tenora → expiry 2026-11-18 (DTE 7)` | offchain |
| **Premo** | Filter premi minimum | Quote premi | `minPremiumPct` 0,8% of spot (0,1–10) **atau** `minPremiumUsd` | Buang kandidat yang preminya di bawah min. Kalau kosong → `block` | `Premo ✓ premium 1.12% ≥ 0.8%` / `Premo ✗ best premium 0.4%` | offchain |
| **Spreadix** | Spread dua kaki (bull call / bear put) | Chain | `kind: bullCall\|bearPut`; `longLeg` via otmPct 0% (ATM); `widthPct` 5% (1–20); `maxDebitPct` 40% of width | Long leg + short leg (lebih OTM). Short leg ter-cover oleh long leg, jadi maksimal rugi = debit | `Spreadix → bull call 148C/155C, debit $2.10, max loss $2.10` | offchain. Butuh venue bisa sell leg [V3] |
| **Strangl** | Straddle/strangle (long) | Chain | `kind: straddle\|strangle` (straddle); `otmPct` 5% (strangle); v1 **long only** | Beli call + put dengan expiry sama | `Strangl → long straddle TSLA 245C+245P, cost $18.40` | offchain |
| **Collara** | Collar: put protektif dibiayai jual call | Holding token, chain | `putOtmPct` 5% (1–20); `callOtmPct` 7% (1–30); `targetNetCost` ≈ $0 (±) | Beli put + jual call covered (wajib Coverix) | `Collara → buy 142P / sell 160C, net credit $0.15` | offchain. Butuh write [V3] |

### 7.6 Tahap 3: Size (4 hook)

| Hook | Kegunaan | Input | Parameter (default; range) | Logika | Output | v1 |
|---|---|---|---|---|---|---|
| **Capra** | Batas % modal per posisi (wajib) | Modal agent, premi/max loss | `maxPctPerPosition` 10% (1–50); `maxOpenPositions` 3 (1–10) | Size = floor(modal×% / maxLossPerContract) | `Capra → 2 contracts (risk $19.80 = 9.9% of $200)` | offchain |
| **Kelvo** | Sizing adaptif terhadap volatilitas | RV 30d | `targetVol` 40% (10–150); `minScale` 0,25; `maxScale` 1 | scale = clamp(target/RV, min, max) × size Capra | `Kelvo ×0.6 (RV 66% vs target 40%)` | offchain |
| **Laddr** | Masuk bertahap | — | `tranches` 3 (2–5); `by: time\|strike` (time); `everyHours` 24 (1–168) / `strikeStepPct` 2,5% | Bagi size total menjadi N order. Tranche berikutnya tetap harus lolos Gate | `Laddr → tranche 1/3: 1 contract` | offchain |
| **Coverix** | Jumlah covered call = token yang dipegang | Saldo token × multiplier, ukuran kontrak venue | `coveragePct` 100% (10–100); `lockTokens` true | contracts = floor(effectiveShares × cov% / contractSize). Token "dikunci" logis (tidak dihitung lagi untuk agent lain) | `Coverix → 3 calls cover 3.0 NVDA (100%)` | offchain (+ onchain lock bila venue mendukung) |

### 7.7 Tahap 4: Pulse (7 hook)

| Hook | Kegunaan | Input | Parameter (default; range) | Logika | Output | v1 |
|---|---|---|---|---|---|---|
| **Profira** | Take profit | Mark premi | long: `gainPct` 50% (10–300); short: `capturePct` 50% (10–95) | Long: mark ≥ entry×(1+g). Short: mark ≤ entry×(1−c) → close | `Profira → close NVDA 152C: captured 52% of premium (+$1.48)` | offchain |
| **Stopra** | Stop loss | Mark premi / harga share | `basis: premium\|underlying` (premium); long `lossPct` 50% (10–100); short `premiumMultiple` 2× (1,2–5); underlying `movePct` 5% | Memicu close | `Stopra → close TSLA 245P: premium −50%` | offchain |
| **Trailo** | Trailing stop | Mark premi tertinggi | `activateAtGainPct` 30% (5–200); `trailPct` 20% (5–50) | Setelah aktif, close jika mark ≤ peak×(1−trail) | `Trailo armed at +30% · stop at $3.12` | offchain |
| **Rolla** | Roll saat kondisi terpenuhi | Delta, jarak ke strike, DTE | `trigger: delta\|distancePct\|dte` (distancePct); `delta` 0,5; `distancePct` 1% (0–10); `dte` 2; `rollTo: sameStrikeNextExpiry\|reselect` (reselect pakai Strike stage); `maxRolls` 3 (0–10); `requireNetCredit` true (short) | Close + open baru dalam satu intent | `Rolla → rolled AAPL 235C 11-18 → 240C 11-25, net credit $0.40 (roll 1/3)` | offchain |
| **Thetix** | Tutup awal setelah time decay terkumpul (short premi) | Captured %, waktu berlalu % | `minCapturedPct` 60% (20–95); `minTimeElapsedPct` 50% (10–95) | Close jika keduanya terpenuhi | `Thetix → close: 63% captured at 55% of time` | offchain |
| **Hedgra** | Hedge saat delta terlalu besar | Delta posisi per underlying (dalam $ per 1% move) | `maxDeltaUsdPer1Pct` $5 (≥$1); `hedgeWith: spot\|put` (spot); `hedgeRatio` 50% (10–100) | Kalau \|delta$\| > max: beli/jual stock token via **SpotAdapter (pool v4 Optra)**, atau beli put | `Hedgra → sold 0.4 NVDA token to cut delta $7.2→$3.6 per 1%` | offchain intent; **spot leg lewat pool v4 ber-OptraGuardHook** |
| **Rescu** | Selamatkan posisi short yang tertekan | ITM %, DTE | `itmPct` 2% (0–20); `action: rollOutAndAway\|close` (roll); `maxRescues` 1 (0–3); `requireNetCredit` true | Short call ITM → roll ke expiry berikutnya + strike lebih tinggi untuk net credit. Kalau tidak bisa → close | `Rescu → rolled 152C→158C next week, net credit $0.22` / `Rescu → no credit roll, closing` | offchain |

### 7.8 Tahap 5: Expiry (3 hook)
Urutan evaluasi: **Settla → Nextra → Lastra**. Kalau Settla memutuskan "biarkan expire", Lastra dilewati untuk posisi itu.

| Hook | Kegunaan | Input | Parameter (default; range) | Logika | Output | v1 |
|---|---|---|---|---|---|---|
| **Settla** | Biarkan expire jika masih OTM aman | Harga share, strike, jam ke expiry | `otmBufferPct` 2% (0,5–10); `checkHoursBefore` 6 (1–24) | Pada T−check: jika OTM ≥ buffer → `hold to expiry` (hemat fee close) | `Settla → NVDA 152C 3.1% OTM, letting it expire` | offchain |
| **Nextra** | Roll otomatis ke siklus berikutnya | Status posisi saat/sebelum expiry | `when: afterSettle\|hoursBefore` (afterSettle); `hoursBefore` 4; `respectGate` true | Setelah posisi selesai, jalankan ulang Strike+Size untuk siklus berikut. Kalau `respectGate`, Gate wajib lolos | `Nextra → new cycle: NVDA 7-Day call, Gate passed` / `Nextra → skipped: Earnex blocked` | offchain |
| **Lastra** | Tutup semua posisi N jam sebelum expiry | Jam ke expiry | `hoursBefore` 4 (1–48) | Close semua posisi agent dengan jam ke expiry ≤ N (kecuali sudah diputuskan Settla) | `Lastra → closing 2 positions, 4h to expiry` | offchain |

Catatan resolusi waktu: tick per jam → parameter jam dibulatkan ke jam penuh. Untuk Lastra/Settla, engine menambahkan **tick tambahan** pada T−N jam kalau jatuh di antara tick.

### 7.9 Tahap 6: Breaker (5 hook, selalu aktif)

| Hook | Kegunaan | Input | Parameter (default; range) | Logika | Output | v1 |
|---|---|---|---|---|---|---|
| **Haltr** | Circuit breaker saat harga/vol ekstrem | Move harga 1h, lonjakan IV | `maxMove1hPct` 7% (2–20); `ivSpikePct` +50% relatif (10–200); `cooldownHours` 6 (1–48) | Trip → mode `no_new_entries` untuk underlying itu selama cooldown; exit tetap jalan | `Haltr ⛔ TSLA moved −8.2% in 1h · entries halted 6h` · event `breaker.tripped` | **onchain + offchain** (status di GuardRegistry; OptraGuardHook menolak swap spot underlying itu selama halt, kecuali swap yang mengurangi eksposur, lihat §8) |
| **Daylo** | Batas rugi harian per agent | PnL realized + mark (UTC day) | `maxDailyLossPct` 3% (0,5–20) | Trip → `no_new_entries` sampai 00:00 UTC (ditampilkan 08:00 WITA) | `Daylo ⛔ −3.2% today · paused until 08:00 WITA` | offchain |
| **Drawra** | Matikan agent jika drawdown dalam | Equity peak vs sekarang | `maxDrawdownPct` 20% (5–50); `onTrip: stopEntries\|closeAll` (stopEntries) | Trip → status agent `stopped` (butuh restart manual user). Pulse/Expiry tetap mengelola posisi sisa | `Drawra ⛔ drawdown 21% from peak · agent stopped` · event `agent.stopped` | offchain |
| **Exposa** | Batas eksposur gabungan per saham (manual + agent) | Semua posisi di Optra Book untuk underlying itu | `maxUnderlyingPct` 25% of book value (5–100); `maxDeltaUsdPer1Pct` per underlying (opsional) | Agent: `block` entry yang melewati cap. Manual: lihat §14 | `Exposa ✗ NVDA exposure 27% > 25% (incl. your manual positions)` | offchain |
| **Venux** | Pause jika venue tidak normal | Umur quote, spread, deviasi vs model, error rate adapter | `maxQuoteAgeMin` 10 (1–60); `maxSpreadPct` 15% of mid (2–50); `maxModelDevPct` 25% (5–100); `maxErrorRate` 20% per jam | Trip → venue `degraded`: tidak ada entry; exit ditunda maks 3 tick lalu dicoba lagi/alert | `Venux ⛔ CallPut quotes stale 14 min · venue paused` · event `venue.degraded` | **offchain + onchain** (status venue dipost ke GuardRegistry; dibaca hook untuk hedge leg) |

### 7.10 Event & kode error hook
- Event: `hook.evaluated`, `breaker.tripped`, `breaker.cleared`, `corporate_action.detected`, `venue.degraded`, `venue.recovered`, `agent.stopped`, `agent.paused`, `session.opened`, `session.closed`.
- Kode error: `DATA_MISSING`, `VENUE_UNAVAILABLE`, `NO_STRIKE_IN_TOLERANCE`, `NO_EXPIRY`, `PREMIUM_TOO_LOW`, `INSUFFICIENT_COVER`, `CAP_EXCEEDED`, `SESSION_CLOSED`, `HALTED`.

---

## 8. Uniswap v4 hooks: onchain vs offchain (KEPUTUSAN ARSITEKTUR v1)

### 8.1 Kenyataan teknis yang harus dipahami semua orang
- Kontrak hook Uniswap v4 **hanya berjalan pada pool v4 yang di-inisialisasi dengan hook itu** (alamat hook ditetapkan saat pool dibuat). Hook tidak bisa ditempel ke pool orang lain yang sudah ada.
- Di Jalur A, kaki options dieksekusi di **CallPut/Zeno**, bukan di pool Uniswap. Jadi hook v4 **tidak** bisa memblokir order options itu sendiri.
- Akibatnya, di v1 hook v4 hanya bisa menjaga transaksi yang memang lewat pool v4 milik Optra, yaitu **kaki spot**: hedge (Hedgra), membeli/menjual stock token untuk covered call (Coverix/Collara), dan swap kolateral USDG ↔ stock token.

### 8.2 Pembagian v1

| Hook | Lokasi v1 | Cara kerja onchain |
|---|---|---|
| **Haltr** | Onchain + offchain | Keeper Optra memposting `haltUntil[token]` ke **GuardRegistry**. `OptraGuardHook.beforeSwap` me-revert swap yang **menambah** eksposur underlying itu selama halt. Swap yang mengurangi eksposur (exit/hedge-reduce) diizinkan lewat `hookData` flag + verifikasi arah |
| **Venux** | Onchain + offchain | Keeper memposting `venueStatus[venueId]`. Hook me-revert swap ber-`hookData.purpose = hedge` yang terkait venue `degraded` (supaya tidak hedge posisi yang tidak bisa dikelola) |
| **Corpax** | Onchain + offchain | Hook membaca `currentMultiplier` token langsung (bila callable dari hook dengan gas wajar) atau `GuardRegistry.caPause[token]`. Revert swap entry selama jendela pause |
| **Sessia** | Onchain + offchain | Hook menyimpan jadwal sesi (atau root jadwal yang di-update admin) dan memeriksa `block.timestamp`. Pool dikonfigurasi `sessionMode` (mis. hanya regular + opening/closing bell untuk swap entry) |
| 32 hook lain (Gate selain Corpax/Sessia, semua Strike, Size, Pulse, Expiry, Daylo, Drawra, Exposa) | **Offchain** (Rule Engine) | Dicatat di Tape. Status bisa diverifikasi lewat hash recipe + log publik, bukan lewat kontrak |

Kontrak v1 yang dibangun dev (Solidity, Foundry):
1. **`OptraGuardHook`**: permission `beforeSwap` (opsional `beforeAddLiquidity` untuk jendela sesi LP, default **tidak** memblokir penarikan LP; pola BELL "exit tidak dikunci").
2. **`GuardRegistry`**: state halt/venue/CA per token, ditulis oleh **keeper role** (multisig-admin bisa mencabut keeper). Event onchain: `HaltSet(token, until, reason)`, `VenueStatusSet(venueId, status)`, `CorporateActionPause(token, from, until)`, `SessionScheduleUpdated(root)`.
3. **Pool v4 Optra**: pasangan stock token/USDG untuk underlying yang didukung, di-inisialisasi dengan `OptraGuardHook`.

### 8.3 Hal yang wajib diverifikasi dev sebelum menulis kontrak [VERIFIKASI DEV]
1. Apakah stock token RH boleh dipasangkan di pool v4 dengan **hook custom** (transfer restriction, allowlist, catatan qHooks yang menyebut hook stock-pair proprietary RH tidak portable)?
2. Alamat PoolManager v4 di 4663 (catatan Zolva: `0x8366…0951`, harus dicek alamat lengkapnya) dan dukungan router (Universal Router / v4 router) di RH.
3. **Likuiditas:** pool Optra baru akan tipis. Opsi: (a) Optra seed likuiditas kecil, (b) router memecah order (sebagian lewat pool Optra, sisanya lewat pool besar tanpa hook). Kalau (b), klaim v4 hanya berlaku untuk porsi yang lewat pool Optra.
4. Gas & keamanan `beforeSwap`: membaca `currentMultiplier` dari hook (external call ke token) dan risiko DoS kalau keeper mati. Default aman = **fail-open untuk exit, fail-closed untuk entry**.
5. Audit: hook menyentuh dana pihak yang swap di pool → **wajib audit** sebelum mainnet publik. Sebelum audit, pakai label `Unaudited beta` dan cap TVL pool.

### 8.4 Level klaim copy (DIKUNCI)

| Level | Kondisi teknis | Copy yang diizinkan | Copy terlarang |
|---|---|---|---|
| **L0** | Semua hook offchain (belum ada kontrak live di mainnet) | `Hooks inspired by Uniswap v4 hooks.` · ID: "terinspirasi Uniswap v4 hooks" | "Built on Uniswap v4", "onchain hooks" |
| **L1 (target v1)** | `OptraGuardHook` live di mainnet 4663, dipakai untuk kaki spot agent | `Breakers and Sessions run as Uniswap v4 hooks.` · `Built with Uniswap v4 hooks.` (dengan link ke Verify yang menampilkan alamat hook) | "Every hook is onchain", "options settle on Uniswap" |
| **L2 (fase 2)** | Jalur B: options vault/market sebagai v4 hooks | `Built on Uniswap v4 hooks.` | Klaim partnership/"official Uniswap" di level mana pun |

Aturan FE: komponen hero membaca flag `V4_CLAIM_LEVEL` (L0/L1/L2) dari config, jadi copy berganti otomatis tanpa deploy ulang copy. Verify menampilkan level aktif.

---

## 9. Custody & signer policy (real money)

### 9.1 Opsi

| Opsi | Cara | Plus | Minus |
|---|---|---|---|
| **C1. Delegated signer (pola Zolva)** | User menambahkan "Optra signer" ke embedded wallet (Privy-like) dengan policy: hanya boleh approve/call kontrak venue allowlist + router pool Optra, penerima = wallet user | Sudah terbukti di RH (Zolva, Oreno) | Zolva **tidak** membatasi jumlah approve dan `amountOutMinimum` di policy (hanya di backend). Kalau backend jebol, dana bisa dirugikan lewat slippage |
| **C2. Smart account + session key (DIREKOMENDASIKAN)** | Smart account user (ERC-4337 / EIP-7702) memberi session key ke Optra executor: allowlist kontrak & selector, **cap USDG per tx dan per hari onchain**, expiry session (mis. 30 hari), revoke 1 klik | Batasan ditegakkan **onchain**, bukan cuma backend | Perlu cek apakah kontrak venue bisa dipanggil dari smart account dan dukungan bundler/paymaster di RH [VERIFIKASI DEV] |
| C3. Vault custody Optra | User deposit ke vault Optra | UX paling simpel | Optra menjadi kustodian. Risiko regulasi & keamanan tinggi. **Tidak untuk v1** |

### 9.2 Rekomendasi
- **C2 sebagai target.** Kalau dalam spike 1–2 minggu ternyata tidak layak di RH, pakai **C1 dengan perbaikan wajib**: policy membatasi `approve` maksimal = cap harian, `amountOutMinimum` wajib ≥ quote × (1 − 1%), nilai `value` 0, chain 4663, dan penerima = wallet user.
- Approve **tidak pernah unlimited**. Approve diperbarui per hari sebesar cap.
- Tombol **"Revoke Optra"** di Risk Desk selalu terlihat. Hasilnya: session key dicabut onchain + semua agent live → `paused`.
- Halaman Verify mencantumkan alamat executor, policy (JSON), dan cara mengecek sendiri.

---

## 10. Data model

Semua tabel Postgres. `id` = UUID, `*_at` = timestamptz (UTC di DB, ditampilkan WITA/lokal di UI).

### 10.1 `users`
| Field | Tipe | Catatan |
|---|---|---|
| id | uuid | |
| auth_provider | enum(email, google, wallet) | |
| wallet_address | text | embedded/smart account |
| country_code | text | untuk geo-gate |
| live_status | enum(none, pending, allowed, blocked) | §16 |
| created_at | timestamptz | |

### 10.2 `agents`
| Field | Tipe | Catatan |
|---|---|---|
| id | uuid | |
| owner_id | uuid → users | null untuk House Agent (owner = Optra) |
| kind | enum(house, custom, follow) | follow = salinan dari Listing |
| name | text | mis. "Covered Call NVDA" |
| underlyings | text[] | 1–3 simbol [USULAN, pola Zolva] |
| recipe_id | uuid → recipes | versi terkunci |
| mode | enum(paper, live) | |
| venue | enum(paper, callput, zeno) | |
| status | enum(draft, backtested, paper_running, live_eligible, live_running, paused, stopped, archived) | §11 |
| capital_usdg | numeric | modal virtual (paper) / cap (live) |
| ai_veto | jsonb | {enabled, model, budgetUsd, endsAt} |
| visibility | enum(private, public, listed) | |
| source_listing_id | uuid null | untuk follow |
| created_at, launched_at | timestamptz | |

### 10.3 `recipes` (hook config, immutable setelah launch)
| Field | Tipe | Catatan |
|---|---|---|
| id | uuid | |
| version | int | edit = versi baru (fork) |
| hooks | jsonb | array `{hook, stage, params, enabled}` |
| structure | enum(single, spread, straddle, strangle, collar, covered_call, cash_secured_put) | turunan validator |
| hash | text | sha256 JSON kanonik. Ditampilkan di Tape & Listing |
| created_from | enum(click, prompt, template, api) | |
| prompt_text | text null | prompt asli (Forge) |
| ai_notes | text null | niat yang tidak bisa dijadikan hook |

Contoh `hooks` (House Agent Covered Call):
```json
[
  {"hook":"volra","stage":"gate","params":{"metric":"ivRank","op":"above","threshold":50}},
  {"hook":"earnex","stage":"gate","params":{"mode":"block","daysBefore":2,"daysAfter":1}},
  {"hook":"corpax","stage":"gate","params":{"pauseHoursBefore":24,"pauseHoursAfter":24}},
  {"hook":"percy","stage":"strike","params":{"type":"call","side":"sell","otmPct":5}},
  {"hook":"tenora","stage":"strike","params":{"cycle":"weekly","targetDTE":7,"minDTE":2}},
  {"hook":"coverix","stage":"size","params":{"coveragePct":100}},
  {"hook":"capra","stage":"size","params":{"maxPctPerPosition":100,"maxOpenPositions":1}},
  {"hook":"profira","stage":"pulse","params":{"capturePct":50}},
  {"hook":"rescu","stage":"pulse","params":{"itmPct":2,"action":"rollOutAndAway","maxRescues":1}},
  {"hook":"settla","stage":"expiry","params":{"otmBufferPct":2,"checkHoursBefore":6}},
  {"hook":"nextra","stage":"expiry","params":{"when":"afterSettle","respectGate":true}},
  {"hook":"haltr","stage":"breaker","params":{"maxMove1hPct":7,"cooldownHours":6}},
  {"hook":"daylo","stage":"breaker","params":{"maxDailyLossPct":3}},
  {"hook":"drawra","stage":"breaker","params":{"maxDrawdownPct":20}},
  {"hook":"exposa","stage":"breaker","params":{"maxUnderlyingPct":100}},
  {"hook":"venux","stage":"breaker","params":{"maxQuoteAgeMin":10}}
]
```

### 10.4 `positions`
| Field | Tipe | Catatan |
|---|---|---|
| id | uuid | |
| owner_id | uuid | |
| **controller** | enum(**you**, **you_hook**, **agent**) | label UI: *You* / *You + Hook* / *Agent* |
| agent_id | uuid null | wajib jika controller = agent |
| attached_hooks | jsonb null | untuk you_hook (Pulse/Expiry saja) |
| venue, venue_position_ref | text | id posisi di venue |
| underlying | text | |
| legs | jsonb | `[{type:call|put, side:buy|sell, strike, expiry, qty, entryPremium}]` |
| structure | enum | seperti recipes |
| collateral | jsonb | `{usdgLocked, tokensCovered}` |
| status | enum(opening, open, closing, closed, expired, settled) | |
| mode | enum(paper, live) | |
| opened_at, closed_at | timestamptz | |
| realized_pnl_usdg, fees_usdg | numeric | |

### 10.5 `orders`
| Field | Tipe | Catatan |
|---|---|---|
| id | uuid | |
| position_id | uuid | |
| intent | enum(open, close, roll_close, roll_open, hedge, settle) | |
| origin | enum(manual, hook, agent) | |
| decision_id | uuid null → decisions | |
| venue_request_id | text | untuk request-based venue |
| params | jsonb | legs, limitPremium, slippageBps |
| status | enum(created, submitted, pending, filled, partially_filled, rejected, expired, cancelled) | |
| tx_hash | text null | |
| error_code | text null | |
| created_at, updated_at | timestamptz | |

### 10.6 State machine order
`created → submitted → pending → filled | partially_filled | rejected | expired`; `created/submitted → cancelled`. Order `pending` lebih dari `maxPendingMin` (USULAN 30 menit) → `expired` + entry Tape "Order not filled, will retry next tick (attempt 2/3)".

### 10.7 `backtest_runs`
| Field | Tipe | Catatan |
|---|---|---|
| id | uuid | |
| recipe_id / recipe_json | | backtest bisa dijalankan untuk recipe belum tersimpan (x402) |
| underlyings, capital | | |
| window_start, window_end | timestamptz | default 30 hari |
| premium_source | enum(modeled, recorded, mixed) | §13.6 |
| fee_bps, slippage_bps | int | default fee venue + 0,5% [USULAN pola Zolva] |
| results | jsonb | §13.6 |
| engine_version | text | parity |
| requested_via | enum(app, api_x402, mcp) | |
| is_internal_test | bool | **wajib**, untuk statistik jujur |

### 10.8 `decisions` (Optra Tape, append-only)
| Field | Tipe | Catatan |
|---|---|---|
| id | uuid | |
| agent_id | uuid | |
| tick_id | text | `2026-11-11T05:00Z` (idempotent key: agent_id + tick_id) |
| kind | enum(open, close, roll, hedge, hold, skip, pause, resume, stop) | |
| hook_trace | jsonb | array HookResult §7.1 |
| ai_review | jsonb null | `{model, verdict: approve|veto, reason, costUsd}` |
| data_snapshot | jsonb | harga, IV, multiplier, sesi, quote refs |
| summary_text | text | kalimat deterministik (template), English |
| order_ids | uuid[] | |
| mode | enum(paper, live) | |
| created_at | timestamptz | |

### 10.9 `listings`
| Field | Tipe | Catatan |
|---|---|---|
| id | uuid | |
| agent_id | uuid | agent sumber (config terkunci) |
| creator_id | uuid | |
| recipe_hash | text | |
| eligibility_snapshot | jsonb | hasil cek syarat §13.9 |
| stats | jsonb | return, vs holding, vs cash, max DD, decisions, days live/paper |
| status | enum(pending, listed, suspended, delisted) | |
| fee_share_bps | int | [PLACEHOLDER] |
| listed_at | timestamptz | |

### 10.10 `follows` & `fee_ledger`
| `follows` field | Catatan |
|---|---|
| id, listing_id, follower_id, follower_agent_id | follower menjalankan salinan di wallet sendiri |
| capital_usdg, mode | paper/live |
| started_at, ended_at | |

| `fee_ledger` field | Catatan |
|---|---|
| id, order_id, payer_id, listing_id null | |
| optra_fee_usdg, creator_share_usdg | |
| status enum(accrued, paid, reversed) | creator dibayar periodik [USULAN mingguan] |
| tx_hash | |

### 10.11 Tabel pendukung
`markets` (symbol, token_address, multiplier, venues_supported, status), `price_candles` (hourly OHLC share & token price), `option_quotes` (venue, symbol, strike, expiry, type, bid/ask/mid, iv, ts), `guard_states` (mirror GuardRegistry), `sessions_calendar`, `x402_payments` (payer, endpoint, amount, tx, is_internal_test), `api_keys` (opsional, rate limit tinggi), `live_settings` (kill switch, caps).

---

## 11. Agent lifecycle & loop per jam

### 11.1 Status agent
```
draft ──backtest──► backtested ──launch──► paper_running ──(syarat §16)──► live_eligible ──user enable──► live_running
   ▲                                          │   ▲                                                         │
   └─────────── fork (edit = versi baru) ◄────┘   └──── paused (user / Daylo / Haltr / Venux) ◄─────────────┘
                                              stopped (Drawra / user) → archived
```
- **Launch mengunci recipe** (hash). Edit = fork menjadi agent baru, sehingga track record lama tetap jujur (pola Zolva).
- Agent private secara default. Publish → `public` (muncul di Tape publik dan leaderboard). Listing → §13.9.

### 11.2 Loop per jam (`runTick`)
1. Cron memicu `/api/cron/tick` pada menit :05 (backup :07). Idempotent per `tick_id` (pola Zolva).
2. Data refresh: harga, multiplier, quote venue, status sesi, guard state.
3. Untuk setiap agent berstatus running: evaluasi sesuai §7.3.
4. Intent → Execution Layer → order. Venue yang request-based menunggu fill. Status dicek ulang di tick berikutnya atau lewat poll 5 menit.
5. Tulis `decisions` (selalu, termasuk hold/skip).
6. Notifikasi (in-app; email/Telegram opsional fase 2) untuk: open, close, roll, breaker trip, agent stopped.

**Tick tambahan (event tick):** saat sesi dibuka (Opening Bell), T−N jam sebelum expiry (Lastra/Settla), dan breaker monitor setiap 5 menit (hanya Breaker + exit darurat; entry tetap hanya di tick jam/sesi).

### 11.3 Contoh output Tape (satu tick, ditampilkan apa adanya)
```
11 Nov 2026 · 22:35 WITA · Covered Call NVDA (House · paper)
OPEN · sell 1× NVDA 152C exp 18 Nov
  Gate    Volra ✓ IV rank 68 ≥ 50 · Earnex ✓ no earnings in window · Corpax ✓ · Sessia ✓ Opening Bell
  Strike  Percy → 5% OTM → 152 · Tenora → 18 Nov (DTE 7) · Premo ✓ 1.12%
  Size    Coverix → 1 call covers 1.0 NVDA · Capra ✓
  AI      Reviewer approved: "IV elevated, no event risk in window."
  Data    NVDA $144.80 · IV 41% · multiplier 1.0000 · quote CallPut 22:31 WITA
  Result  Premium collected $1.62 (paper). Benchmark: just holding NVDA.
```

### 11.4 Acceptance criteria (engine)
- [ ] Engine yang sama dipakai untuk live, paper, dan backtest. Parity test: recipe + data identik → keputusan identik.
- [ ] Setiap tick setiap agent yang running menghasilkan tepat satu `decision` (idempotent).
- [ ] Exit tidak pernah diblokir oleh Gate, Sessia, atau AI veto.
- [ ] Data hilang tidak pernah membuka posisi (`DATA_MISSING` → block).
- [ ] Recipe terkunci setelah launch. Hash yang tampil di Tape = hash recipe.

---

## 12. AI Layer (penerjemah + veto, bukan pengambil keputusan)

### 12.1 Prinsip
- **Rules decide. AI writes the rules with you, and can veto.** Kalimat ini juga dipakai di copy (§17) supaya label "AI agent" tetap jujur. Zolva sendiri menolak handle "AI" karena dianggap oversell. Optra memakai "AI agent" tapi selalu dengan penjelasan ini.
- AI **tidak pernah** membuka order, mengubah size, memblokir exit, atau memblokir Breaker.

### 12.2 Tugas AI

| Tugas | Input | Output | Batas |
|---|---|---|---|
| **Compose** (Forge prompt mode) | Prompt user 10–600 karakter, bahasa apa pun (termasuk Bahasa Indonesia) | Recipe JSON (schema strict) + `notes` (niat yang tidak bisa dijadikan hook) + `explanation` 1–3 kalimat | Kuota 10×/24 jam per user [USULAN]. Output **selalu** lewat validator §7.2 sebelum ditampilkan |
| **Veto** (opsional per agent) | Intent open/roll + hook_trace + data snapshot + notes | `{verdict: approve|veto, reason ≤ 200 char}` | Hanya untuk intent yang menambah risiko. Kalau AI timeout (20 detik) atau error, default = **skip entry** (lebih aman), dicatat di Tape sebagai `AI review unavailable, entry skipped` |
| **Explain** (opsional, fase 1.5) | Decision | Ringkasan bahasa awam | `summary_text` utama tetap template deterministik |

### 12.3 Teknis
- Provider via router multi-model (pola OpenRouter). JSON schema strict, temperature ~0,2, reasoning off untuk compose/veto (pola Zolva).
- Budget: global harian [USULAN $5/hari di beta, pola Zolva] + budget per agent (`ai_veto.budgetUsd`, `endsAt`). Biaya dicatat per call.
- Daftar model = config, bukan hardcode. Jangan menyebut nama model di copy marketing kecuali benar-benar dipanggil di produksi.
- Prompt injection: prompt user diperlakukan sebagai data. Output hanya diterima bila valid terhadap schema + allowlist hook/parameter.

### 12.4 Output yang diharapkan (contoh Compose)
Input: `"jual covered call NVDA tiap minggu kalau IV lagi tinggi, jangan pas earnings, ambil untung 50%"`
```json
{
  "recipe": { "structure": "covered_call", "hooks": ["volra(ivRank>50)", "earnex(block,2d/1d)", "percy(call,sell,5%)", "tenora(weekly,7d)", "coverix(100%)", "profira(capture 50%)", "nextra(afterSettle)"] },
  "notes": [],
  "explanation": "Sells a 5% out-of-the-money weekly NVDA call when implied volatility is high, skips earnings weeks, and closes once half the premium is captured.",
  "warnings": ["Covered calls cap your upside above the strike."]
}
```
(Bentuk ringkas di atas untuk brief. Output asli = array hook lengkap seperti §10.3.)

### 12.5 Acceptance criteria
- [ ] 20 prompt uji (10 English, 10 Bahasa Indonesia) → ≥ 90% menghasilkan recipe valid tanpa edit [USULAN target].
- [ ] Prompt yang meminta naked short (`"jual put TSLA tanpa jaminan"`) → ditolak dengan pesan `Optra only writes covered calls or cash-secured puts.`
- [ ] Veto tidak pernah muncul pada decision `close`/`stop`.

---

## 13. Spesifikasi fitur

Format setiap fitur: **Kegunaan · Cara kerja · Output yang diharapkan · Acceptance criteria.** Urutan sengaja agent-first.

### 13.1 Optra Hooks (perpustakaan 36 hook)
- **Kegunaan:** katalog semua aturan yang bisa dirakit agent, sekaligus konten edukasi dan SEO.
- **Cara kerja:** halaman `/hooks` dengan filter tahap (Gate, Strike, Size, Pulse, Expiry, Breaker) dan badge lokasi (`Onchain · Uniswap v4` hanya untuk hook yang live di L1, `Offchain engine` untuk lainnya). Detail `/hooks/{name}` menampilkan kegunaan, parameter + default + range, contoh output Tape, recipe House Agent yang memakainya, dan "Live status now" (mis. Volra aktif di 4 dari 20 market).
- **Output:**
  - Kartu hook: nama, tahap, satu kalimat, badge lokasi.
  - Detail: tabel parameter, contoh `HookResult`, mini-chart kapan hook aktif 30 hari terakhir.
  - API: `GET /api/public/v1/hooks`, `/hooks/{name}`.
- **Acceptance:**
  - [ ] Tepat 36 hook tampil, terbagi 10/7/4/7/3/5.
  - [ ] Badge onchain hanya muncul untuk hook dengan alamat kontrak terverifikasi di Verify.
  - [ ] Setiap hook punya contoh output Tape.

### 13.2 Optra Forge (builder strategi)
- **Kegunaan:** merakit Custom Agent tanpa coding, lewat klik atau bahasa biasa.
- **Cara kerja:**
  1. Pilih underlying (1–3) dan modal (paper default $1.000 virtual [USULAN]).
  2. **Mode klik:** kolom 6 tahap. Setiap tahap punya slot hook. Drag/klik untuk menambah, lalu edit parameter dengan slider dalam range §7.
  3. **Mode prompt:** textarea → AI Compose → hasilnya tampil sebagai hook yang sama persis (bisa dibaca & diedit). Tidak ada "kotak hitam".
  4. Validator real-time (§7.2) dengan error yang bisa dibaca manusia.
  5. Panel kanan: "What this agent will do" dalam 3 kalimat (template), risiko utama (mis. "Upside capped above strike"), dan payoff diagram sederhana.
  6. Tombol **Backtest 30 days** (wajib sebelum Launch) → Lab.
  7. **Launch on paper** → recipe dikunci, status `paper_running`.
  8. Mulai dari template: query `?template=covered-call` atau `?from=<agentId>` (fork), pola Zolva Studio.
- **Output:** recipe JSON + hash, preview payoff, ringkasan, error validator, tombol Launch aktif hanya kalau backtest selesai.
- **Acceptance:**
  - [ ] Recipe dari prompt bisa diedit di mode klik tanpa kehilangan parameter.
  - [ ] Launch tidak bisa diklik tanpa backtest dari versi recipe yang sama.
  - [ ] Recipe dengan short leg tanpa Coverix/cash-secured ditolak.
  - [ ] Waktu dari halaman kosong sampai agent paper berjalan ≤ 5 menit untuk user baru (uji 5 orang).

### 13.3 House Agents (agent buatan Optra)
- **Kegunaan:** agent siap pakai sebagai pintu masuk utama untuk pemula, sekaligus wajah brand.
- **Cara kerja:** recipe tetap buatan Optra. User memilih underlying + modal + (opsional) mengubah parameter dalam range terbatas, yang otomatis menjadi Custom Agent turunan. Semua House Agent **jalan di paper secara publik** sejak hari pertama (track record Optra sendiri), dan **diberi label "by Optra"**. Jangan pernah menghitung House Agent sebagai adopsi komunitas (pelajaran dari Zolva).
- **Ketersediaan live tergantung V3:**

| House Agent | Butuh write (jual opsi)? | Live di venue buy-only? |
|---|---|---|
| Covered Call | Ya (covered) | Tidak, paper only |
| Cash-Secured Put | Ya (cash-secured) | Tidak, paper only |
| Protective Put | Tidak | Ya |
| Earnings Straddle | Tidak | Ya |

#### 13.3.1 Covered Call
- **Untuk siapa:** holder stock token yang ingin penghasilan mingguan. **Risiko:** upside terpotong di atas strike, dan token tetap bisa turun.
- **Recipe:** lihat JSON §10.3. Ringkas: Gate `Volra(ivRank>50) + Earnex(block 2d/1d) + Corpax(24h/24h)` → Strike `Percy(call, sell, 5% OTM) + Tenora(weekly, DTE 7, min 2)` → Size `Coverix(100%) + Capra(1 posisi)` → Pulse `Profira(capture 50%) + Rescu(ITM 2%, roll out & away, maks 1)` → Expiry `Settla(buffer 2%, T−6h) + Nextra(afterSettle, respectGate)` → Breaker default (`Haltr 7%/1h`, `Daylo 3%`, `Drawra 20%`, `Exposa 100%`, `Venux`).
- **Syarat:** wallet memegang ≥ 1 kontrak-ekuivalen token (effective shares).
- **Output kartu:** `Weekly premium collected`, `Times called away`, `Return vs just holding NVDA`, `Max drawdown`, `Next action` (mis. "Waiting for IV rank > 50").

#### 13.3.2 Cash-Secured Put
- **Untuk siapa:** user dengan USDG yang mau mengumpulkan premi dan siap "membeli" di harga lebih rendah (di opsi sintetis cash-settled, artinya menanggung rugi selisih harga). **Risiko:** rugi bila saham turun di bawah strike − premi.
- **Recipe:** Gate `Volra(ivRank>50) + Trendix(1d, 20/50, bullish) + Earnex(block 2d/1d) + Corpax` → Strike `Deltra(put, sell, Δ0.25 ±0.05) + Tenora(weekly, DTE 7) + Premo(≥0.6% of spot)` → Size `Capra(cash-secured: USDG terkunci = strike × qty; maks 50% modal per posisi, maks 2 posisi)` → Pulse `Profira(capture 50%) + Stopra(premium 2×) + Rescu(ITM 2%, roll out & down, maks 1)` → Expiry `Settla(buffer 2%) + Nextra(respectGate)` → Breaker default.
- **Output:** `Premium collected`, `Assigned/settled ITM count`, `USDG locked now`, vs holding underlying, vs cash.

#### 13.3.3 Protective Put
- **Untuk siapa:** holder token yang mau asuransi turun. **Risiko:** premi hilang bila saham tidak turun (biaya asuransi).
- **Recipe:** Gate `Calmo(rvRatio ≤ 1.2) OR jadwal bulanan` (default: buka saat tidak ada proteksi aktif) + `Corpax` → Strike `Percy(put, buy, 7% OTM) + Tenora(monthly, DTE 30, min 10)` → Size `Coverix(coverage 100%, dipakai sebagai penghitung token yang dilindungi) + Capra(premi ≤ 2% nilai holding per bulan)` → Pulse `Trailo(activate +100%, trail 30%)` → Expiry `Lastra(T−24h) + Nextra(hoursBefore 24, respectGate false)` → Breaker default.
- **Output:** `Protected value`, `Protection cost this month`, `Floor price`, chart "holding with vs without protection".

#### 13.3.4 Earnings Straddle
- **Untuk siapa:** trader yang memperkirakan earnings akan menggerakkan harga besar tanpa tahu arahnya. **Risiko:** rugi bila pergerakan lebih kecil dari premi, dan IV biasanya turun setelah earnings ("IV crush").
- **Recipe:** Gate `Earnex(mode only, daysBefore 3, daysAfter 0) + Corpax + Haltr default` → Strike `Strangl(straddle, ATM) + Tenora(weekly, expiry pertama setelah tanggal earnings, minDTE 2)` → Size `Capra(maks 5% modal) + Kelvo(target 60%)` → Pulse `Profira(gain 40%) + Stopra(loss 50%)` → Expiry `Lastra(T−24h)` → Breaker default.
- **Output:** `Next earnings in`, `Implied move vs historical move`, `Cost`, `Break-even up/down`.

**Acceptance House Agents:**
- [ ] Keempat agent berjalan di paper publik dengan Tape sejak P1.
- [ ] Kartu menampilkan "vs just holding" **dan** kerugian. Headline tidak pernah memilih window backtest terbaik.
- [ ] Badge `Paper` / `Live` / `Paper only on this venue` sesuai tabel V3.

### 13.4 Custom Agents
- **Kegunaan:** agent milik user dari Forge, fork House Agent, atau via API/MCP (paper).
- **Cara kerja:** lifecycle §11. Batas jumlah agent paper aktif per user: 5 [USULAN, pola Zolva]. Live: 1 per user di beta.
- **Output:** halaman `/agents/{id}`: header (nama, status, mode, venue, recipe hash, controller), chart equity vs holding vs cash, daftar posisi, Tape agent, recipe (read-only), tombol Pause / Resume / Stop / Fork / Publish / Apply to Listing / Enable live.
- **Acceptance:**
  - [ ] Pause berlaku paling lambat di tick berikutnya. Stop mencegah entry baru seketika.
  - [ ] Fork membuat versi baru, dan track record agent lama tidak berubah.

### 13.5 Optra Tape (log keputusan)
- **Kegunaan:** bukti bahwa agent "show their work". Ini juga elemen visual utama landing (ticker tape).
- **Cara kerja:** tabel `decisions` append-only. Tampilan global `/tape` (agent publik saja) + per agent. Filter: agent, underlying, kind, hook, mode. Live update via WebSocket/SSE.
- **Output:** baris ringkas ala ticker (`22:35 WITA · Covered Call NVDA · OPEN sell 152C · Volra ✓ IV rank 68`), expand → format lengkap §11.3. Label `PAPER` jelas di setiap baris paper. Export CSV.
- **Acceptance:**
  - [ ] Setiap baris punya hook_trace lengkap dan referensi data.
  - [ ] Tidak ada baris yang bisa diedit atau dihapus (hanya `superseded_by` untuk koreksi bug, dengan catatan).
  - [ ] Baris paper selalu berlabel `PAPER`.

### 13.6 Optra Lab (backtest & simulasi)
- **Kegunaan:** membuktikan recipe sebelum dijalankan, secara jujur.
- **Cara kerja:**
  - Window default 30 hari per jam (pola Zolva). Window lebih panjang = fitur langganan [USULAN].
  - Harga underlying: candle per jam dari pool onchain, dinormalisasi multiplier (§6.5).
  - **Premi opsi:** di awal tidak ada data historis premi venue [V10]. Karena itu:
    - `modeled`: Black-Scholes dengan IV = IV venue yang terekam bila ada, kalau tidak RV30 × faktor 1,1 [USULAN], ditambah spread & fee asumsi.
    - `recorded`: memakai `option_quotes` yang direkam Optra sejak P1 (makin lama makin banyak).
    - `mixed`: kombinasi keduanya.
    - Badge sumber premi **wajib** tampil di setiap hasil: `Modeled premiums` / `Recorded quotes`.
  - Biaya: fee venue nyata (V8) + slippage 0,5% [USULAN].
  - Benchmark wajib: **just holding** underlying dan **cash (USDG)**.
- **Output (JSON & UI):**
```json
{
  "runId": "bt_01J…",
  "window": {"from":"2026-10-12T00:00Z","to":"2026-11-11T00:00Z","hours":720},
  "premiumSource": "modeled",
  "result": {"returnPct": 1.8, "vsHoldingPct": -2.4, "vsCashPct": 1.8, "maxDrawdownPct": 6.1,
             "trades": 4, "winRate": 0.75, "premiumCollectedUsd": 21.4, "feesUsd": 1.9},
  "equityCurve": [[ "2026-10-12T00:00Z", 1000.0 ], "…"],
  "decisions": 720,
  "warnings": ["Premiums are modeled, not historical venue quotes.", "30 days is a short window."]
}
```
  UI: chart 3 garis (agent / holding / cash), tabel trade, daftar keputusan (format Tape), warning.
- **Acceptance:**
  - [ ] Backtest 30 hari 1 underlying selesai ≤ 10 detik [USULAN].
  - [ ] Hasil negatif ditampilkan sama menonjolnya dengan hasil positif.
  - [ ] Parity: tick ke-N backtest = keputusan engine live pada data yang sama.

### 13.7 Paper Floor (mode latihan, wajib sebelum live)
- **Kegunaan:** menjalankan agent atau manual trade dengan uang virtual di harga & quote nyata.
- **Cara kerja:** `PaperAdapter` mengisi order dengan **quote venue nyata saat itu** (mid ± setengah spread + fee) bila quote tersedia. Kalau tidak, pakai premi modeled dan beri label. Settlement memakai harga share saat expiry.
- **Output:** semua layar sama dengan live, tetapi ada banner tetap `PAPER · virtual USDG`, angka diberi suffix "(paper)", dan Tape berlabel.
- **Acceptance:**
  - [ ] Tidak mungkin salah membedakan paper vs live: warna banner Vermilion untuk live, Azure untuk paper [USULAN], plus teks.
  - [ ] Agent tidak bisa live tanpa durasi paper minimum (§16).

### 13.8 Optra Floor (Manual Mode, sekunder)
- **Kegunaan:** user trading call/put sendiri: "You on the floor."
- **Cara kerja:** pilih underlying → chain (strike × expiry) dari venue → Call/Put, Buy (Sell hanya covered/cash-secured kalau venue mendukung) → qty → preview (premi, max loss, break-even, payoff) → submit. Opsional **Attach hooks** (hanya tahap Pulse & Expiry, mis. Profira, Stopra, Trailo, Rolla, Lastra, Nextra, Settla), sehingga controller berubah jadi `You + Hook`.
- **Output:** order ticket, status order (`pending` untuk venue request-based: "Waiting for venue fill…"), posisi di Book dengan label controller, entri Tape khusus user (private) untuk aksi hook.
- **Acceptance:**
  - [ ] Floor ada di nav sebagai item terakhir sebelum Developers (bukan item pertama).
  - [ ] Exposa memberi peringatan manual (§14).
  - [ ] Hook yang ditempel hanya bisa dari tahap Pulse/Expiry.

### 13.9 The Listing (papan strategi + fee share)
- **Kegunaan:** creator mempublikasikan strategi dengan track record terkunci. User lain bisa follow, dan creator mendapat bagian fee.
- **Syarat listing [USULAN, semua angka bisa diubah]:**
  1. Agent publik, recipe terkunci (hash).
  2. Backtest 30 hari sudah dijalankan untuk versi yang sama.
  3. Paper berjalan ≥ 14 hari dan ≥ 3 trade.
  4. Tidak ada pelanggaran breaker `Drawra` selama paper.
  5. Creator menerima ToS Listing (bukan saran investasi; follower menjalankan sendiri).
- **Cara kerja follow:** Follow = **menyalin recipe** menjadi agent `kind=follow` di wallet follower sendiri, dengan modal sendiri. Tidak ada pooled fund dan creator tidak pernah menyentuh dana follower. Follower live tetap harus lolos gate §16.
- **Fee share:** setiap order live follower yang berasal dari recipe listing dikenai fee eksekusi Optra [PLACEHOLDER 0,10% notional/premi]. Bagian creator [PLACEHOLDER 20% dari fee Optra] masuk `fee_ledger` dan dibayar periodik dalam USDG. Paper follow gratis dan tidak ada fee.
- **Output:**
  - Papan `/listing`: kolom nama, creator, structure, underlying, return paper/live, **vs holding**, max DD, hari berjalan, followers (paper/live dipisah), badge `by Optra` vs `Community`.
  - Halaman listing: recipe lengkap, Tape, stats, tombol Follow (paper) / Follow live.
  - Dashboard creator: earnings accrued/paid.
- **Acceptance:**
  - [ ] House Agents tidak dihitung sebagai "community listings" di stats mana pun.
  - [ ] Sorting default bukan "best return 30d" saja. Default = "longest track record" [USULAN] untuk mengurangi cherry-pick.
  - [ ] Delisting tidak menghapus riwayat.

### 13.10 Sessions (Opening Bell / Closing Bell)
- **Kegunaan:** rasa bursa sekaligus fungsi nyata: membatasi eksekusi ke jendela likuid dan menghindari jam sepi.
- **Definisi sesi [USULAN, jam US Eastern; WITA dihitung otomatis, sadar DST]:**

| Sesi | ET | WITA (saat EST, Nov–Mar) |
|---|---|---|
| Opening Bell | 09:30–10:30 | 22:30–23:30 |
| Regular | 09:30–16:00 | 22:30–05:00 (+1) |
| Closing Bell | 15:00–16:00 | 04:00–05:00 (+1) |
| Extended | 04:00–09:30 & 16:00–20:00 | 17:00–22:30 & 05:00–09:00 |
| Overnight | 20:00–04:00 | 09:00–17:00 |
| Weekend | Jumat 20:00 – Minggu 20:00 | Sabtu 09:00 – Senin 09:00 |

  Catatan: stock token RH bisa diperdagangkan di luar jam bursa (tergantung docs RH), sedangkan venue options punya jamnya sendiri [VERIFIKASI DEV]. Hari libur US mengikuti kalender publik.
- **Cara kerja:** Sessia (hook) + event tick saat sesi dibuka. Di L1, OptraGuardHook menegakkan jadwal untuk swap entry di pool Optra.
- **Output:** chip sesi di header app (`● Opening Bell · 22:30 WITA`), animasi "bell" singkat saat sesi dibuka (hormati `prefers-reduced-motion`), event `session.opened`, entri Tape `Session: Opening Bell opened`.
- **Acceptance:** jam sesi benar saat pergantian DST (uji tanggal 8 Mar & 1 Nov). Tidak memakai kata "NYSE" di UI.

### 13.11 Optra Book (portofolio gabungan)
- **Kegunaan:** satu sumber kebenaran untuk semua posisi manual + agent.
- **Cara kerja:** query `positions` user. Grup per underlying, lalu per controller.
- **Output:** tabel kolom Controller (`You` / `You + Hook` / `Agent: Covered Call NVDA`), Underlying, Legs, Qty, Entry, Mark, PnL, DTE, Status, Mode. Header berisi total equity, PnL hari ini, eksposur per underlying (bar Exposa) dan tombol filter per controller.
- **Acceptance:**
  - [ ] Setiap posisi punya tepat satu label controller.
  - [ ] Total book = jumlah manual + agent (cek rekonsiliasi dengan venue tiap jam; selisih → alert).

### 13.12 Risk Desk (eksposur & Greeks bahasa awam + guard global)
- **Kegunaan:** membuat risiko bisa dipahami awam, sekaligus menjadi tempat tombol darurat.
- **Cara kerja:** Greeks dihitung Optra per posisi lalu diagregasi per underlying dan book. Skenario ±1%, ±5%, ±10% harga dan ±10 vol pts.
- **Output:**
  - Kalimat: `If NVDA moves +1%, your book changes about +$4.20.` · `Each day that passes, time decay changes your book by about +$0.85.` · `If NVDA drops 10%, your worst case is about −$62.`
  - Bar eksposur per underlying vs cap Exposa.
  - **Global guards** (user-level, berlaku untuk semua agent + manual):
    - `globalMaxUnderlyingPct` [USULAN 40%]
    - `globalDailyLossPct` [USULAN 5%] → semua agent `paused`
    - `maxLiveAgents` (beta 1)
  - Tombol **Pause all agents** (seketika: entry diblokir; exit hook tetap berjalan, kecuali user memilih "also stop exits") dan **Revoke Optra** (§9).
- **Acceptance:**
  - [ ] Pause all berlaku ≤ 60 detik.
  - [ ] Kalimat skenario sesuai perhitungan dengan selisih ≤ 1% pada uji unit.

### 13.13 Optra Verify
- **Kegunaan:** semua klaim bisa dicek ("trust lewat bukti"). Pola Zolva dengan lubang Zolva ditutup.
- **Output (halaman `/verify`):**
  1. **Claims table:** setiap klaim landing → status `Live` / `Paper` / `Planned` / `Not built`, dengan link bukti dan tanggal terakhir dicek.
  2. **Contracts & wallets:** OptraGuardHook, GuardRegistry, pool v4 Optra, executor/session key, fee recipient, x402 payTo, relayer, deployer, **dev wallet**, multisig. Semua dengan link explorer. Kalimat: `If an address is not on this page, it is not Optra's.`
  3. **Venues:** status verifikasi V1–V12 per venue, plus disclaimer bahwa venue adalah pihak ketiga.
  4. **Uniswap v4 claim level** aktif (L0/L1/L2) + alamat hook.
  5. **Data sources:** sumber harga, multiplier, IV, kalender.
  6. **Stats jujur:** decisions, agents (`by Optra` vs `community` dipisah), paper vs live volume, x402 calls (`internal tests` dipisah).
  7. **Audit status** + repo open source.
- **Acceptance:** tidak ada angka di landing yang tidak punya baris di Verify.

---

## 14. Dual mode: aturan konflik

| # | Aturan | Implementasi | Output |
|---|---|---|---|
| D1 | **Agent tidak boleh menutup, roll, atau mengubah posisi manual** (`you`, `you_hook`) | Execution Layer menolak intent agent untuk `position.controller ≠ agent` (error `NOT_CONTROLLER`) | Tape: `Skipped: position is controlled by you` |
| D2 | Hook yang ditempel ke posisi manual hanya mengelola posisi itu | `attached_hooks` di posisi, dievaluasi di tick | Tape private user |
| D3 | **Eksposur dihitung gabungan** (manual + semua agent) per underlying | Exposa membaca seluruh Book | Bar Exposa di Book & Risk Desk |
| D4 | Agent diblokir bila cap gabungan terlampaui | Exposa `block` | `Exposa ✗ NVDA 27% > 25% (incl. your manual positions)` |
| D5 | Manual: 80–100% cap → peringatan + konfirmasi; > global cap Risk Desk → diblokir | Pre-trade check di Floor | Modal: `This trade puts NVDA at 31% of your book (cap 40%). Continue?` |
| D6 | Covered tokens tidak bisa dipakai dua kali | `collateral.tokensCovered` dikunci logis per agent/posisi | Forge/Floor: `Only 1.0 NVDA uncovered available` |
| D7 | User boleh **mengambil alih** posisi agent | Tombol `Take over` → controller `you` (agent berhenti mengelolanya) | Tape: `Position handed to you by user` |
| D8 | Pause all agents tidak mempengaruhi posisi manual | — | — |

Acceptance: uji integrasi untuk D1, D4, D6, D7 wajib hijau sebelum P3.

---

## 15. Developer layer (sama seperti Zolva): Public API · MCP · x402

Copy: **"Run by agents. Open to every agent."** (versi agent-first dari "Built for humans. Open to agents.", lihat §17).

### 15.1 Public API v1 (gratis, tanpa key, CORS terbuka)
Base: `https://<domain>/api/public/v1` · rate limit **60 req/menit/IP** [USULAN, pola Zolva] · JSON · waktu dalam ISO-8601 UTC.

| Method | Path | Isi |
|---|---|---|
| GET | `/agents` | Agent publik (filter `kind=house|custom`, `underlying`, `mode`) |
| GET | `/agents/{id}` | Detail + stats + recipe (public) |
| GET | `/agents/{id}/tape` | Decision agent (paginate `cursor`) |
| GET | `/tape` | Keputusan publik terbaru |
| GET | `/hooks` · `/hooks/{name}` | Katalog 36 hook + status live |
| GET | `/markets` · `/markets/{symbol}` | Underlying, harga, multiplier, venue |
| GET | `/markets/{symbol}/chain` | Snapshot chain options (dari venue, delay [USULAN] 1 jam untuk publik) |
| GET | `/listing` · `/listing/{id}` | Isi The Listing |
| GET | `/sessions` | Sesi sekarang + jadwal |
| GET | `/stats` | Statistik jujur (lihat Verify) |
| GET | `/verify` | Claims, contracts, v4 claim level |

Contoh:
```http
GET /api/public/v1/agents?kind=house&underlying=NVDA
```
```json
{
  "data": [{
    "id": "c0f1…",
    "name": "Covered Call NVDA",
    "kind": "house",
    "by": "optra",
    "mode": "paper",
    "venue": "callput",
    "structure": "covered_call",
    "recipeHash": "0x9ab3…",
    "stats": {"returnPct": 1.2, "vsHoldingPct": -0.8, "maxDrawdownPct": 4.4, "days": 21, "decisions": 504},
    "nextAction": "Waiting for IV rank > 50",
    "updatedAt": "2026-11-10T22:05:00Z"
  }],
  "nextCursor": null
}
```
```http
GET /api/public/v1/hooks/volra
```
```json
{
  "name": "volra", "stage": "gate", "location": "offchain",
  "summary": "Open only when implied volatility is above or below a threshold.",
  "params": [
    {"key":"metric","type":"enum","values":["ivRank","ivAbs"],"default":"ivRank"},
    {"key":"op","type":"enum","values":["above","below"],"default":"above"},
    {"key":"threshold","type":"number","default":50,"min":0,"max":100}
  ],
  "activeNow": {"markets": ["NVDA","TSLA","COIN"], "asOf": "2026-11-10T22:00:00Z"}
}
```
Error format: `{"error":{"code":"NOT_FOUND","message":"Agent not found"}}`.

### 15.2 MCP server
- Endpoint `https://<domain>/mcp`, transport Streamable HTTP. Daftarkan ke MCP Registry resmi (pola Zolva) **setelah** tools stabil.
- v1 read + simulasi. **Tidak ada tool live order di v1.** Paper agent via MCP = fase 1.5 (butuh OAuth/akun), mengikuti pola Heurix yang mengizinkan AI eksternal mengirim order paper.

| Tool | Input | Output | Auth |
|---|---|---|---|
| `list_agents` | filter | ringkasan agent | — |
| `get_agent` | id | detail + stats | — |
| `get_tape` | agentId?, limit | decisions | — |
| `list_hooks` / `get_hook` | name? | spesifikasi hook | — |
| `list_markets` / `get_market` | symbol? | harga, multiplier | — |
| `get_option_chain` | symbol | chain snapshot (delayed) | — |
| `list_listing` | sort | listing | — |
| `get_session` | — | sesi sekarang | — |
| `compose_recipe` | prompt | recipe draft (validated) | kuota per IP / x402 |
| `run_backtest` | recipe, underlying, days | hasil §13.6 | x402 atau kuota gratis kecil |
| `create_paper_agent` (fase 1.5) | recipe, capital | agentId | OAuth akun Optra |

### 15.3 Paid API via x402 (USDG di RH Chain)
- Bayar per call, tanpa akun atau API key. Pembayaran memakai **EIP-3009 `transferWithAuthorization`** pada USDG (pola Zolva; alamat USDG RH per docs Zolva `0x5fc5360d0400a0fd4f2af552add042d716f1d168`, [VERIFIKASI DEV] ke docs resmi).
- **Facilitator dibangun sendiri** (facilitator besar belum mendukung RH Chain per riset 11 Nov, [VERIFIKASI DEV] ulang). Ia memverifikasi signature, mensubmit lewat relayer (wallet dengan policy hanya USDG → payTo), lalu mengembalikan receipt. Ikuti spesifikasi x402 versi terbaru untuk nama header & skema [VERIFIKASI DEV].
- Index `GET /api/x402/v1` berisi daftar endpoint, harga, dan `open: true|false`.

| Endpoint | Fungsi | Harga |
|---|---|---|
| `GET /api/x402/v1/signals?symbol=NVDA` | Status semua Gate/Breaker hook di satu market sekarang | **[PLACEHOLDER] 0.01 USDG** |
| `GET /api/x402/v1/scan` | Status hook di semua market (mis. "Volra active on NVDA") | **[PLACEHOLDER] 0.02 USDG** |
| `POST /api/x402/v1/backtest` | Backtest recipe 30 hari | **[PLACEHOLDER] 0.03 USDG** |
| `POST /api/x402/v1/strike-sim` | Simulasi strike/expiry: premi, Greeks, break-even, payoff | **[PLACEHOLDER] 0.01 USDG** |
| `POST /api/x402/v1/compose` | Prompt → recipe tervalidasi | **[PLACEHOLDER] 0.02 USDG** |
| `GET /api/x402/v1/chain/live?symbol=` | Chain options real-time (tanpa delay) | **[PLACEHOLDER] 0.005 USDG** |

Contoh respons tanpa pembayaran (HTTP 402):
```json
{
  "x402Version": 1,
  "error": "Payment required",
  "accepts": [{
    "scheme": "exact",
    "network": "robinhood-chain-4663",
    "asset": "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
    "maxAmountRequired": "30000",
    "payTo": "0x<OPTRA_PAYTO — publish in Verify>",
    "resource": "https://<domain>/api/x402/v1/backtest",
    "description": "Optra 30-day hook backtest",
    "maxTimeoutSeconds": 60
  }]
}
```
(`maxAmountRequired` dalam unit terkecil USDG. Desimal USDG [VERIFIKASI DEV]. Nilai di atas mengasumsikan 6 desimal = 0.03.)

Contoh respons setelah bayar (200):
```json
{
  "runId": "bt_01J…",
  "premiumSource": "modeled",
  "result": {"returnPct": 1.8, "vsHoldingPct": -2.4, "maxDrawdownPct": 6.1, "trades": 4},
  "payment": {"txHash": "0x…", "amount": "0.03", "asset": "USDG"}
}
```
**Aturan kejujuran:** setiap pembayaran dari wallet tim ditandai `is_internal_test = true`. Stats publik memisahkan `paid calls (external)` dan `internal tests`. Copy X tidak boleh menyebut jumlah call tanpa pemisahan ini.

### 15.4 Open-source posture
- Usulan: repo publik dengan lisensi **MIT** untuk rule engine (36 hook), adapter interface, kontrak `OptraGuardHook` + `GuardRegistry`, dan public API. **Nama & logo Optra dikecualikan** dari lisensi (pola Zolva). [KEPUTUSAN TERBUKA: full repo vs sebagian.]
- Jangan commit secret, hostname privat, atau dokumen internal ke repo publik (Zolva bocor lewat git history). Pakai `.gitignore` + secret scanning di CI.

### 15.5 Acceptance
- [ ] Semua endpoint publik mengembalikan schema yang terdokumentasi di `/docs/public-api`.
- [ ] `tools/list` MCP merespons. Setiap tool punya contoh di docs.
- [ ] Panggilan x402 tanpa bayar → 402. Setelah bayar → 200 + receipt. Replay authorization yang sama ditolak.
- [ ] Stats memisahkan internal tests.

---

## 16. Real-money gating & caps

Semua angka **[USULAN]**, berpola Zolva, dan wajib disetujui Caesar.

### 16.1 Gate (semua harus lolos)
| Gate | Isi |
|---|---|
| G1 Venue verified | Checklist V1–V12 lengkap + tanda tangan Caesar |
| G2 Custody ready | Session key/signer terpasang dengan policy benar, diverifikasi backend + onchain |
| G3 Global kill switch | `live_settings.enabled` default **false**, dinyalakan manual oleh Caesar |
| G4 Allowlist wallet | Masuk otomatis setelah G2 terverifikasi |
| G5 Geo | Blokir US + negara tersanksi; daftar tambahan (pola Zolva: GB/CA/CH/AE untuk live) ditetapkan counsel. **Bukan legal opinion** |
| G6 Paper history | Agent sudah paper ≥ 7 hari dan ≥ 1 siklus expiry |
| G7 Acknowledgment | User mencentang risiko: options bisa kehilangan 100% premi, covered call memotong upside, opsi sintetis bukan saham |

### 16.2 Cap beta
| Cap | Nilai usulan |
|---|---|
| Modal per agent live | **$100** |
| Premi/notional baru per user per hari | **$300** |
| Agent live per user | **1** |
| Premi maksimal per posisi (beli) | $25 |
| Posisi terbuka per agent live | 3 |
| Short options | Hanya covered/cash-secured, **tidak pernah naked** |
| Slippage maks | 1% (ditegakkan di policy/session key bila memungkinkan, bukan hanya backend) |
| Deviasi quote vs model | 25% (Venux) |

### 16.3 Output
- Layar "Enable live" berisi checklist G1–G7 dengan status per baris. Tombol aktif hanya kalau semuanya hijau.
- Kalau G3 off: `Live trading is not open yet. Your agent keeps running on paper.`
- Kalau cap tercapai: `Daily live limit reached ($300). New entries resume at 08:00 WITA.`

---

## 17. Branding & copywriting kit (AGENT-HEAVY, dikunci)

> Arahan Caesar (11 Nov): branding **berat ke AI agent / otomatis**, bukan ke manual option trade. Manual tetap ada sebagai mode kedua dan tetap menjadi pembeda (dual mode), tapi tidak memimpin. FE/marketing memperlakukan copy di bawah sebagai **spec**.

### 17.1 Brand basics
| Item | Lock |
|---|---|
| Nama | **Optra Agent** · short **Optra** |
| Kategori (eyebrow) | **AI options agents · Robinhood Chain** |
| Janji inti (harus bisa dibuktikan produk) | Every agent decision is backtested, run on paper first, and explained on the Tape. |
| Tone | Tenang, faktual, percaya diri ala lantai bursa. Kalimat pendek dan angka yang bisa dicek. Tidak ada hype, tidak ada janji cuan |
| Nama hook | Kata karangan pendek dua suku kata (Volra, Deltra, Profira…), ditulis Capitalized di UI |
| Bahasa | English untuk produk. Lokalisasi Bahasa Indonesia = peluang fase 2 (celah Zolva) |
| Kata kunci yang diulang | agents · hooks · strike · on the Tape · paper first · Uniswap v4 (sesuai level klaim) |

### 17.2 Tagline (agent-first)
| Peran | Copy |
|---|---|
| **Primary tagline / H1** | **Let agents trade the strike.** |
| Alternatif H1 | `Options agents for tokenized stocks.` · `The options floor that runs itself.` |
| Signature line (di bawah logo, footer, OG) | `Hooked agents. Every strike explained.` |
| Secondary (dual mode) | `Two modes. One book.` |
| Honesty line (AI) | `Rules decide. AI writes them with you, and can veto.` |
| Developer line | `Run by agents. Open to every agent.` |
| Short punchy (X/ads) | `Every call. Every put. Hooked.` · `Agents on the floor.` |
| **Dipensiunkan dari hero** | `Trade the strike. Or let it trade itself.` (terlalu manual-first). Boleh dipakai hanya di section Dual Mode |

### 17.3 Hero (canonical)
- **Eyebrow:** `AI options agents · Robinhood Chain`
- **H1:** `Let agents trade the strike.`
- **Subhead (L1 aktif):** `House and custom agents trade calls and puts on Robinhood Chain stocks, with breakers and sessions built as Uniswap v4 hooks. Backtest 30 days, run on paper, read every decision on the Tape.`
- **Subhead (L0, hook v4 belum live):** `House and custom agents trade calls and puts on Robinhood Chain stocks, with 36 hooks inspired by Uniswap v4. Backtest 30 days, run on paper, read every decision on the Tape.`
- **Primary CTA:** `Launch an agent` → `/forge?template=covered-call`
- **Secondary CTA:** `Watch the Tape` → `/tape`
- **Text link (manual, kecil):** `Prefer the controls? Trade manually →` → `/floor`
- **Micro-line wajib di bawah CTA:** `Paper first. Synthetic options on stock prices, settled in USDG. Not shares. Not advice.`
- **Visual hero:** kartu agent (Covered Call NVDA) + ticker Tape yang bergulir dengan label `PAPER`, bukan chart order manual.

### 17.4 Copy per section landing
| # | Section | Headline | Body (maks 2 kalimat) |
|---|---|---|---|
| 1 | Ticker bar | — | Baris Tape publik bergulir: `22:35 WITA · Covered Call NVDA · OPEN sell 152C · Volra ✓ · PAPER` |
| 2 | Hero | §17.3 | §17.3 |
| 3 | House Agents | `Agents ready on day one.` | `Covered Call, Cash-Secured Put, Protective Put and Earnings Straddle, built by Optra and running in public on paper.` |
| 4 | Forge / Custom Agents | `Say it. Hook it. Run it.` | `Describe a strategy in plain words, or click it together. AI turns it into hooks you can read and edit.` |
| 5 | Hooks | `36 hooks. Six stages. One agent.` | `Gate, Strike, Size, Pulse, Expiry and Breaker, snapped together like building blocks.` + badge `Breakers & Sessions on Uniswap v4` (L1 only) |
| 6 | How it works | `From idea to running agent.` | 4 langkah: `Hook it` → `Backtest 30 days` → `Run on paper` → `Go live, capped` (langkah 4 berlabel `Soon` sampai live) |
| 7 | Tape | `Every decision, on the tape.` | `Each hour your agent writes what it did and why: which hook fired, on what data.` |
| 8 | Lab | `Always next to just holding.` | `Backtests show losses too, and every agent is compared with simply holding the stock.` |
| 9 | The Listing | `List your agent. Earn when others follow.` | `Strategies with a locked track record can be followed. Creators earn a share of execution fees.` (label `Planned` sampai live) |
| 10 | Sessions | `Ring the bell.` | `Agents can trade only at the Opening Bell, the Closing Bell, or any session you choose.` |
| 11 | Dual mode | `Two modes. One book.` | `Optra on the floor, or you on the floor. Trade calls and puts yourself and hand exits to hooks; agents never touch your manual positions.` |
| 12 | Developers | `Run by agents. Open to every agent.` | `Public API, an MCP server, and pay-per-call x402 endpoints in USDG on Robinhood Chain.` |
| 13 | Verify | `Built, not promised.` | `Every claim has a status and a link: Live, Paper, or Planned.` |
| 14 | FAQ | `Before you launch.` | Termasuk: Is this real money? · What are synthetic options? · What does the AI actually do? · Which hooks run on Uniswap v4? · Can an agent close my trades? |
| 15 | Final CTA | `Your first agent runs on paper.` | `Build it, backtest it, and launch it in minutes. No deposit.` → `Launch an agent` |
| 16 | Footer | — | §20.3 |

**Aturan rasio:** minimal 10 dari 13 section konten membahas agent/otomasi. Manual hanya muncul di section 11, di text link hero, dan sebagai item nav `Floor`.

### 17.5 In-app microcopy
| Lokasi | Copy |
|---|---|
| Nav | `Agents` · `Forge` · `Hooks` · `Listing` · `Tape` · `Lab` · `Floor` · `Developers` · `Verify` |
| Default route setelah login | `/agents` (bukan `/floor`) |
| Empty Agents | `No agents yet. Start from a House Agent or describe your own.` → `Launch an agent` |
| Forge prompt placeholder | `e.g. Sell a weekly NVDA covered call when IV is high, skip earnings, take profit at 50%.` |
| Validator error | `Strike stage needs an expiry. Add Tenora.` |
| Naked short ditolak | `Optra only writes covered calls or cash-secured puts.` |
| Launch button (tanpa backtest) | `Backtest first` (disabled) → `Launch on paper` |
| Paper banner | `PAPER · virtual USDG · nothing here is real money` |
| Live banner | `LIVE · capped at $100 per agent` |
| Controller labels | `You` · `You + Hook` · `Agent` |
| Agent tidak boleh sentuh manual | `Agents never close or change positions you opened.` |
| Breaker trip | `Haltr paused new entries on TSLA for 6h after a −8.2% move. Exits keep running.` |
| AI veto | `AI reviewer vetoed this entry: "Earnings date moved to tomorrow." Rules stay in charge.` |
| Venue pending | `Waiting for venue fill… (request-based venue)` |
| v4 badge tooltip (L1) | `This hook is enforced by an Uniswap v4 hook contract on Optra's pools. See address in Verify.` |
| v4 tooltip (L0) | `Inspired by Uniswap v4 hooks. Runs in Optra's rule engine today.` |
| Synthetic tooltip | `Synthetic option: pays out in USDG based on the stock price. You don't own shares or stock tokens through it.` |

### 17.6 X profile
- **Display name:** `Optra Agent`
- **Bio (≤160):** `AI options agents on Robinhood Chain. House + custom agents, hooks on Uniswap v4, every decision on the Tape. Paper first. API · MCP · x402`
- **Bio L0 (sebelum hook live):** `AI options agents on Robinhood Chain. 36 hooks, every decision on the Tape. Paper first. API · MCP · x402`
- **Banner:** Midnight Ink, wordmark + baris `Let agents trade the strike.` + ticker Tape tipis Azure/Vermilion.
- **Aturan X (dari pelajaran Zolva):** selalu sebut "paper" selama paper; angka selalu dari DB live dengan tanggal; tidak tag/meng-imply partnership Robinhood, Uniswap, NYSE, atau venue; "on Robinhood Chain" boleh; tes internal tidak pernah disebut sebagai adopsi; tidak ada "live today" sebelum live.

### 17.7 Branding voice checklist (sebelum merge copy)
- [ ] Viewport pertama menyebut **agents**, **options (call & put)**, dan **Robinhood Chain**
- [ ] Hook + Uniswap v4 disebut sesuai level klaim aktif
- [ ] House + Custom agents terlihat sebelum manual
- [ ] Ada "paper" di fold pertama selama belum live
- [ ] Ada kalimat synthetic/not shares
- [ ] Tidak ada nama/logo NYSE, tidak ada kata "official", "partner", "powered by Robinhood"
- [ ] Tidak ada janji profit, "passive income guaranteed", atau prediksi harga
- [ ] Manual hanya sebagai mode kedua

---

## 18. UI & design tokens

### 18.1 Palet (arahan Caesar; hex = **usulan untuk desainer**, final di desain)
| Token | Hex usulan | Porsi | Peran |
|---|---|---|---|
| `--ink-900` Midnight Ink (bg) | `#0B1220` (alt lebih gelap `#070B14`) | **50%** | Background, warna dominan |
| `--ink-800` surface/card | `#111A2E` | (bagian Ink) | Card, panel, nav |
| `--ink-700` border | `#1C2742` [USULAN] | (bagian Ink) | Hairline |
| `--azure-500` Azure Blue | `#1E8FFF` | **35%** | Teks penting, CTA utama, link, data highlight, **Call**, badge Paper |
| `--azure-400` hover | `#4AA8FF` | | |
| `--vermilion-500` Vermilion Orange | `#E8492A` | **15%** | Aksen tegas, CTA sekunder, alert, bell/sesi, **Put**, badge Live |
| `--vermilion-400` hover | `#FF6A47` | | |
| `--text-100` | `#E6EDF7` | | Body |
| `--text-400` | `#8A9BB5` | | Sekunder |
| `--gain` / `--loss` | `#2BD47D` / `#FF5D73` [USULAN] | | PnL saja. Selalu dengan tanda +/−. Dibuat beda jelas dari Vermilion supaya "Put" ≠ "rugi". **Keputusan desainer** |

Aturan porsi:
- Ink mendominasi layar.
- Azure untuk semua yang "agent/aksi utama".
- Vermilion dipakai hemat: alert, live, bell, put. Maksimal satu elemen Vermilion dominan per viewport [USULAN].
- Kontras: Azure dan Vermilion di atas `#0B1220` diperkirakan lolos WCAG AA untuk teks normal. **Desainer wajib cek** dengan tool kontras.

### 18.2 Tipografi & elemen
- Font sans + mono yang bebas komersial (usulan: **IBM Plex Sans + IBM Plex Mono**, atau Inter + JetBrains Mono; pilih yang **bukan** Inter-only supaya beda dari Zolva). Angka harga/Tape selalu mono, ala ticker.
- Radius 4/8/12 dengan tombol bersudut lembut (bukan pill), supaya beda dari gaya Aave/Zolva.
- Motion: micro 150 ms; animasi "bell" ≤ 600 ms; Tape bergulir halus; wajib mendukung `prefers-reduced-motion`.
- Logo: huruf **"O"** dengan nuansa lonceng atau kait hook. Tanpa elemen visual NYSE (fasad gedung, bendera, logo).
- Ikon status: `●` sesi aktif, `⛔` breaker, `✓/✗` hook.

### 18.3 Komponen kunci
AgentCard · HookChip (stage color + location badge) · RecipeColumn (6 stage) · TapeRow (ringkas/expand) · PaperLiveBanner · ControllerBadge · ExposaBar · SessionChip · PayoffChart · VsHoldingChart (3 garis) · VerifyClaimRow.

---

## 19. Struktur landing & 15 detik pertama

### 19.1 Urutan pesan above-the-fold (HARD REQUIREMENT)
| Detik | Elemen | Pesan yang harus kebaca |
|---|---|---|
| 0–3 | Logo + eyebrow + ticker Tape | Optra Agent · **AI options agents on Robinhood Chain** (stock-token names) |
| 3–6 | H1 | **Let agents trade the strike.** (call & put) |
| 6–9 | Subhead | Hooks on **Uniswap v4** (L1) / inspired by (L0) |
| 9–12 | Kartu agent + CTA | **House + Custom agents**, `Launch an agent` |
| 12–15 | Proof strip | `Backtest 30 days · Paper first · Verify` + chip `Manual mode too` + `API · MCP · x402` |

**Uji QA (5 orang baru, screenshot 15 detik):** mereka harus bisa menjawab *"Ini agent AI yang trading options call/put untuk saham di Robinhood Chain, aturannya pakai hook (Uniswap v4), ada agent buatan Optra dan bisa rakit sendiri, dibacktest dan paper dulu. Bisa manual juga, dan ada API."* Target lolos ≥ 4 dari 5 orang.

### 19.2 Urutan section
Ikuti §17.4 (1–16). Section Dual Mode berada **setelah** Tape, Lab, Listing, dan Sessions.

---

## 20. Red lines & compliance copy

### 20.1 Dilarang keras
1. Nama, logo, gedung, atau trade dress **NYSE**. Konsep bursa (bell, listing, breaker, tape) boleh, dengan framing "inspired by exchange structure".
2. Kesan partnership atau "official" dengan NYSE, Robinhood, Uniswap, CallPut, Zeno, Clutch, atau Panoptic. "On Robinhood Chain" dan "uses CallPut as an execution venue" (setelah live) boleh.
3. Mencampur **stock token vs opsi sintetis vs saham asli**.
4. Mengklaim live sebelum live. Hilangkan label "paper" selama masih paper.
5. Janji profit, "guaranteed income", "risk-free", atau prediksi harga.
6. Menyebut tes internal (x402, House Agents) sebagai adopsi/traksi.
7. Headline backtest terbaik yang dipilih-pilih (cherry-pick) (kesalahan Zolva).
8. Klaim "built on Uniswap v4" di luar level §8.4.
9. Menargetkan US persons di copy.
10. Menyembunyikan wallet tim di Verify.

### 20.2 Disclaimer wajib (tampil di app & docs)
- `Options can lose 100% of the premium paid. Writing covered calls caps your upside. Cash-secured puts can lose if the stock falls below the strike.`
- `Options on Optra are synthetic and settle in USDG against the stock price. They are not shares and not stock tokens, and carry no dividends or voting rights.`
- `Optra agents follow rules you or Optra set. Past or backtested results do not predict future results.`
- `Third-party venues execute the options. Optra does not control their pricing, liquidity, or settlement.`

### 20.3 Footer
`Optra Agent · AI options agents on Robinhood Chain. Paper trading unless marked Live. Nothing here is investment advice. Not affiliated with or endorsed by NYSE, Robinhood, Uniswap Labs, or any venue listed. Not available to US persons.`

---

## 21. Milestones & fase

| Fase | Isi | Output / DoD |
|---|---|---|
| **P0 Spike & lock** [USULAN 1–2 minggu] | Approve brief; venue checklist V1–V12 (minimal read-side); spike v4 pool + hook feasibility (§8.3); semantik `currentMultiplier`; sumber earnings; spike custody C2; Visual Concept | ADR venue, ADR v4 (L1 go/no-go), ADR custody, palet final |
| **P1 Agent core (paper)** | Data layer + recording quote; Rule Engine 36 hook; Lab; Forge (klik + prompt); 4 House Agents paper publik; Tape; Verify; Public API read; landing (L0 copy) | Agent paper berjalan per jam dengan Tape lengkap; parity test hijau |
| **P2 Ecosystem** | Custom agents publik; The Listing (paper follow); MCP; x402 + facilitator; Sessions + bell | MCP di registry; x402 402→200; stats pisah internal |
| **P3 Manual & Book** | Optra Floor (paper), attach hooks, Optra Book, Risk Desk, aturan konflik §14 | Uji D1–D8 hijau |
| **P4 Guarded live (Jalur A)** | Gate G1–G7, cap, custody; OptraGuardHook testnet → audit → mainnet (L1); fee share live | Live beta dengan cap, label `Unaudited beta` bila audit belum selesai, Verify update |
| **P5 Jalur B (riset)** | Vault/market options sebagai v4 hooks (referensi STORMM/SOLO, Panoptic); pricing, LP/market maker, risk, audit | Dokumen desain + prototipe testnet. **Bukan** komitmen launch |

Prioritas sengaja agent-first: Floor manual baru di P3.

---

## 22. QA / acceptance checklist (gabungan)

**Engine & hooks**
- [ ] 36 hook terimplementasi dengan default & range §7, masing-masing dengan unit test (pass/block/edge/data missing).
- [ ] Validator §7.2: 30 recipe uji (valid/invalid) sesuai harapan.
- [ ] Parity live/paper/backtest.
- [ ] Urutan evaluasi §7.3. Exit tidak pernah diblokir.
- [ ] Multiplier change → Corpax pause + event.
- [ ] DST & jadwal sesi benar.

**Fitur**
- [ ] Acceptance setiap sub-bab §13 hijau.
- [ ] Konflik dual mode §14 hijau.
- [ ] Gate & cap §16 ditegakkan (uji melewati cap → ditolak).

**Onchain (P4)**
- [ ] Foundry tests OptraGuardHook: halt blokir entry, izinkan reduce; sessions; CA pause; fail-closed entry / fail-open exit.
- [ ] Fuzz `beforeSwap`; Slither; audit eksternal sebelum mainnet publik.
- [ ] Keeper role bisa dicabut multisig; runbook keeper mati.

**Developer layer**
- [ ] Schema API terdokumentasi; rate limit; MCP `tools/list`; x402 replay protection.

**Brand & copy**
- [ ] Uji 15 detik §19.1 lolos ≥ 4/5.
- [ ] Checklist §17.7 dan red lines §20 lolos review Caesar.
- [ ] Flag `V4_CLAIM_LEVEL` mengganti copy hero/tooltip/bio dengan benar.

**Trust**
- [ ] Verify lengkap (semua wallet, termasuk dev). Setiap angka landing punya baris di Verify.
- [ ] Repo publik tanpa secret (secret scan CI).

---

## 23. Keputusan terbuka (untuk Caesar / dev)

| # | Keputusan | Default di brief | Siapa |
|---|---|---|---|
| 1 | Adapter pertama: CallPut atau Zeno | Yang lolos V1–V12 duluan | Dev → Caesar |
| 2 | Jalur venue A vs B | **A di v1, B fase 2** (Caesar belum memilih secara eksplisit) | Caesar |
| 3 | L1 Uniswap v4 (pool Optra + likuiditas seed) go/no-go | Target L1, fallback L0 | Dev (P0) → Caesar |
| 4 | Custody C2 (session key) vs C1 (signer policy diperketat) | C2 | Dev (P0) → Caesar |
| 5 | Hex final palet | Usulan §18.1 | Desainer → Caesar |
| 6 | Fee eksekusi & fee share creator | Placeholder 0,10% / 20% | Caesar |
| 7 | Harga x402 | Placeholder §15.3 | Caesar |
| 8 | Syarat Listing (14 hari paper, 3 trade) | §13.9 | Caesar |
| 9 | Sumber kalender earnings | Open | Dev |
| 10 | Scope open source (full vs core) | Core MIT | Caesar |
| 11 | Daftar geo-block live | Pola Zolva + counsel | Caesar + counsel |
| 12 | Model AI & budget | Config, $5/hari beta | Dev |
| 13 | Domain & handle X | Open | Caesar |
| 14 | Token project | **Tidak ada di brief ini** | Caesar |
| 15 | Hubungan dengan Meridian Desk (brief ORC-20261106-01 masih pending approve) | Produk terpisah | Caesar |

---

## 24. Referensi

- Ringkasan konsep: `/workspace/briefs/optra-agent-summary.md`
- Deep dive Zolva (mekanik, API/MCP/x402, custody, branding, red flags): `/workspace/research/zolva-agent-deep-dive.md`
- Riset ATLAS options & NYSE (CallPut, Zeno, Clutch STORMM/SOLO, Panoptic, BELL, Rysk, Derive): `/workspace/briefs/atlas-refs/forge-options-agent-research-2026-11-11.md`
- Format brief: `/workspace/briefs/meridian-desk-dev-brief.md` (ORC-20261106-01)
- Docs eksternal (dicek dev): CallPut https://docs.callput.app/ · StonkBrokers/STORMM https://stonkbrokers.io/options · Panoptic https://panoptic.xyz/ · BELL https://www.bellstocks.tech/ · RH Stock Tokens https://docs.robinhood.com/chain/stock-tokens/ · Uniswap v4 hooks https://developers.uniswap.org/ · Zolva https://zolvaagent.app/docs
- Alamat pihak ketiga yang disebut (semuanya [VERIFIKASI DEV]): ZenoOptionsEngine `0xA58fc1027E05A9eE7c2b60d9A22EeD4aed3860b5`; USDG `0x5fc5360d0400a0fd4f2af552add042d716f1d168` (per docs Zolva); Uniswap v4 PoolManager `0x8366…0951` (dipotong di sumber).

---

## 25. Approval

| Role | Status |
|---|---|
| Caesar (owner) | Pending approve brief |
| FORGE | Draft 2026-11-11 |
| Dev lead | Review §5.2, §8.3, §9 (P0 spikes) |
| Desainer | Visual Concept + hex final pending |
