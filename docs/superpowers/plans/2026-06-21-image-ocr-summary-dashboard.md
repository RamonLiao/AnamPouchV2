# Image+OCR、On-chain Summary、Patient Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Move 任務的 code review 禁用 generic reviewer** — 用 `move-code-quality` → `sui-security-guard` → `sui-red-team`(見專案 skill-routing)。

**Goal:** 讓病人能拍照/上傳圖片做 OCR,圖文加密存 Walrus(Seal 控管),每次新增診斷自動更新一份鏈上健康總結,並提供病人 dashboard 統整分析。

**Architecture:** 圖文 = 兩個加密 Walrus blob + 一個 `RecordAnchor`(新增 `kind`/`image_blob_id`/`covered_count` 欄位);圖與文字共用同一 `content_hash` 當 Seal IBE id(A 方案,`seal_approve` 零改動)。Summary = `kind=1` 的 `RecordAnchor`,版本鏈(每次新建 + revoke 舊),複用現有 grant 分享。Dashboard 純讀鏈上 anchor + `seal_approve_owner` 自解最新 summary。

**Tech Stack:** Sui Move 2024 / `@mysten/sui` / `@mysten/seal` / Walrus HTTP / Gemini(`generativelanguage` v1beta)/ React Router v6 / vitest。

**Spec:** `docs/superpowers/specs/2026-06-21-image-ocr-summary-dashboard-design.md`

## Global Constraints

- 所有新的鏈上歷史掃描**必須**寫在 `frontend/src/api/queries.ts`(JSON-RPC 隔離,2026-07-31 停用,單檔遷移)。
- `kind` / `covered_count` 為純展示欄位,**禁止**被 `seal_approve` / `consume_grant` 信任。
- OCR 文字必須走既有 `redact()` gate 才能加密/上傳/餵 LLM(型別 `RedactedText` 強制)。原圖不去識別。
- IBE id A 方案:一個 record 的圖與文字用**同一** `content_hash`(=sha256(redacted text))加密。
- lib-to-lib 用依賴注入(免 mock SDK);UI 直連 SDK。
- Move 改動後 `sui move test` 必綠才 commit;重部署後更新 `frontend/.env.local` 的 `VITE_PORTABLE_HEALTH_PACKAGE_ID` 並**重啟 dev server**。
- Provider 固定 Gemini(`gemini-2.0-flash-exp`),key 走 `VITE_GEMINI_API_KEY`(前端可見,demo 接受)。

---

## File Structure

| File | 責任 | 動作 |
|---|---|---|
| `contracts/portable_health/sources/record_anchor.move` | anchor 結構 + create/revoke + seal_approve | 改:加 3 欄位 + RecordCreated 加 kind |
| `contracts/portable_health/tests/record_anchor_tests.move` | anchor 單元測試 | 改:新欄位 + 版本鏈測試 |
| `frontend/src/types/contracts.ts` | Move↔TS 型別 | 改:RecordAnchorFields + RecordCreatedEvent 加欄位 |
| `frontend/src/config/contract.ts` | 位址/設定 | 改:加 `GEMINI`、`recordKind` 常數 |
| `frontend/src/lib/gemini.ts` | 低階 Gemini generateContent(文字+圖) | 新 |
| `frontend/src/lib/ocr.ts` | 圖 → 文字(注入 gemini) | 新 |
| `frontend/src/lib/recordPipeline.ts` | 建立加密 record | 改:收 imageBlobId/kind/coveredCount |
| `frontend/src/lib/imagePipeline.ts` | 圖文雙 blob + 單 anchor | 新 |
| `frontend/src/lib/summary.ts` | 聚合→摘要→新 anchor+revoke 舊(含鎖) | 新 |
| `frontend/src/api/queries.ts` | 鏈上掃描 | 改:record 查詢 filter kind、加最新 summary 查詢 |
| `frontend/src/patient/RecordCreate.tsx` | 建檔 UI | 改:加拍照/上傳分頁 + OCR + 自動 summary 觸發 |
| `frontend/src/patient/Dashboard.tsx` | 病人總覽 | 新 |
| `frontend/src/lib/dashboardQuery.ts` | dashboard 聚合(純鏈上) | 新 |
| `frontend/src/patient/Shell.tsx` | 病人路由 | 改:加 /patient/dashboard tab |

---

## Task 1: Move — anchor 加 3 欄位 + RecordCreated 加 kind

**Files:**
- Modify: `contracts/portable_health/sources/record_anchor.move`
- Test: `contracts/portable_health/tests/record_anchor_tests.move`

**Interfaces:**
- Produces:
  - `create_anchor(content_hash, walrus_blob_id, hospital_id, visit_timestamp_ms, kind: u8, image_blob_id: vector<u8>, covered_count: u64, clock, ctx)`
  - 新 accessors `kind(&RecordAnchor): u8`、`image_blob_id(&RecordAnchor): &vector<u8>`、`covered_count(&RecordAnchor): u64`
  - `RecordCreated` event 新增 `kind: u8`、`covered_count: u64` 欄位

- [ ] **Step 1: 寫失敗測試 — kind=1 summary anchor 可建並讀回欄位**

加到 `record_anchor_tests.move`(沿用該檔現有 test scenario 風格;`SUMMARY_KIND` 用字面 `1`):

```move
#[test]
fun test_create_summary_anchor_fields() {
    let mut ts = test_scenario::begin(@0xCA11);
    let clock = clock::create_for_testing(ts.ctx());
    {
        record_anchor::create_anchor(
            b"01234567890123456789012345678901", // 32-byte content_hash
            b"summary-blob",
            b"hospital-x",
            1000,
            1,                 // kind = summary
            b"",               // image_blob_id empty for summary
            7,                 // covered_count
            &clock,
            ts.ctx(),
        );
    };
    ts.next_tx(@0xCA11);
    {
        let anchor = ts.take_shared<record_anchor::RecordAnchor>();
        assert!(record_anchor::kind(&anchor) == 1, 0);
        assert!(record_anchor::covered_count(&anchor) == 7, 1);
        assert!(record_anchor::image_blob_id(&anchor).length() == 0, 2);
        ts::return_shared(anchor);
    };
    clock::destroy_for_testing(clock);
    ts.end();
}
```

