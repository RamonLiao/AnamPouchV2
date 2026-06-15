# Doctor Deep-Link Consume — Design

> Patient share 產出一條可點擊連結；doctor 點開 → 登入（zkLogin/wallet/passkey）→ 落地 `/doctor` 預填好 grantId+token → 一鍵 Decrypt 觀看明文。

**Date:** 2026-05-31
**Status:** Approved (design), pending implementation plan
**Branch (suggested):** `feat/doctor-deep-link-consume`

## Goal

把現有「doctor 手動貼 grantId + token」的流程，改成 patient 給一條連結、doctor 點開登入後參數自動帶入、按一下即解密。降低 demo / 真實使用的手動摩擦。

## Non-Goals

- 不做全自動 consume（登入即燒 grant）。consume 單次 + 燒 gas，保留 doctor 一鍵確認時機（避免中途解密失敗 grant 已 burn 無法取消）。
- 不改 `handleDecrypt` 的鏈上主邏輯（consume → fetch → SessionKey → seal_approve → decrypt 全部沿用）。
- 不改 Google OAuth redirect URI（維持單一 `/zklogin/callback`，見下方理由）。
- **不解決 doctor 地址 gas 問題**（見「已知限制」#2）。sponsored tx / Enoki gas station 為 post-hackathon。
- 不順手遷移殘留 JSON-RPC call（見「已知限制」#3）。獨立 task。

## 已知限制（sui-architect review 揪出，必讀）

1. **[HIGH] 三重時鐘：grant TTL vs「連結是非同步的」**
   deep-link 的使用情境是「傳出去、對方晚點開」，但 grant 目前 hardcode **15 分鐘單次**。等 doctor 收到 → 開瀏覽器 → 跑完 Google OAuth round-trip，15 分鐘極可能已過 → 必撞 `EGrantExpired`（鏈上 reject + 友善訊息已有，但體感差）。
   **本設計對策（納入範圍）**：share 時讓 patient 選 TTL，deep-link 場景預設拉長；連結 UI 標明有效期限。見「元件 2」。
2. **[HIGH] 收連結的 doctor zkLogin 地址需要 gas**
   最自然受眾是「第一次用、剛 Google 登入」的 doctor → 全新 zkLogin 地址 0 SUI → `consume_grant` execute 失敗。疊加已知 faucet 429 blocker。純前端無解。
   **對策**：本限制明列於此；demo 用預灌 gas 的地址；sponsored tx = post-hackathon。
3. **[MED] JSON-RPC 殘留（pre-existing）**
   `ConsumePage.getObject` / `RecordShare.waitForTransaction` 仍走 `suiJsonRpc`；官方 JSON-RPC removal 窗口已過（2026-04）。本設計不動這些 call。遷 gRPC 為獨立 tech-debt task，避免本次 over-scope。

## 約束（既有現實，影響設計）

1. **Google OAuth = implicit flow**：`id_token` 回在 URL fragment，redirect URI 固定 `${origin}/zklogin/callback`。任何放在 deep-link fragment 的參數，跨 Google round-trip 會被 `#id_token` 蓋掉 → **必須在發起登入前先持久化**。
2. **token 不可走 OAuth `state` / 任何 Google round-trip**：那會讓單次解密 token 經過 Google 伺服器/日誌。sessionStorage stash 全程不離開本機，較私密。
3. **AuthLogin 目前硬跳 `/patient`**（`AuthLogin.tsx` callback 分支）。doctor deep-link 需依 pending 狀態改導向。
4. **DoctorShell 以 AuthLogin gate**：未登入顯示 AuthLogin，已登入 render `<ConsumePage/>`。DoctorShell always-mount → 適合做參數捕獲點。

## 連結格式

```
${origin}/doctor#g=<grantId>&t=<base64url token>
```

- 全部放 **hash fragment**：fragment 不送 server、不進 referrer header。
- `t` 即現有 `token.qrPayload`（已是 base64url 單次 preimage）。
- `g` 即 share 時從 tx effects 撈到的 AccessGrant objectId。

## 元件與資料流

### 1. `lib/consumeLink.ts`（NEW）

純函式 + sessionStorage helper，全部可單元測試、無 SDK 依賴。

```ts
const PENDING_KEY = 'anampouch_pending_consume';

export interface ConsumeParams { g: string; t: string; }

// build: 給 origin + grantId + token → deep link 字串
export function buildConsumeLink(origin: string, grantId: string, token: string): string;

// parse: 從 location.hash（"#g=..&t=.." 或 "g=..&t=.."）抽出參數；缺任一回 null
export function parseConsumeHash(hash: string): ConsumeParams | null;

// stash/restore/clear pending consume（sessionStorage）
export function stashPendingConsume(p: ConsumeParams): void;
export function restorePendingConsume(): ConsumeParams | null;
export function clearPendingConsume(): void;
```

### 2. Patient 端 — `patient/RecordShare.tsx`

