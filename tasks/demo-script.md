# AnamPouch — 5 min Demo Script

Sui Overflow 2026 · Walrus Track · testnet
App: https://anam-pouch.vercel.app · Local: localhost:5174

時間軸：**0:00–1:00 Pitch slide** → **1:00–4:00 Live demo** → **4:00–5:00 Future vision**

預載（demo 前先做好，別在台上等）：
- 病人帳號已登入、已建好 1 筆純文字 record + 1 筆圖片 record（新 package，Seal namespace 對得上）
- doctor viewer link / QR 已準備
- 兩個瀏覽器 window：病人端 + doctor 端，先排好版面

---

## PART 1 — Pitch Slide (0:00–1:00)

**單張 slide。口白逐字稿（British English）：**

> "Modern healthcare has one fundamental flaw — data silos. Your medical history is scattered across every clinic you've ever visited, and not a single copy is yours to carry.
> It gets worse. The moment you want an AI to read your diagnosis, your prescription, your medication interactions, you have to upload your most private data to the cloud. Privacy, compliance, the risk of a breach — it all collapses at that one step.
>
> **AnamPouch hands medical data sovereignty back to the patient.**
> It's a Sui-native digital health passport: encrypted *in the browser* with a key derived from the patient's own wallet, stored on **Walrus** decentralised storage, and anchored on the **Sui** blockchain.
> The cloud never sees the plaintext. The hospital no longer owns your records. **You are in absolute control.**"

Slide 上要有的 4 個字（視覺）：
- **Patient-owned** · **Client-side encrypted** · **Walrus storage** · **On-chain access control**

Stack 一行帶過（slide 角落，不唸）：Sui zkLogin · Seal · Walrus · Move 2024 · Enoki sponsored tx

---

## PART 2 — Live Demo (1:00–4:00)

> 開場一句（口白）："Everything you're about to see runs on live Sui testnet — this is not a mock-up."

### Beat 1 — 登入即主權 (1:00–1:25) ~25s
- 病人端點 **Sign in with Google**（zkLogin）
- 口白："I sign in with Google — but behind it is zkLogin. **No seed phrase, no wallet extension**, yet it derives a fully non-custodial Sui wallet. Zero friction for an ordinary patient to step into Web3."

### Beat 2 — 多模態擷取 + 瀏覽器加密上鏈 (1:25–2:25) ~60s ★核心
- 上傳/拍一張**藥袋或診斷書圖片**
- 口白："A lightweight LLM runs OCR **locally**, structuring this medicine-bag image into a clinical JSON record. The plaintext never leaves this device."
- 點 **Encrypt & Anchor**，邊跑邊講：
  - "AES-GCM-256 encrypts it right here in the browser — the key is derived via HKDF from the patient's own wallet signature."
  - "The encrypted image and text are pushed to **Walrus**, and we get back a blob ID."
  - "A `create_anchor` PTB lands on-chain, anchoring that blob ID and a hash fingerprint onto Sui."
- 切到 **Verifiable Timeline**：指 record 上的 **Sui 交易 hash 徽章**
- 口白："Every record carries its own on-chain transaction hash — provable origin, tamper-proof."
- （可選）點 **Decrypt image**：當場把加密圖片解回來顯示
- 口白（可選）："And to prove it's fully reversible — one tap, and the encrypted image decrypts straight back, end to end."

### Beat 3 — 授權醫生：無錢包、無 gas (2:25–3:25) ~60s ★殺手鐧
- 病人端 **Share** → 發一張**有時效**的 `access_grant` → 產生 QR / link
- 口白："To share, the AES key is sealed under the doctor's access policy using **Seal** threshold encryption, and the grant is written on-chain."
- 切到 **doctor 端 window**，開 QR link
- 口白（重點打慢）："Now look at the doctor's side — **no wallet installed, no app, no gas paid**. Enoki sponsors the transaction; the app foots the bill. The doctor scans the code and instantly sees the decrypted record. This is a genuinely zero-friction clinical workflow."

### Beat 4 — 一鍵撤銷，鏈上即時生效 (3:25–4:00) ~35s ★信任閉環
- 病人端點 **Revoke**
- 口白："The patient taps Revoke — one call, `revoke_grant`, and the grant flips to revoked on-chain."
- 回 doctor 端 reload → **存取失敗**
- 口白（收尾）："And here's the crucial part — **this isn't the front-end pretending to hide something.** Expiry and revocation are enforced by the Move contract and the Sui `Clock` at the **Seal key-server layer** — the key server simply refuses to release the key. No keeper bot, no cron job; the chain itself is the enforcer. And the grant object is never deleted, so the **audit trail lives on forever.**"

> Demo 安全網：若某台 Seal key server 503，threshold=2 另一台還在仍可解；若 zkLogin link 失效就重生一條新 link（舊 link 與授權檢查無關）。

---

## PART 3 — Future Vision (4:00–5:00)

> 一張 slide 或直接口述（British English）：

> "What you've just seen is a **working sovereign health passport.** Here's where we take it next:
>
> 1. **A local AI health assistant** — 'Will this newly prescribed drug interact with what I'm already taking?' — answered entirely over your decrypted records, on-device, with no plaintext ever leaving your phone.
> 2. **Cross-clinic timeline insights** — medication calendars, follow-up reminders, and personalised health trends tracked chronologically.
> 3. **True medical interoperability** — a patient walks into any clinic, in any country, carrying one verifiable, portable record that they, and only they, control.
>
> Medical data shouldn't belong to a hospital's database. **It should belong to the patient.**
> AnamPouch — carry it in your pocket."

收尾一句（口白）："Patient-owned. Encrypted in the browser. Verifiable on Sui. Stored on Walrus. Thank you."

---

## 評審可能追問 — 預備答案
- **「跟一般雲端 EHR 差在哪？」** 明文永不離開裝置；雲端/我們都看不到資料；存取控制在鏈上 Seal 層強制，非前端。
- **「醫生不用錢包怎麼安全？」** 醫生只是 grant 的接收者，金鑰被 Seal 鎖在政策下；Enoki 只贊助 gas，不持有金鑰。
- **「過期/撤銷怎麼保證？」** `consume_grant` 斷言 `now < expires_at_ms`；`seal_approve` 每次解密在 key-server 重驗 → 過期/撤銷在 key-server fail，不是 UI。
- **「為何 Walrus 不用 IPFS？」** Sui-native、blob 與鏈上錨定同生態、儲存有經濟保證。
- **「資料量大怎麼辦？」** 圖片與文字分別存 Walrus blob，鏈上只放 blob ID + 雜湊，鏈上成本固定。