- [ ] **Step 2: 跑測試確認 fail**

Run: `cd contracts/portable_health && sui move test test_create_summary_anchor_fields`
Expected: 編譯失敗(`create_anchor` 參數數量不符 / `kind` accessor 不存在)。

- [ ] **Step 3: 改 struct + create_anchor + 事件 + accessors**

`record_anchor.move` — struct 末尾 `version: u8,` 後加:

```move
    /// 0 = clinical record, 1 = longitudinal summary (versioned chain).
    kind: u8,
    /// Walrus blob id of the original image (empty for text-only / summary).
    image_blob_id: vector<u8>,
    /// For kind=1: number of records condensed. 0 for kind=0.
    covered_count: u64,
```

`RecordCreated` event 加(放在 `created_at_ms` 後):

```move
    kind: u8,
    covered_count: u64,
```

`create_anchor` 簽名改成(在 `visit_timestamp_ms: u64,` 後、`clock` 前插入三參數):

```move
public fun create_anchor(
    content_hash: vector<u8>,
    walrus_blob_id: vector<u8>,
    hospital_id: vector<u8>,
    visit_timestamp_ms: u64,
    kind: u8,
    image_blob_id: vector<u8>,
    covered_count: u64,
    clock: &sui::clock::Clock,
    ctx: &mut TxContext,
) {
```

struct literal 內(`version: VERSION_ACTIVE,` 後)加:

```move
        kind,
        image_blob_id,
        covered_count,
```

`event::emit(RecordCreated {...})` 內(`created_at_ms: now,` 後)加:

```move
        kind,
        covered_count,
```

accessors 區加:

```move
public fun kind(anchor: &RecordAnchor): u8 { anchor.kind }
public fun image_blob_id(anchor: &RecordAnchor): &vector<u8> { &anchor.image_blob_id }
public fun covered_count(anchor: &RecordAnchor): u64 { anchor.covered_count }
```

- [ ] **Step 4: 修既有測試的 create_anchor 呼叫**

既有 `record_anchor_tests.move`(及任何 `access_grant_tests.move` 等用到 `create_anchor` 的測試)所有呼叫,在 `visit_timestamp_ms` 引數後補 `0, b"", 0,`(kind=0、空圖、count=0)。用 grep 找全:
Run: `grep -rn "create_anchor(" contracts/portable_health/tests`
逐處補三個引數。

- [ ] **Step 5: 跑全部 Move 測試確認綠**

Run: `cd contracts/portable_health && sui move test`
Expected: 全綠(含新 `test_create_summary_anchor_fields`)。

- [ ] **Step 6: 加版本鏈紅隊測試 — tombstone 的 summary seal_approve 該 fail**

沿用該檔既有「revoke 後 seal_approve abort」測試模式,複製一份建 `kind=1` anchor、revoke、斷言 `seal_approve_for_test` 以 `ENoAccess` abort(用 `#[expected_failure(abort_code = ...)]`,abort const 沿用既有測試引用方式)。跑:
Run: `cd contracts/portable_health && sui move test`
Expected: 全綠。

- [ ] **Step 7: Commit**

```bash
git add contracts/portable_health/sources/record_anchor.move contracts/portable_health/tests
git commit -m "feat(move): add kind/image_blob_id/covered_count to RecordAnchor + RecordCreated.kind"
```

---

## Task 2: 部署 testnet + 同步 env

**Files:**
- Modify: `frontend/.env.local`(本機,不 commit)

- [ ] **Step 1: build 確認無錯**

Run: `cd contracts/portable_health && sui move build`
Expected: BUILD SUCCESS。

- [ ] **Step 2: 升級部署(沿用既有升級流程)**

> 這是 package upgrade(非首發),用既有 UpgradeCap。若 CLI 版本飄移報 protocol mismatch,先 `suiup install sui` + `suiup default set sui@<latest>`(見 lessons 2026-05-02)。

Run: `cd contracts/portable_health && sui client upgrade --upgrade-capability <UpgradeCap_id>`
記下輸出的新 `published-at`(packageId)。

- [ ] **Step 3: 更新 env + 重啟 dev server**

把 `frontend/.env.local` 的 `VITE_PORTABLE_HEALTH_PACKAGE_ID` 改成新 `published-at`。`VITE_PORTABLE_HEALTH_ORIGINAL_ID` **不變**(原始 id)。在 `frontend/.env.local` 加一行 `VITE_GEMINI_API_KEY=<key>`。
Ctrl-C 終止舊 dev server → 由使用者終端機 `npm run dev`(sandboxed Bash 起 vite 會 EPERM,見 lessons)。

- [ ] **Step 4: 驗證鏈上有新函式**

Run: `curl -s -X POST https://fullnode.testnet.sui.io:443 -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"sui_getNormalizedMoveModule","params":["<new_packageId>","record_anchor"]}' | grep -o create_anchor`
Expected: 印出 `create_anchor`。

(此 Task 無 code commit;為部署 checkpoint。)

---

## Task 3: 前端型別 + recordPipeline 新參數

**Files:**
- Modify: `frontend/src/types/contracts.ts`
- Modify: `frontend/src/config/contract.ts`
- Modify: `frontend/src/lib/recordPipeline.ts`
- Test: `frontend/src/lib/recordPipeline.test.ts`(既有)

**Interfaces:**
- Produces:
  - `RECORD_KIND = { Record: 0, Summary: 1 }`
  - `createEncryptedRecord` 新增可選參數 `imageBlobId?: string`、`kind?: number`(預設 0)、`coveredCount?: bigint`(預設 0n);回傳不變 `{ recordId, blobId }`
  - `GEMINI` 設定物件 `{ apiKey, model }`

