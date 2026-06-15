# Doctor Deep-Link Consume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Patient share 產出一條可點擊連結；doctor 點開 → 登入 → 落地 `/doctor` 自動帶入 grantId+token → 一鍵 Decrypt。

**Architecture:** 連結把 `g`(grantId)+`t`(token) 放 URL hash fragment。DoctorShell mount 時捕獲 fragment → stash 進 sessionStorage → 清 hash（避免被 zkLogin OAuth `#id_token` 蓋掉）。zkLogin callback 完成後依 pending 旗標導向 `/doctor`。ConsumePage mount 時從 pending 預填欄位（首讀即清），doctor 點現有 Decrypt 按鈕觸發 consume（保留 doctor 控制 burn 時機）。RecordShare 加 TTL 選擇器、QR 改編連結 URL、加 Copy link。

**Tech Stack:** React 18, react-router-dom, `@mysten/sui` 2.16, `@mysten/seal`, vitest (jsdom, globals).

**Spec:** `docs/superpowers/specs/2026-05-31-doctor-deep-link-consume-design.md`

---

## File Structure

| 檔案 | 責任 |
|---|---|
| `frontend/src/lib/consumeLink.ts` | **NEW** 純函式：build/parse 連結 + pending sessionStorage stash/restore/clear。無 SDK 依賴。 |
| `frontend/src/lib/consumeLink.test.ts` | **NEW** consumeLink 單元測試。 |
| `frontend/src/doctor/Shell.tsx` | mount effect 捕獲 hash → stash → 清 hash。 |
| `frontend/src/patient/AuthLogin.tsx` | zkLogin callback 完成後依 pending 導向 `/doctor` vs `/patient`。 |
| `frontend/src/doctor/ConsumePage.tsx` | mount effect 從 pending 預填 grantId+token，首讀即清。 |
| `frontend/src/patient/RecordShare.tsx` | TTL 選擇器（預設 1h）+ QR 編連結 URL + Copy link + grantId fallback。 |

所有指令前綴 `cd /Users/ramonliao/Documents/Code/Project/Web3/Hackathon/2026_Tokyo_Clawathon/AnamPouch/frontend &&`。

---

## Task 1: `lib/consumeLink.ts` — 純函式 + pending helper

**Files:**
- Create: `frontend/src/lib/consumeLink.ts`
- Test: `frontend/src/lib/consumeLink.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/consumeLink.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildConsumeLink,
  parseConsumeHash,
  stashPendingConsume,
  restorePendingConsume,
  clearPendingConsume,
} from './consumeLink';

describe('consumeLink', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('build → parse round-trips g and t', () => {
    const link = buildConsumeLink('https://app.test', '0xgrant', 'tok_abc');
    expect(link).toBe('https://app.test/doctor#g=0xgrant&t=tok_abc');
    const url = new URL(link);
    expect(parseConsumeHash(url.hash)).toEqual({ g: '0xgrant', t: 'tok_abc' });
  });

  it('parseConsumeHash tolerates leading # and no #', () => {
    expect(parseConsumeHash('#g=0x1&t=aa')).toEqual({ g: '0x1', t: 'aa' });
    expect(parseConsumeHash('g=0x1&t=aa')).toEqual({ g: '0x1', t: 'aa' });
  });

  it('parseConsumeHash returns null when g or t missing or empty', () => {
    expect(parseConsumeHash('#g=0x1')).toBeNull();
    expect(parseConsumeHash('#t=aa')).toBeNull();
    expect(parseConsumeHash('')).toBeNull();
    expect(parseConsumeHash('#g=&t=aa')).toBeNull();
    expect(parseConsumeHash('#id_token=xyz')).toBeNull();
  });

  it('parseConsumeHash url-decodes values', () => {
    expect(parseConsumeHash('#g=0x1&t=a%2Bb')).toEqual({ g: '0x1', t: 'a+b' });
  });

  it('stash → restore → clear lifecycle', () => {
    expect(restorePendingConsume()).toBeNull();
    stashPendingConsume({ g: '0xg', t: 'tt' });
    expect(restorePendingConsume()).toEqual({ g: '0xg', t: 'tt' });
    clearPendingConsume();
    expect(restorePendingConsume()).toBeNull();
  });

  it('restorePendingConsume returns null on corrupt json', () => {
    sessionStorage.setItem('anampouch_pending_consume', '{not json');
    expect(restorePendingConsume()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/ramonliao/Documents/Code/Project/Web3/Hackathon/2026_Tokyo_Clawathon/AnamPouch/frontend && npx vitest run src/lib/consumeLink.test.ts`
