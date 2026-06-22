# AnamPouch — 5 min Demo Script

Sui Overflow 2026 · Walrus Track · testnet
App: https://anam-pouch.vercel.app · Local: localhost:5174

時間軸：**0:00–1:00 Pitch slide** → **1:00–4:00 Live demo** → **4:00–5:00 Future vision**

預載（demo 前先做好，別在台上等）：
- 病人帳號已登入、已建好 1 筆純文字 record + 1 筆圖片 record（新 package，Seal namespace 對得上）
- doctor viewer link / QR 已準備
- 兩個瀏覽器 window：病人端 + doctor 端，先排好版面
- `tasks/demo_slides.html` 開好（共 4 頁），與 app 切換用 alt-tab

---

## 投影片對照（`tasks/demo_slides.html` 共 4 頁）

| Slide | 內容 | 時段 | 講什麼 |
|---|---|---|---|
| **1** Title | AnamPouch logo | 0:00–0:10 | 開場 hook → PART 1 起頭兩句（data silos + AI vs privacy） |
| **2** Problem / Solution / Why-us | 三欄卡 | 0:10–1:00 | PART 1 主權宣言。左欄=痛點、中欄=解法、右欄=「You are in absolute control」 |
| **3** Two flows | 病人 + 醫生 flow | **1:00–4:00（整個 live demo 背景頁）** | 切 app 實機操作；slide 3 當「走到哪一步」的地圖，做哪個動作就指哪個 node（對照見 PART 2 各 Beat） |
| **4** Health memory agent | future 四點 | 4:00–5:00 | PART 3 future vision + 收尾 |

操作節奏：Slide 1 停 ~10s → 翻 Slide 2 講到 1:00 → 翻 **Slide 3** 講完開場句後切 app 實機 → 4:00 翻 **Slide 4** 純口述收尾。

---

## PART 1 — Pitch Slide (0:00–1:00)

> **Slide 1**（前兩句 hook）→ **Slide 2**（主權宣言）

**口白逐字稿（British English）：**

> "Your medical records are scattered across every clinic you've ever visited — and not one copy is yours to keep. Worse: the moment you want an AI to help read them, you have to hand your most private data to the cloud.
>
> **AnamPouch fixes that.** It's a health passport you own. Your records are encrypted right in your browser, stored on **Walrus**, and anchored on **Sui**. The cloud never sees them. The hospital doesn't own them. **You do.**"

Slide 上要有的 4 個字（視覺）：
- **Patient-owned** · **Client-side encrypted** · **Walrus storage** · **On-chain access control**

Stack 一行帶過（slide 角落，不唸）：Sui zkLogin · Seal · Walrus · Move 2024 · Enoki sponsored tx

---

## PART 2 — Live Demo (1:00–4:00)

> **背景頁 = Slide 3「Two flows」**。左欄(病人 flow)4 node ↔ Beat 1–2；右欄(醫生 flow, good 色)4 node ↔ Beat 3–4。做哪個動作就指對應 node。

> 開場一句（口白）："Everything you're about to see runs on live Sui testnet — this is not a mock-up."

### Beat 1 — 登入即主權 (1:00–1:25) ~25s
> Slide 3 node `1·LOGIN`
- 病人端點 **Sign in with Google**（zkLogin）
- 口白："I sign in with Google — but that's **zkLogin**. No seed phrase, no wallet extension, yet I get a real, self-owned Sui wallet. Zero friction."

### Beat 2 — 多模態擷取 + 瀏覽器加密上鏈 (1:25–2:25) ~60s ★核心
> Slide 3 node `2·AI`（上傳圖）→ `3·ENCRYPT`（Encrypt & Anchor）→ `4·ANCHOR`（Walrus + Timeline）
- 上傳/拍一張**藥袋或診斷書圖片**
- 口白："An AI reads this medicine-bag photo into a structured record. **But here's the key part — nothing is ever stored in the clear.**"
- 點 **Encrypt & Anchor**，邊跑邊講：
  - "It's encrypted right here in the browser — the key comes from my own wallet, so no one else can unlock it."
  - "The encrypted file goes to **Walrus** storage..."
  - "...and its fingerprint is anchored on **Sui** — tamper-proof."
- 切到 **Verifiable Timeline**：指 record 上的 **Sui 交易 hash 徽章**
- 口白："Every record carries its own Sui transaction hash — provable, tamper-proof."
- （可選）點 **Decrypt image**：當場把加密圖片解回來顯示
- 口白（可選）："And it's fully reversible — one tap and it decrypts straight back."

### Beat 3 — 授權醫生：無錢包、無 gas (2:25–3:25) ~60s ★殺手鐧
> Slide 3 右欄 node `1·SCAN` → `2·VERIFY` → `3·RELEASE`
- 病人端 **Share** → 發一張**有時效**的 `access_grant` → 產生 QR / link
- 口白："To share, I issue a **time-limited grant** on-chain, and the key is locked to this doctor using **Seal**."
- 切到 **doctor 端 window**，開 QR link
- 口白（重點打慢）："Now the doctor's side — **no wallet, no app, no gas.** **Enoki** pays the gas for them. They scan the code and instantly see the record. Zero friction."

### Beat 4 — 一鍵撤銷，鏈上即時生效 (3:25–4:00) ~35s ★信任閉環
> Slide 3 右欄 node `4·REVOKE`
- 病人端點 **Revoke**
- 口白："I tap Revoke — and on-chain, the doctor's access is cut."
- 回 doctor 端 reload → **存取失敗**
- 口白（收尾）："And this isn't the app just hiding a button. **The key server checks the chain and refuses to release the key** — the chain is the enforcer, not us. And the grant is never deleted, so there's a **permanent audit trail.**"

> Demo 安全網：若某台 Seal key server 503，threshold=2 另一台還在仍可解；若 zkLogin link 失效就重生一條新 link（舊 link 與授權檢查無關）。

---

## PART 3 — Future Vision (4:00–5:00)

> **Slide 4「Health memory agent」**。口述（British English）：

> "What you've seen is a **working health passport you own.** Here's where we take it next:
>
> 1. **A private AI health assistant** — 'Will this new drug clash with what I'm already on?' — answered over your own records, on your device.
> 2. **Insights over time** — medication reminders and health trends across clinics.
> 3. **One portable record** you carry into any clinic, in any country — that only you control.
>
> Medical data shouldn't live in a hospital's database. **It should belong to the patient.**
> AnamPouch — carry it in your pocket."

收尾一句（口白）："Patient-owned. Encrypted in the browser. Verifiable on Sui. Stored on Walrus. Thank you."

---

## 評審可能追問 — 預備答案
- **「跟一般雲端 EHR 差在哪？」** 明文永不離開裝置；雲端/我們都看不到資料；存取控制在鏈上 Seal 層強制，非前端。
- **「醫生不用錢包怎麼安全？」** 醫生只是 grant 的接收者，金鑰被 Seal 鎖在政策下；Enoki 只贊助 gas，不持有金鑰。
- **「過期/撤銷怎麼保證？」** `consume_grant` 斷言 `now < expires_at_ms`；`seal_approve` 每次解密在 key-server 重驗 → 過期/撤銷在 key-server fail，不是 UI。
- **「為何 Walrus 不用 IPFS？」** Sui-native、blob 與鏈上錨定同生態、儲存有經濟保證。
- **「資料量大怎麼辦？」** 圖片與文字分別存 Walrus blob，鏈上只放 blob ID + 雜湊，鏈上成本固定。