- [ ] **Step 1: 改型別**

`types/contracts.ts`:
- `RecordAnchorFields` 加 `kind: number;`、`image_blob_id: number[];`、`covered_count: string;`(u64 as string)。
- `RecordCreatedEvent` 加 `kind: number;`、`covered_count: string;`。
- 加常數:`export const RECORD_KIND = { Record: 0, Summary: 1 } as const;`

`config/contract.ts` 末尾加:

```ts
export const GEMINI = {
  apiKey: import.meta.env.VITE_GEMINI_API_KEY ?? '',
  model: import.meta.env.VITE_GEMINI_MODEL ?? 'gemini-2.0-flash-exp',
};
```

- [ ] **Step 2: 寫失敗測試 — createEncryptedRecord 傳新欄位進 PTB**

在既有 `recordPipeline.test.ts`(沿用其 `vi.hoisted` FakeTx + 注入 walrus/seal 模式)加:

```ts
it('passes kind/image_blob_id/covered_count to create_anchor', async () => {
  const captured = captureMoveCallArgs(); // 既有 helper;若無,沿用該檔斷言 tx.moveCall 引數的既有方式
  await createEncryptedRecord({
    plaintext: new TextEncoder().encode('hi'),
    hospitalId: 'h', visitTimestampMs: 1n,
    imageBlobId: 'img-blob', kind: 0, coveredCount: 0n,
    sealClient: fakeSeal, walrus: fakeWalrus, sui: fakeSui,
  });
  // 第 5、6、7 個引數應為 image_blob_id bytes / kind u64? 詳見 Step 3 順序
  expect(captured.argCount).toBe(8); // 7 data args + clock
});
```

> 若該檔目前無法斷言引數明細,最少斷言「不丟錯且 anchor 建出」+ 在 imagePipeline.test.ts(Task 5)做完整引數斷言。

- [ ] **Step 3: 改 createEncryptedRecord**

`recordPipeline.ts` — `CreateRecordArgs` 加:

```ts
  imageBlobId?: string;
  kind?: number;
  coveredCount?: bigint;
```

`tx.moveCall` 的 `arguments` 改成(順序對齊 Task 1 的 `create_anchor` 簽名):

```ts
    arguments: [
      tx.pure(bcs.vector(bcs.u8()).serialize(contentHash)),
      tx.pure(bcs.vector(bcs.u8()).serialize(new TextEncoder().encode(blobId))),
      tx.pure(bcs.vector(bcs.u8()).serialize(new TextEncoder().encode(args.hospitalId))),
      tx.pure.u64(args.visitTimestampMs),
      tx.pure.u8(args.kind ?? 0),
      tx.pure(bcs.vector(bcs.u8()).serialize(new TextEncoder().encode(args.imageBlobId ?? ''))),
      tx.pure.u64(args.coveredCount ?? 0n),
      tx.object(CLOCK_OBJECT_ID),
    ],
```

- [ ] **Step 4: 跑測試 + type-check**

Run: `cd frontend && npx vitest run src/lib/recordPipeline.test.ts && npx tsc --noEmit`
Expected: PASS + 無型別錯。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types/contracts.ts frontend/src/config/contract.ts frontend/src/lib/recordPipeline.ts frontend/src/lib/recordPipeline.test.ts
git commit -m "feat(frontend): recordPipeline supports kind/image/covered_count + GEMINI config"
```

---

## Task 4: 低階 Gemini call + OCR module

**Files:**
- Create: `frontend/src/lib/gemini.ts`
- Create: `frontend/src/lib/ocr.ts`
- Test: `frontend/src/lib/ocr.test.ts`

**Interfaces:**
- Produces:
  - `geminiGenerate(opts: { apiKey: string; model: string; systemPrompt: string; parts: GeminiPart[]; jsonMime?: boolean }): Promise<string>` — 回 candidates[0] 文字
  - `type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } }`
  - `extractText(args: { image: { bytes: Uint8Array; mimeType: string }; language: 'zh-TW'|'ja-JP'|'en'; gemini: GeminiCall }): Promise<string>`
  - `type GeminiCall = (parts: GeminiPart[], systemPrompt: string) => Promise<string>`

- [ ] **Step 1: 寫 gemini.ts**

```ts
export type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

export async function geminiGenerate(opts: {
  apiKey: string; model: string; systemPrompt: string;
  parts: GeminiPart[]; jsonMime?: boolean;
}): Promise<string> {
  if (!opts.apiKey) throw new Error('Gemini API key missing (VITE_GEMINI_API_KEY)');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${opts.model}:generateContent?key=${opts.apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: opts.systemPrompt }] },
      contents: [{ role: 'user', parts: opts.parts }],
      ...(opts.jsonMime ? { generationConfig: { responseMimeType: 'application/json' } } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const json = await res.json() as { candidates?: Array<{ content: { parts: Array<{ text: string }> } }> };
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (text == null) throw new Error('Gemini returned no text');
  return text;
}
```

- [ ] **Step 2: 寫失敗測試 — ocr 把圖轉文字、空回傳報錯**

`ocr.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { extractText } from './ocr';