Expected: FAIL — `Failed to resolve import './consumeLink'`.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/lib/consumeLink.ts`:

```ts
/**
 * Doctor deep-link helpers.
 *
 * Link format: `${origin}/doctor#g=<grantId>&t=<base64url token>`
 * Both params live in the URL *hash fragment* — fragments are never sent to
 * the server and never appear in Referer headers, keeping the single-use
 * decrypt token off server logs.
 *
 * The pending-consume sessionStorage stash bridges the zkLogin OAuth round-trip:
 * Google's implicit flow overwrites the fragment with `#id_token=...`, so we
 * capture our params BEFORE login and restore them after.
 */

const PENDING_KEY = 'anampouch_pending_consume';

export interface ConsumeParams {
  g: string; // AccessGrant object id
  t: string; // base64url one-time token (preimage)
}

export function buildConsumeLink(origin: string, grantId: string, token: string): string {
  return `${origin}/doctor#g=${encodeURIComponent(grantId)}&t=${encodeURIComponent(token)}`;
}

/** Parse a location.hash (with or without leading '#'). Returns null unless both g and t are present and non-empty. */
export function parseConsumeHash(hash: string): ConsumeParams | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  const g = params.get('g');
  const t = params.get('t');
  if (!g || !t) return null;
  return { g, t };
}

export function stashPendingConsume(p: ConsumeParams): void {
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(p));
}

export function restorePendingConsume(): ConsumeParams | null {
  const raw = sessionStorage.getItem(PENDING_KEY);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as ConsumeParams;
    if (!p?.g || !p?.t) return null;
    return p;
  } catch {
    return null;
  }
}