- **TTL 選擇器（新，對應已知限制 #1）**：issue 前讓 patient 選有效期限。選項建議 `15 min / 1 hour / 24 hour`，deep-link 場景**預設 1 hour**（取代現在 hardcode `15n*60_000n`）。選值傳入 `buildIssueGrantTx({ ttlMs })`。仍受合約 `MIN_TTL_MS..MAX_TTL_MS`（1min–30day）約束。
- grantId resolve 成功後，用 `buildConsumeLink(window.location.origin, grantId, token.qrPayload)` 組連結，存 state。
- **QR 改編這條 URL**（取代原本編 raw token）；手機相機掃即開。
- 新增「📋 Copy link」按鈕（沿用現有 copy + 2s feedback 模式）。
- **連結 UI 標明有效期限**（"Valid for <選定 TTL>"），呼應 #1。
- **Fallback**：grantId 撈不到（tx effects lookup 失敗）→ 連結無法組 → 保留原 raw-token QR + 顯示提示「grant 解析中／可手動貼」。raw token 顯示區塊保留。

### 3. 參數捕獲 — `doctor/Shell.tsx`（DoctorShell）

mount effect（登入與否都先跑）：

```
const params = parseConsumeHash(window.location.hash);
if (params) {
  stashPendingConsume(params);
  window.history.replaceState({}, '', window.location.pathname); // 清 hash，避免撞 #id_token
}
```

- 用 ref / module guard 防 StrictMode 雙跑重複 stash（stash 同值 idempotent，但清 hash 只需一次）。

### 4. 登入後導向 — `patient/AuthLogin.tsx`

`completeZkLogin` 成功、且在 `/zklogin/callback` 路徑時：

```
if (restorePendingConsume()) navigate('/doctor', { replace: true });
else navigate('/patient', { replace: true });
```

- wallet/passkey 登入無 round-trip：DoctorShell 已在 `/doctor`，`onSessionReady` 觸發 re-render → 直接 render ConsumePage，不需導向。

### 5. ConsumePage 預填 — `doctor/ConsumePage.tsx`

mount effect：

```
const pending = restorePendingConsume();
if (pending) {
  setGrantId(pending.g);
  setToken(pending.t);
  clearPendingConsume();   // 首讀即清，reload 不重觸發
}
```

- 用 ref 防 StrictMode 雙 mount 在 setState 前就 clear。
- 預填後 doctor 看到欄位已填 → 點現有 `🔓 Decrypt Record`。**不自動執行**。
- `handleDecrypt` 完全不動。

## Red Team（auth / access-control 核心）

| 向量 | 防禦 |
|---|---|
| 垃圾/竄改 hash 參數 | `parseConsumeHash` 缺參數回 null（不 stash）；`decodeQrPayload` 驗 token；下游走 `explainMoveError` 友善訊息 |
| OAuth fragment 撞 deep-link | 發起登入前已 stash + `replaceState` 清 hash；`#id_token` 回來時 pending 已存 |
| consume 後 reload 重跑 | pending key 首讀即 `clearPendingConsume()`，無 re-trigger |
| 連結轉給無 grant / 過期 / 已用 | 鏈上 consume / seal_approve reject → 友善錯誤（已驗 single-use replay） |
| StrictMode 雙 mount | ref guard：捕獲端只清一次 hash、預填端只 read+clear 一次 |

## 測試

- **Unit (`consumeLink.test.ts`)**：
  - `buildConsumeLink` ↔ `parseConsumeHash` round-trip。
  - `parseConsumeHash` 對缺 `g`、缺 `t`、空 hash、含前導 `#` → 正確 null / 解析。
  - `stash → restore → clear → restore=null` 生命週期。
- **手動 E2E**：patient 建 record → issue grant → Copy link → 新分頁開連結 → Google 登入 → 落 `/doctor` 欄位預填 → Decrypt → 明文 + traceability meta。
- **Monkey**：
  - 改一個字元的壞 token 連結 → 友善錯誤、無白屏。
  - 過期/已用 grant 連結 → 友善 "already consumed/expired"。
  - Decrypt 成功後 reload → 不重跑 consume（欄位空、不自動觸發）。
  - wallet 登入走同連結 → 一樣預填 + 一鍵 Decrypt。

## 改動檔案

| 檔案 | 改動 |
|---|---|
| `lib/consumeLink.ts` | **NEW** build/parse + pending stash/restore/clear |
| `lib/consumeLink.test.ts` | **NEW** unit tests |
| `patient/RecordShare.tsx` | TTL 選擇器（預設 1h）+ QR 編 URL + Copy link 按鈕 + fallback |
| `doctor/Shell.tsx` | mount 捕獲 hash → stash → 清 hash |
| `patient/AuthLogin.tsx` | callback 後依 pending 導向 `/doctor` vs `/patient` |
| `doctor/ConsumePage.tsx` | mount 從 pending 預填 grantId+token |

## 未來可選（非本次）

- 加 `/doctor/callback` redirect URI，讓 doctor zkLogin 不經 PatientShell 中轉（省畫面閃爍）。`initiateZkLogin` 已支援 `redirectUri` 參數。
- consume 後 grant 狀態顯示 / revoke 入口（原本的 revoke UI todo）。