const img = { bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' };

describe('extractText', () => {
  it('returns OCR text from gemini', async () => {
    const gemini = async () => '主訴:頭痛三天';
    const out = await extractText({ image: img, language: 'zh-TW', gemini });
    expect(out).toBe('主訴:頭痛三天');
  });

  it('throws when gemini returns blank', async () => {
    const gemini = async () => '   ';
    await expect(extractText({ image: img, language: 'zh-TW', gemini }))
      .rejects.toThrow(/no text|empty/i);
  });
});
```

- [ ] **Step 3: 跑確認 fail**

Run: `cd frontend && npx vitest run src/lib/ocr.test.ts`
Expected: FAIL(`extractText` 不存在)。

- [ ] **Step 4: 寫 ocr.ts**

```ts
import type { GeminiPart } from './gemini';

export type GeminiCall = (parts: GeminiPart[], systemPrompt: string) => Promise<string>;

function ocrPrompt(lang: 'zh-TW' | 'ja-JP' | 'en'): string {
  const label = { 'zh-TW': '繁體中文', 'ja-JP': '日本語', en: 'English' }[lang];
  return [
    `You are a medical-document OCR engine. Transcribe ALL visible text from the image verbatim.`,
    `Preserve numbers, units, and table structure as plain text. Output language as printed; primary expected language: ${label}.`,
    `Output ONLY the transcribed text — no commentary, no markdown fences.`,
  ].join('\n');
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

export async function extractText(args: {
  image: { bytes: Uint8Array; mimeType: string };
  language: 'zh-TW' | 'ja-JP' | 'en';
  gemini: GeminiCall;
}): Promise<string> {
  const parts: GeminiPart[] = [
    { text: 'Transcribe this medical document.' },
    { inlineData: { mimeType: args.image.mimeType, data: toBase64(args.image.bytes) } },
  ];
  const raw = await args.gemini(parts, ocrPrompt(args.language));
  const text = raw.trim();
  if (!text) throw new Error('OCR returned empty text');
  return text;
}
```

- [ ] **Step 5: 跑確認 pass + type-check**

Run: `cd frontend && npx vitest run src/lib/ocr.test.ts && npx tsc --noEmit`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/gemini.ts frontend/src/lib/ocr.ts frontend/src/lib/ocr.test.ts
git commit -m "feat(frontend): Gemini low-level call + OCR module (image→text)"
```

---

## Task 5: imagePipeline — 圖文雙 blob + 單 anchor(A 方案)

**Files:**
- Create: `frontend/src/lib/imagePipeline.ts`
- Test: `frontend/src/lib/imagePipeline.test.ts`

**Interfaces:**
- Consumes: `createEncryptedRecord`(Task 3)、`encryptForRecord`(seal.ts)、`uploadBlob`(walrus.ts)
- Produces: `createImageRecord(args: CreateImageRecordArgs): Promise<{ recordId: ObjectId; textBlobId: string; imageBlobId: string }>`

- [ ] **Step 1: 寫失敗測試 — 圖與文字用同一 content_hash 加密、anchor 帶 imageBlobId**

`imagePipeline.test.ts`(沿用 recordPipeline.test.ts 的注入式 fakes):

```ts
import { describe, it, expect, vi } from 'vitest';
import { createImageRecord } from './imagePipeline';

describe('createImageRecord', () => {
  it('encrypts image and text under the SAME content_hash and uploads two blobs', async () => {
    const encIds: string[] = [];
    const uploads: Uint8Array[] = [];
    const fakeSeal = { encrypt: vi.fn(async ({ id, data }: any) => { encIds.push(id); return { encryptedObject: data }; }) };
    const fakeWalrus = { upload: vi.fn(async (d: Uint8Array) => { uploads.push(d); return `blob-${uploads.length}`; }) };
    const fakeSui = { signAndExecute: vi.fn(async () => ({ objectChanges: [{ type: 'created', objectType: '0x1::record_anchor::RecordAnchor', objectId: '0xrec' }] })) };

    const out = await createImageRecord({
      redactedText: new TextEncoder().encode('redacted body'),
      image: new Uint8Array([9, 9, 9]),
      hospitalId: 'h', visitTimestampMs: 1n,
      sealClient: fakeSeal as any, walrus: fakeWalrus, sui: fakeSui as any,
    });

    expect(encIds.length).toBe(2);
    expect(encIds[0]).toBe(encIds[1]); // A 方案:同一 IBE id
    expect(uploads.length).toBe(2);
    expect(out.recordId).toBe('0xrec');
    expect(out.imageBlobId).toBeTruthy();
  });
});
```

- [ ] **Step 2: 跑確認 fail**

Run: `cd frontend && npx vitest run src/lib/imagePipeline.test.ts`
Expected: FAIL(`createImageRecord` 不存在)。

- [ ] **Step 3: 寫 imagePipeline.ts**

```ts
import { encryptForRecord } from './seal';
import { uploadBlob } from './walrus';
import { createEncryptedRecord } from './recordPipeline';
import { WALRUS } from '../config/contract';
import type { ObjectId } from '../types/contracts';
import type { Transaction } from '@mysten/sui/transactions';

export interface CreateImageRecordArgs {
  redactedText: Uint8Array;   // 已過 redact() gate
  image: Uint8Array;          // 原圖原始 bytes(不去識別)
  hospitalId: string;
  visitTimestampMs: bigint;
  sealClient: import('@mysten/seal').SealClient;
  walrus?: { upload: (data: Uint8Array) => Promise<string> };
  sui: {
    signAndExecute: (tx: Transaction) => Promise<{
      objectChanges?: Array<{ type: string; objectType?: string; objectId?: string }>;
    }>;
  };
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const ab = new ArrayBuffer(data.byteLength);
  new Uint8Array(ab).set(data);
  const buf = await crypto.subtle.digest('SHA-256', ab);
  return '0x' + Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function createImageRecord(args: CreateImageRecordArgs): Promise<{
  recordId: ObjectId; textBlobId: string; imageBlobId: string;
}> {
  // A 方案:圖用文字的 content_hash 當 IBE id。
  const contentHashHex = await sha256Hex(args.redactedText);
  const upload = args.walrus
    ? args.walrus.upload
    : (d: Uint8Array) => uploadBlob(d, { publisherUrl: WALRUS.publisherUrl, epochs: 5 });

  // 1. 先上傳加密原圖 → imageBlobId
  const imageCipher = await encryptForRecord({ data: args.image, recordId: contentHashHex, sealClient: args.sealClient });
  const imageBlobId = await upload(imageCipher);

  // 2. 文字走既有 pipeline(它內部會 sha256(text) 出同一 content_hash、加密、上傳、建 anchor)
  const { recordId, blobId: textBlobId } = await createEncryptedRecord({
    plaintext: args.redactedText,
    hospitalId: args.hospitalId,
    visitTimestampMs: args.visitTimestampMs,
    imageBlobId,
    kind: 0,
    coveredCount: 0n,
    sealClient: args.sealClient,
    walrus: args.walrus,
    sui: args.sui,
  });

  return { recordId, textBlobId, imageBlobId };
}
```

- [ ] **Step 4: 跑確認 pass + type-check**

Run: `cd frontend && npx vitest run src/lib/imagePipeline.test.ts && npx tsc --noEmit`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/imagePipeline.ts frontend/src/lib/imagePipeline.test.ts
git commit -m "feat(frontend): imagePipeline — dual-blob image record sharing one IBE id (scheme A)"
```

---

## Task 6: summary module — 聚合→摘要→版本鏈(含並發鎖 + 失敗隔離)

**Files:**
- Create: `frontend/src/lib/summary.ts`
- Test: `frontend/src/lib/summary.test.ts`

**Interfaces:**
- Consumes: `createEncryptedRecord`(Task 3,kind=1)、`geminiGenerate`(Task 4)
- Produces:
  - `regenerateSummary(args: RegenerateSummaryArgs): Promise<{ recordId: ObjectId } | null>` — 成功回新 summary anchor id;**任何步驟失敗回 `null` 並 `console.warn`,絕不 throw**(失敗隔離)
  - `args.revokeOld?: (oldSummaryId: ObjectId) => Promise<void>`
  - 模組內單一在途鎖:同時呼叫只跑一個,後到者等前者完成後用最新輸入重跑(回 `runSummaryExclusive`)

- [ ] **Step 1: 寫失敗測試 — 成功路徑 + 失敗隔離 + 互斥**

`summary.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { regenerateSummary } from './summary';

const base = {
  decryptedRecords: [{ text: '頭痛', visitMs: 1n }, { text: '發燒', visitMs: 2n }],
  language: 'zh-TW' as const,
  oldSummaryId: '0xold' as const,
};

function deps(over: Partial<any> = {}) {
  return {
    gemini: vi.fn(async () => '兩次就診:頭痛、發燒。建議追蹤。'),
    createSummaryAnchor: vi.fn(async () => ({ recordId: '0xnew' as const })),
    revokeOld: vi.fn(async () => {}),
    ...over,
  };
}

describe('regenerateSummary', () => {
  it('summarizes, creates kind=1 anchor with covered_count, revokes old', async () => {
    const d = deps();
    const out = await regenerateSummary({ ...base, ...d });
    expect(out?.recordId).toBe('0xnew');
    expect(d.createSummaryAnchor).toHaveBeenCalledWith(
      expect.objectContaining({ coveredCount: 2n }));
    expect(d.revokeOld).toHaveBeenCalledWith('0xold');
  });

  it('returns null and does NOT throw when gemini fails', async () => {
    const d = deps({ gemini: vi.fn(async () => { throw new Error('LLM down'); }) });
    const out = await regenerateSummary({ ...base, ...d });
    expect(out).toBeNull();
    expect(d.createSummaryAnchor).not.toHaveBeenCalled();
  });

  it('does not revoke old when anchor creation fails', async () => {
    const d = deps({ createSummaryAnchor: vi.fn(async () => { throw new Error('chain'); }) });
    const out = await regenerateSummary({ ...base, ...d });
    expect(out).toBeNull();
    expect(d.revokeOld).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑確認 fail**

Run: `cd frontend && npx vitest run src/lib/summary.test.ts`
Expected: FAIL(`regenerateSummary` 不存在)。

- [ ] **Step 3: 寫 summary.ts**

```ts
import type { ObjectId } from '../types/contracts';

export interface DecryptedRecord { text: string; visitMs: bigint; }

export interface RegenerateSummaryArgs {
  decryptedRecords: DecryptedRecord[];
  language: 'zh-TW' | 'ja-JP' | 'en';
  oldSummaryId?: ObjectId | null;
  gemini: (prompt: string) => Promise<string>;
  createSummaryAnchor: (a: { summaryText: string; coveredCount: bigint }) => Promise<{ recordId: ObjectId }>;
  revokeOld?: (oldSummaryId: ObjectId) => Promise<void>;
}

function summaryPrompt(records: DecryptedRecord[], lang: 'zh-TW' | 'ja-JP' | 'en'): string {
  const label = { 'zh-TW': '繁體中文', 'ja-JP': '日本語', en: 'English' }[lang];
  const body = records
    .slice()
    .sort((a, b) => Number(a.visitMs - b.visitMs))
    .map((r, i) => `# 就診 ${i + 1} (ts=${r.visitMs})\n${r.text}`)
    .join('\n\n');
  return [
    `You are a clinical summarizer. Produce a longitudinal health summary in ${label}.`,
    `Cover: chronic conditions, medication history, allergies, notable trends across visits, and follow-up items.`,
    `Input may contain redaction tokens like [NAME_1] — preserve verbatim, never invent values.`,
    `Be concise. No disclaimers, no markdown fences.`,
    `\n--- VISITS ---\n${body}`,
  ].join('\n');
}

export async function regenerateSummary(args: RegenerateSummaryArgs): Promise<{ recordId: ObjectId } | null> {
  try {
    if (args.decryptedRecords.length === 0) return null;
    const summaryText = (await args.gemini(summaryPrompt(args.decryptedRecords, args.language))).trim();
    if (!summaryText) { console.warn('summary: empty LLM output'); return null; }
    const created = await args.createSummaryAnchor({
      summaryText,
      coveredCount: BigInt(args.decryptedRecords.length),
    });
    // 只有新 anchor 成功後才 revoke 舊的(失敗也不影響:舊分叉是無害 stale)。
    if (args.oldSummaryId && args.revokeOld) {
      try { await args.revokeOld(args.oldSummaryId); }
      catch (e) { console.warn('summary: revoke old failed (stale fork tolerated)', e); }
    }
    return created;
  } catch (e) {
    console.warn('summary: regeneration failed, skipped (record creation unaffected)', e);
    return null;
  }
}

// 單一在途鎖:防多次觸發造成版本鏈分叉(best-effort,單 tab)。
let inflight: Promise<unknown> | null = null;
export async function runSummaryExclusive<T>(fn: () => Promise<T>): Promise<T> {
  while (inflight) { try { await inflight; } catch { /* ignore prior */ } }
  const p = fn();
  inflight = p;
  try { return await p; } finally { if (inflight === p) inflight = null; }
}
```

- [ ] **Step 4: 跑確認 pass + type-check**

Run: `cd frontend && npx vitest run src/lib/summary.test.ts && npx tsc --noEmit`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/summary.ts frontend/src/lib/summary.test.ts
git commit -m "feat(frontend): summary regeneration (versioned, failure-isolated, exclusive lock)"
```

---

## Task 7: queries — record 查詢 filter kind + 最新 summary 查詢

**Files:**
- Modify: `frontend/src/api/queries.ts`
- Test: `frontend/src/api/queries.test.ts`(若無則建)

**Interfaces:**
- Consumes: `CONTRACT.events.recordCreated`、`drainEvents`(既有)
- Produces:
  - `queryRecordCreatedByPatient` 多回 `kind`,並**只回 `kind===0`**(維持 RecordList 純病歷)
  - `queryLatestSummary(patient, revokedIds): { recordId: ObjectId; coveredCount: bigint; createdAtMs: bigint } | null` — 掃 `kind===1`、排除 `revokedIds`、取 `createdAtMs` 最大(MF2 容錯)

- [ ] **Step 1: 寫失敗測試 — 最新 summary 取 createdAtMs 最大、排除 tombstone**

`queries.test.ts`(把選取邏輯抽成純函式 `pickLatestSummary(events, revoked)` 以便單測,不碰網路):

```ts
import { describe, it, expect } from 'vitest';
import { pickLatestSummary } from './queries';

const ev = (id: string, created: string, count: string) => ({
  record_id: id, patient: '0xp', kind: 1, covered_count: count, created_at_ms: created,
});

describe('pickLatestSummary', () => {
  it('picks highest created_at_ms among non-revoked kind=1', () => {
    const events = [ev('0xa', '100', '2'), ev('0xb', '300', '5'), ev('0xc', '200', '3')];
    const out = pickLatestSummary(events as any, new Set(['0xb'])); // 0xb tombstoned
    expect(out?.recordId).toBe('0xc'); // 300 排除後剩 200 最大
    expect(out?.coveredCount).toBe(3n);
  });
  it('returns null when none', () => {
    expect(pickLatestSummary([], new Set())).toBeNull();
  });
});
```

- [ ] **Step 2: 跑確認 fail**

Run: `cd frontend && npx vitest run src/api/queries.test.ts`
Expected: FAIL(`pickLatestSummary` 不存在)。

- [ ] **Step 3: 改 queries.ts**

`queryRecordCreatedByPatient` 內,`.filter(... patient === patient)` 後鏈上再 filter `kind===0`:

```ts
  const records = res.data
    .map((e) => e.parsedJson as { patient: string; record_id: ObjectId; kind?: number })
    .filter((p) => p.patient === patient && (p.kind ?? 0) === 0)
    .map((p) => p.record_id);
```

新增純函式 + 查詢:

```ts
export interface SummaryRow { recordId: ObjectId; coveredCount: bigint; createdAtMs: bigint; }

export function pickLatestSummary(
  events: { record_id: ObjectId; patient: string; kind?: number; covered_count: string; created_at_ms: string }[],
  revoked: Set<ObjectId>,
): SummaryRow | null {
  let best: SummaryRow | null = null;
  for (const e of events) {
    if ((e.kind ?? 0) !== 1) continue;
    if (revoked.has(e.record_id)) continue;
    const createdAtMs = BigInt(e.created_at_ms);
    if (!best || createdAtMs > best.createdAtMs) {
      best = { recordId: e.record_id, coveredCount: BigInt(e.covered_count), createdAtMs };
    }
  }
  return best;
}

/** 掃該病人所有 RecordCreated(含 summary),選最新未 tombstone 的 summary。 */
export async function queryLatestSummary(
  patient: SuiAddress,
  revoked: Set<ObjectId>,
): Promise<SummaryRow | null> {
  const data = await drainEvents(CONTRACT.events.recordCreated);
  const mine = data
    .map((e) => e.parsedJson as { record_id: ObjectId; patient: string; kind?: number; covered_count: string; created_at_ms: string })
    .filter((p) => p.patient === patient);
  return pickLatestSummary(mine, revoked);
}
```

- [ ] **Step 4: 跑確認 pass + type-check**

Run: `cd frontend && npx vitest run src/api/queries.test.ts && npx tsc --noEmit`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/queries.ts frontend/src/api/queries.test.ts
git commit -m "feat(frontend): filter records by kind + fork-tolerant latest-summary query"
```

---

## Task 8: RecordCreate UI — 拍照/上傳分頁 + OCR 串接

**Files:**
- Modify: `frontend/src/patient/RecordCreate.tsx`

> 此 task 為 UI 層,可依 `.claude/rules/frontend.md` 委派 Gemini CLI 產樣式骨架,但 **OCR/加密/狀態邏輯由 Claude 親寫**(涉及 API 串接、auth、商業邏輯)。

**Interfaces:**
- Consumes: `extractText`(ocr.ts)、`geminiGenerate`(gemini.ts)、`createImageRecord`(imagePipeline.ts)、既有 `redact()`、`GEMINI` config

- [ ] **Step 1: 加「拍照/上傳」輸入 + OCR handler**

在現有「語音」流程旁加一個 file input(沿用既有元件 state/JSX 風格,不重寫整檔):

```tsx
<input
  type="file" accept="image/*" capture="environment"
  onChange={async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setOcrBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const text = await extractText({
        image: { bytes, mimeType: file.type },
        language: 'zh-TW',
        gemini: (parts, sys) => geminiGenerate({ apiKey: GEMINI.apiKey, model: GEMINI.model, systemPrompt: sys, parts }),
      });
      setTranscript((prev) => (prev ? prev + '\n' : '') + text); // 填入既有 textarea
      setPendingImage(bytes);                                     // 暫存原圖供建檔
    } catch (err) {
      setError(`OCR 失敗:${(err as Error).message}`);
    } finally {
      setOcrBusy(false);
    }
  }}
/>
```

加 state:`const [pendingImage, setPendingImage] = useState<Uint8Array | null>(null);` 與 `ocrBusy`。

- [ ] **Step 2: handleSubmit 分流 — 有圖走 createImageRecord**

既有 `handleSubmit` 內,`report.redacted` 過閘後分流:

```tsx
const redactedBytes = new TextEncoder().encode(report.redacted);
let recordId: string;
if (pendingImage) {
  ({ recordId } = await createImageRecord({
    redactedText: redactedBytes, image: pendingImage,
    hospitalId, visitTimestampMs: BigInt(Date.now()),
    sealClient, sui: { signAndExecute },
  }));
} else {
  ({ recordId } = await createEncryptedRecord({
    plaintext: redactedBytes, hospitalId, visitTimestampMs: BigInt(Date.now()),
    sealClient, sui: { signAndExecute },
  }));
}
```

(原圖**不**經 redact —— spec 決策。)

- [ ] **Step 3: type-check + 既有測試不破**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`
Expected: 無型別錯、既有測試綠。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/patient/RecordCreate.tsx
git commit -m "feat(patient): photo/upload + OCR in RecordCreate, dual-blob submit path"
```

---

## Task 9: 自動 summary 觸發(建檔後、背景、非阻塞)

**Files:**
- Modify: `frontend/src/patient/RecordCreate.tsx`

**Interfaces:**
- Consumes: `regenerateSummary` + `runSummaryExclusive`(summary.ts)、`queryLatestSummary`(queries.ts)、既有病人自解路徑(`patientPipeline.ts`)、`createEncryptedRecord`(kind=1)、`buildRevokeAnchorTx`/既有 revoke 呼叫

- [ ] **Step 1: 加背景觸發(record 上鏈後、navigate 前不等待)**

`handleSubmit` 拿到 `recordId` 後,**不 await**:

```tsx
void runSummaryExclusive(async () => {
  // 1. 解密該病人所有 active record(seal_approve_owner)→ DecryptedRecord[]
  const decryptedRecords = await loadAllDecryptedRecords(address, sealClient, signer);
  // 2. 找舊 summary
  const revoked = await queryRevokedRecordIds();
  const old = await queryLatestSummary(address, revoked);
  // 3. 生成 + 上鏈
  await regenerateSummary({
    decryptedRecords, language: 'zh-TW', oldSummaryId: old?.recordId ?? null,
    gemini: (prompt) => geminiGenerate({ apiKey: GEMINI.apiKey, model: GEMINI.model, systemPrompt: '', parts: [{ text: prompt }] }),
    createSummaryAnchor: async ({ summaryText, coveredCount }) => {
      const bytes = new TextEncoder().encode(summaryText);
      return createEncryptedRecord({
        plaintext: bytes, hospitalId: 'summary', visitTimestampMs: BigInt(Date.now()),
        kind: 1, coveredCount, sealClient, sui: { signAndExecute },
      });
    },
    revokeOld: async (oldId) => { await signAndExecute(buildRevokeAnchorTx(oldId)); },
  });
});
navigate(`/patient/share/${recordId}`);
```

> `loadAllDecryptedRecords` 若 `patientPipeline.ts` 無現成 helper,在該檔加一個:列 `queryRecordCreatedByPatient`(kind=0)→ 逐筆 `fetchRecordAnchor` + `fetchBlob` + 病人自解 → `{ text, visitMs }[]`。`buildRevokeAnchorTx(recordId)` 若 `api/recordAnchor.ts` 無,加一個包 `CONTRACT.fns.revokeAnchor` 的 PTB builder(args: `tx.object(recordId)`, `tx.object(CLOCK_OBJECT_ID)`)。

- [ ] **Step 2: type-check + 全測試**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`
Expected: 綠。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/patient/RecordCreate.tsx frontend/src/lib/patientPipeline.ts frontend/src/api/recordAnchor.ts
git commit -m "feat(patient): auto-regenerate on-chain summary after each record (background, isolated)"
```

---

## Task 10: Patient Dashboard

**Files:**
- Create: `frontend/src/lib/dashboardQuery.ts`
- Create: `frontend/src/patient/Dashboard.tsx`
- Modify: `frontend/src/patient/Shell.tsx`
- Test: `frontend/src/lib/dashboardQuery.test.ts`

**Interfaces:**
- Consumes: `queryRecordCreatedByPatient`、`queryRevokedRecordIds`、`queryLatestSummary`、`fetchRecordAnchor`
- Produces: `loadDashboard(patient): Promise<DashboardData>` where `DashboardData = { recordCount: number; timeline: { recordId: ObjectId; visitMs: bigint }[]; latestSummary: SummaryRow | null }`

- [ ] **Step 1: 寫失敗測試 — 聚合純函式**

把鏈上資料聚合成 dashboard 的純函式 `buildDashboard(anchors, latestSummary)` 抽出單測:

```ts
import { describe, it, expect } from 'vitest';
import { buildDashboard } from './dashboardQuery';

describe('buildDashboard', () => {
  it('counts records and sorts timeline ascending', () => {
    const anchors = [
      { recordId: '0xa', visitMs: 300n }, { recordId: '0xb', visitMs: 100n },
    ];
    const out = buildDashboard(anchors, { recordId: '0xs', coveredCount: 2n, createdAtMs: 9n });
    expect(out.recordCount).toBe(2);
    expect(out.timeline[0]!.visitMs).toBe(100n);
    expect(out.latestSummary?.recordId).toBe('0xs');
  });
});
```

- [ ] **Step 2: 跑確認 fail**

Run: `cd frontend && npx vitest run src/lib/dashboardQuery.test.ts`
Expected: FAIL。

- [ ] **Step 3: 寫 dashboardQuery.ts**

```ts
import type { ObjectId, SuiAddress } from '../types/contracts';
import { queryRecordCreatedByPatient, queryRevokedRecordIds, queryLatestSummary, fetchRecordAnchor, type SummaryRow } from '../api/queries';

export interface TimelineEntry { recordId: ObjectId; visitMs: bigint; }
export interface DashboardData { recordCount: number; timeline: TimelineEntry[]; latestSummary: SummaryRow | null; }

export function buildDashboard(anchors: TimelineEntry[], latestSummary: SummaryRow | null): DashboardData {
  const timeline = anchors.slice().sort((a, b) => Number(a.visitMs - b.visitMs));
  return { recordCount: anchors.length, timeline, latestSummary };
}

export async function loadDashboard(patient: SuiAddress): Promise<DashboardData> {
  const revoked = await queryRevokedRecordIds();
  const { records } = await queryRecordCreatedByPatient(patient);
  const active = records.filter((id) => !revoked.has(id));
  const anchors: TimelineEntry[] = [];
  for (const id of active) {
    const a = await fetchRecordAnchor(id);
    if (a) anchors.push({ recordId: id, visitMs: BigInt(a.visit_timestamp_ms) });
  }
  const latestSummary = await queryLatestSummary(patient, revoked);
  return buildDashboard(anchors, latestSummary);
}
```

- [ ] **Step 4: 跑確認 pass**

Run: `cd frontend && npx vitest run src/lib/dashboardQuery.test.ts`
Expected: PASS。

- [ ] **Step 5: 寫 Dashboard.tsx + 加路由**

`Dashboard.tsx`(可委派 Gemini CLI 做樣式;資料 hook 由 Claude 寫):用 `useQuery` 呼 `loadDashboard(address)`,顯示:診斷筆數、時間線、`latestSummary.coveredCount` + 「解密摘要」按鈕(走既有 `seal_approve_owner` 自解 `latestSummary.recordId` 的 blob,沿用 patientPipeline 自解 + `fetchBlob`)。

`Shell.tsx`:在病人 nav 加 `<Link to="/patient/dashboard">Dashboard</Link>`,並在 router 加 `<Route path="dashboard" element={<Dashboard />} />`(沿用該檔既有 route 註冊方式)。

- [ ] **Step 6: type-check + 全測試 + 手動開頁**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`
Expected: 綠。手動(使用者終端機 dev server):登入病人 → /patient/dashboard 顯示筆數/時間線,解密摘要可顯示最新 summary。

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/dashboardQuery.ts frontend/src/lib/dashboardQuery.test.ts frontend/src/patient/Dashboard.tsx frontend/src/patient/Shell.tsx
git commit -m "feat(patient): dashboard — record count, timeline, latest summary decrypt"
```

---

## Task 11: Monkey testing + 雙輪 review

**Files:** 無新增(驗證 task)

- [ ] **Step 1: Monkey testing(規則強制)**

逐項手動 + 必要時加 vitest 案例:
- 超大圖(>10MB)/ 非圖檔副檔名偽裝 / 0 byte 圖 → OCR 應乾淨報錯不崩。
- Gemini 回亂碼 / 空字串 / timeout → record 仍建成功,summary 靜默跳過(Task 6 已測,實機再驗)。
- 連續快速建 3 筆 record → summary 不分叉(`runSummaryExclusive` 生效);即使分叉,dashboard 仍取最新(Task 7 已測)。
- OCR 文字含 PII → redaction gate 仍攔截(沿用既有 redactor 測試)。

- [ ] **Step 2: 合約紅隊(動了核心 anchor)**

依 skill-routing 對 `.move` 跑:`move-code-quality` → `sui-security-guard` → `sui-red-team`。重點驗:
1. 非 owner 偽造他人 summary(`patient` 綁 sender)。
2. 偽造 `covered_count`/`kind` 能否影響 `seal_approve`/`consume_grant`(應完全不被信任)。
3. `explainMoveError` 的 `(function:line)` guard test 行號 drift(重部署後更新)。

- [ ] **Step 3: 前端雙輪 review(`/dual-review`)**

round1 codex generic、round2 專案 skills(`sui-frontend`)。整合 findings → 修完。

- [ ] **Step 4: 最終 build + 全測試 + commit**

Run: `cd contracts/portable_health && sui move test && cd ../../frontend && npx tsc --noEmit && npx vitest run`
Expected: 全綠。
更新 `tasks/progress.md` + `tasks/notes.md`(本功能摘要、已知風險)。

---

## Self-Review(對照 spec)

- **Spec coverage:** OCR(T4/T8)、圖文雙 blob 單 anchor A 方案(T1/T5)、圖 PII 不去識別(T8 Step2)、summary 混合鏈上指標+Walrus(T1/T6)、版本鏈(T6/T2)、自動更新非阻塞(T9)、summary 複用 grant(T1 共用 RecordAnchor,無額外 task ✓)、dashboard 病人端(T10)、Gemini provider(T4)、MF1 RecordCreated.kind(T1/T7)、MF2 fork-tolerant(T6 鎖 + T7 選取)、JSON-RPC 隔離(T7 全寫 queries.ts)、測試/monkey/紅隊(T11)。全覆蓋。
- **Placeholder scan:** 無 TBD;UI task(T8/T10)的樣式骨架明示可委派但邏輯有完整 code。
- **Type consistency:** `createEncryptedRecord` 的 `kind/imageBlobId/coveredCount`、`SummaryRow`、`DecryptedRecord`、`pickLatestSummary`/`buildDashboard` 跨 task 命名一致。