export function clearPendingConsume(): void {
  sessionStorage.removeItem(PENDING_KEY);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/ramonliao/Documents/Code/Project/Web3/Hackathon/2026_Tokyo_Clawathon/AnamPouch/frontend && npx vitest run src/lib/consumeLink.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/ramonliao/Documents/Code/Project/Web3/Hackathon/2026_Tokyo_Clawathon/AnamPouch && \
git add frontend/src/lib/consumeLink.ts frontend/src/lib/consumeLink.test.ts && \
git commit -m "feat(deep-link): consumeLink build/parse + pending stash helpers"
```

---

## Task 2: DoctorShell 捕獲 hash 參數

**Files:**
- Modify: `frontend/src/doctor/Shell.tsx`

捕獲必須在 always-mount 的 DoctorShell（不論登入與否），因為未登入時 render 的是 AuthLogin，ConsumePage 還沒掛上。

- [ ] **Step 1: Add capture effect**

在 `frontend/src/doctor/Shell.tsx` 修改 imports 與 component 開頭。

改 import 區（檔案最上方）為：

```tsx
import { useEffect, useRef } from 'react';
import { Link, Outlet } from 'react-router-dom';
import { useAuthSession } from '../lib/useAuthSession';
import { AuthControls } from '../components/AuthControls';
import { AuthLogin } from '../patient/AuthLogin';
import { parseConsumeHash, stashPendingConsume } from '../lib/consumeLink';
```

在 `export function DoctorShell() {` 之後、`const auth = useAuthSession();` 之前插入：

```tsx
  // Capture deep-link params (#g=..&t=..) on mount, BEFORE any zkLogin OAuth
  // round-trip can overwrite the fragment with #id_token. Persist to
  // sessionStorage and strip the hash so the two never collide.
  const captured = useRef(false);
  useEffect(() => {
    if (captured.current) return; // guard StrictMode double-mount
    const params = parseConsumeHash(window.location.hash);
    if (params) {
      stashPendingConsume(params);
      window.history.replaceState({}, '', window.location.pathname + window.location.search);
    }
    captured.current = true;
  }, []);
```

`const auth = useAuthSession();` 與其後皆不變。

- [ ] **Step 2: Type-check**

Run: `cd /Users/ramonliao/Documents/Code/Project/Web3/Hackathon/2026_Tokyo_Clawathon/AnamPouch/frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/ramonliao/Documents/Code/Project/Web3/Hackathon/2026_Tokyo_Clawathon/AnamPouch && \
git add frontend/src/doctor/Shell.tsx && \
git commit -m "feat(deep-link): DoctorShell captures hash params before OAuth round-trip"
```

---

## Task 3: AuthLogin 依 pending 導向 `/doctor`

**Files:**
- Modify: `frontend/src/patient/AuthLogin.tsx`

zkLogin callback 完成後目前硬跳 `/patient`。改成：有 pending consume → `/doctor`。

- [ ] **Step 1: Import restore helper**

在 `frontend/src/patient/AuthLogin.tsx` 既有 import 區加入：

```tsx
import { restorePendingConsume } from '../lib/consumeLink';
```

- [ ] **Step 2: Branch the redirect**

找到既有區塊（zkLogin callback 分支內）：

```tsx
          if (window.location.pathname.startsWith('/zklogin/callback')) {
            navigate('/patient', { replace: true });
          }
```

替換為：

```tsx
          if (window.location.pathname.startsWith('/zklogin/callback')) {
            // Honor a pending doctor deep-link: land on /doctor so ConsumePage
            // can pick up the stashed grant params instead of the patient app.
            navigate(restorePendingConsume() ? '/doctor' : '/patient', { replace: true });
          }
```

- [ ] **Step 3: Type-check**

Run: `cd /Users/ramonliao/Documents/Code/Project/Web3/Hackathon/2026_Tokyo_Clawathon/AnamPouch/frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/ramonliao/Documents/Code/Project/Web3/Hackathon/2026_Tokyo_Clawathon/AnamPouch && \
git add frontend/src/patient/AuthLogin.tsx && \
git commit -m "feat(deep-link): route zkLogin callback to /doctor when consume pending"
```

---

## Task 4: ConsumePage 從 pending 預填

**Files:**
- Modify: `frontend/src/doctor/ConsumePage.tsx`

mount 時若有 pending → 預填 grantId+token，首讀即清（reload 不重觸發）。**不自動執行 handleDecrypt**。

- [ ] **Step 1: Import + prefill effect**

在 `frontend/src/doctor/ConsumePage.tsx` 最上方 import 區加入（與既有 `useState` 同行調整）：

```tsx
import { useState, useEffect, useRef } from 'react';
```

並加入：

```tsx
import { restorePendingConsume, clearPendingConsume } from '../lib/consumeLink';
```

在 component 內，既有 `const [token, setToken] = useState('');` 之後、`handleDecrypt` 之前插入：

```tsx
  // Prefill from a doctor deep-link captured by DoctorShell. Read-and-clear so a
  // reload (or StrictMode double-mount) does not resurrect consumed params.
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current) return;
    prefilled.current = true;
    const pending = restorePendingConsume();
    if (pending) {
      setGrantId(pending.g);
      setToken(pending.t);
      clearPendingConsume();
    }
  }, []);
```

`handleDecrypt` 與其餘皆不變。

- [ ] **Step 2: Type-check**

Run: `cd /Users/ramonliao/Documents/Code/Project/Web3/Hackathon/2026_Tokyo_Clawathon/AnamPouch/frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/ramonliao/Documents/Code/Project/Web3/Hackathon/2026_Tokyo_Clawathon/AnamPouch && \
git add frontend/src/doctor/ConsumePage.tsx && \
git commit -m "feat(deep-link): ConsumePage prefills grant params from pending stash"
```

---

## Task 5: RecordShare — TTL 選擇器 + QR 編連結 + Copy link

**Files:**
- Modify: `frontend/src/patient/RecordShare.tsx`

四項改動：(a) TTL 選擇器 state + UI；(b) `handleIssue` 用選定 TTL；(c) grantId resolve 後組連結 state；(d) QR 編連結（非 raw token）+ Copy link 按鈕 + 有效期限文字 + fallback。

- [ ] **Step 1: Add TTL + link state**

在 `frontend/src/patient/RecordShare.tsx` component 內，既有 state 宣告區（`const [copied, setCopied] = useState(false);` 附近）加入：

```tsx
  const [ttlMs, setTtlMs] = useState<bigint>(60n * 60_000n); // default 1 hour
  const [link, setLink] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
```

TTL 選項常數放在 component 之外（檔案頂層、import 之後）：

```tsx
const TTL_OPTIONS: { label: string; ms: bigint }[] = [
  { label: '15 minutes', ms: 15n * 60_000n },
  { label: '1 hour', ms: 60n * 60_000n },
  { label: '24 hours', ms: 24n * 60n * 60_000n },
];
```

- [ ] **Step 2: Build link when grantId resolves**

在 `handleIssue` 內，找到既有：

```tsx
        if (created?.objectId) setGrantId(created.objectId);
```

替換為（組連結）：

```tsx
        if (created?.objectId) {
          setGrantId(created.objectId);
          setLink(buildConsumeLink(window.location.origin, created.objectId, token.qrPayload));
        }
```

並在 `handleIssue` 中把 hardcoded TTL：

```tsx
        ttlMs: 15n * 60_000n, // 15 min
```

替換為：

```tsx
        ttlMs,
```

在檔案 import 區加入：

```tsx
import { buildConsumeLink } from '../lib/consumeLink';
```

- [ ] **Step 3: QR encodes the link; add TTL selector, Copy-link, validity text**

`QRCode.toCanvas` 的 useEffect 目前依賴 `qr`。改成：有 `link` 就編 `link`，否則編 `qr`（fallback）。找到：

```tsx
  useEffect(() => {
    if (!qr || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, qr, {
      errorCorrectionLevel: 'M',
      width: 288,
      margin: 2,
    }).catch(() => {/* non-fatal */});
  }, [qr]);
```

替換為：

```tsx
  useEffect(() => {
    const payload = link ?? qr;
    if (!payload || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, payload, {
      errorCorrectionLevel: 'M',
      width: 288,
      margin: 2,
    }).catch(() => {/* non-fatal */});
  }, [qr, link]);
```

加一個 copy-link handler，放在既有 `handleCopy` 之後：

```tsx
  const handleCopyLink = () => {
    if (!link) return;
    navigator.clipboard.writeText(link).then(() => {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    });
  };
```

TTL 選擇器：在尚未發 grant 的區塊（`{!qr && ( ... )}` 內、Issue 按鈕之前）加入 selector。找到：

```tsx
      {!qr && (
        <div style={{ textAlign: 'center', padding: '40px 0', background: 'var(--primary-soft)', borderRadius: 16 }}>
          <button 
            className="btn-primary" 
            style={{ padding: '12px 24px', fontSize: 16 }}
            onClick={handleIssue} 
            disabled={busy}
          >
            {busy ? '🚀 Issuing Grant…' : '🎫 Issue 15-min single-use QR'}
          </button>
```

替換為：

```tsx
      {!qr && (
        <div style={{ textAlign: 'center', padding: '40px 0', background: 'var(--primary-soft)', borderRadius: 16 }}>
          <div style={{ marginBottom: 20 }}>
            <label className="input-label" style={{ display: 'block', marginBottom: 8 }}>Link valid for</label>
            <select
              aria-label="Access link validity"
              value={ttlMs.toString()}
              onChange={(e) => setTtlMs(BigInt(e.target.value))}
              disabled={busy}
              style={{ padding: '8px 12px', fontSize: 14, borderRadius: 8, border: '1px solid var(--border)' }}
            >
              {TTL_OPTIONS.map((o) => (
                <option key={o.label} value={o.ms.toString()}>{o.label}</option>
              ))}
            </select>
          </div>
          <button 
            className="btn-primary" 
            style={{ padding: '12px 24px', fontSize: 16 }}
            onClick={handleIssue} 
            disabled={busy}
          >
            {busy ? '🚀 Issuing Grant…' : '🎫 Issue single-use access link'}
          </button>
```

- [ ] **Step 4: Add Copy-link button + validity text in the QR section**

找到 QR 區塊內既有的有效期限文字：

```tsx
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
              Valid for 15 minutes • Single-use only
            </p>
```

替換為（動態顯示選定 TTL）：

```tsx
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
              Valid for {TTL_OPTIONS.find((o) => o.ms === ttlMs)?.label ?? 'a limited time'} • Single-use only
            </p>
```

在「Grant Object ID」區塊之前（QR canvas 之後），加入 Share-link 區塊與 fallback 提示。找到：

```tsx
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
              <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>Grant Object ID</p>
```

在這個 `<div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>` 開頭之後、`Grant Object ID` 的 `<div>` 之前插入：

```tsx
            {link ? (
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>Share Link (QR encodes this)</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <pre className="pre-block" style={{
                    flex: 1, padding: '12px 16px', margin: 0, fontSize: 12, wordBreak: 'break-all',
                  }}>{link}</pre>
                  <button
                    onClick={handleCopyLink}
                    className="btn-secondary"
                    aria-label="Copy share link to clipboard"
                    style={{ padding: '12px 16px', borderRadius: 12, minWidth: 80 }}
                  >
                    {copiedLink ? '✅' : '🔗'} {copiedLink ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ padding: 12, borderRadius: 8, background: 'var(--primary-soft)', fontSize: 12, color: 'var(--text-muted)' }}>
                Resolving grant from blockchain… QR currently encodes the raw token; the doctor can paste it manually if the share link does not appear.
              </div>
            )}
```

- [ ] **Step 5: Type-check**

Run: `cd /Users/ramonliao/Documents/Code/Project/Web3/Hackathon/2026_Tokyo_Clawathon/AnamPouch/frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Run full unit suite (no regressions)**

Run: `cd /Users/ramonliao/Documents/Code/Project/Web3/Hackathon/2026_Tokyo_Clawathon/AnamPouch/frontend && npx vitest run`
Expected: all existing tests + consumeLink tests PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/ramonliao/Documents/Code/Project/Web3/Hackathon/2026_Tokyo_Clawathon/AnamPouch && \
git add frontend/src/patient/RecordShare.tsx && \
git commit -m "feat(deep-link): RecordShare TTL selector + QR encodes share link + copy link"
```

---

## Task 6: Production build + manual E2E checklist

**Files:** none (verification only)

- [ ] **Step 1: Production build**

Run: `cd /Users/ramonliao/Documents/Code/Project/Web3/Hackathon/2026_Tokyo_Clawathon/AnamPouch/frontend && npm run build`
Expected: build succeeds, no type errors.

- [ ] **Step 2: Manual E2E (使用者執行 — 需互動式 Google OAuth)**

> `cd frontend && npm run dev`（先 Ctrl-C 舊 server——Vite boot 時 inline env）。Doctor 地址需先有 gas（已知限制 #2；faucet 429 時用預灌 gas 地址）。

1. **Happy path（zkLogin）**：patient Google 登入 → `/patient` 建 record → `Share` → 選 TTL `1 hour` → `Issue single-use access link` → 確認出現 Share Link + QR。Copy link。
2. 新分頁（或無痕）貼上連結開啟 → 應落 `/doctor` 並彈 AuthLogin → Google 登入 → 自動回 `/doctor`，Grant Object ID + Access Token 兩欄**已預填** → 點 `🔓 Decrypt Record` → 確認明文 + traceability meta。
3. **Monkey — 壞 token**：把連結 `t=` 改一個字元 → 開 → 登入 → 預填 → Decrypt → 預期友善錯誤、無白屏。
4. **Monkey — reload 不重跑**：步驟 2 Decrypt 成功後 reload `/doctor` → 欄位應為空、**不**自動觸發 consume（pending 已清）。
5. **Monkey — 過期/已用 grant**：用已 consume 過的連結 → Decrypt → 預期 "single-use and has already been consumed" 友善訊息。
6. **wallet 登入走同連結**：用 browser wallet 開連結 → 登入後預填 + 一鍵 Decrypt（驗 provider-agnostic）。
7. 結果 append 到 `tasks/progress.md` Recently Completed。

---

## Self-Review

**Spec coverage:**
- 連結格式 hash fragment → Task 1 `buildConsumeLink` ✅
- DoctorShell 捕獲 + 清 hash → Task 2 ✅
- AuthLogin 依 pending 導向 → Task 3 ✅
- ConsumePage 預填首讀即清 → Task 4 ✅
- RecordShare QR 編 URL + Copy link + fallback → Task 5 ✅
- TTL 選擇器（已知限制 #1，預設 1h）→ Task 5 ✅
- gas 限制 #2、JSON-RPC #3 → 設計上是 Non-Goal/限制，無 task（spec 已記）✅
- Red team（壞參數/OAuth 撞/reload 重跑/wallet 路徑/過期）→ Task 6 monkey 2–6 ✅
- 單元測試 build↔parse + stash 生命週期 → Task 1 ✅

**Placeholder scan:** 無 TBD/TODO；每個 code step 都有完整程式碼與精確 find/replace 目標。

**Type consistency:** `ConsumeParams {g,t}`、`buildConsumeLink(origin,grantId,token)`、`parseConsumeHash(hash)`、`stash/restore/clearPendingConsume`、sessionStorage key `anampouch_pending_consume` 全 task 一致。`ttlMs: bigint` 與 `buildIssueGrantTx` 的 `IssueGrantArgs.ttlMs: bigint` 相符。`token.qrPayload: string` 與 `AccessToken` 定義相符。
