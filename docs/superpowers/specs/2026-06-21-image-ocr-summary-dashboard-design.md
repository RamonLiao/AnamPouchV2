# Image+OCR、Summary、Patient Dashboard — Design

Date: 2026-06-21
Status: Approved (brainstorming) → pending implementation plan

## 目標

在現有 AnamPouchV2(Sui + Walrus + Seal 病歷 dApp)上加三件事:

1. **拍照/上傳圖片 + OCR**:解析圖片文字,原圖與 OCR 文字都加密存 Walrus、Seal 控管。
2. **鏈上健康總結(Summary)**:每次新增診斷自動更新,存鏈上 + Walrus,Seal 控管,可透過現有 grant 分享給醫生。
3. **病人 Dashboard**:統整分析病人所有資料(病人端先做)。

分享/grant 邏輯**完全複用現有機制**(summary 與圖文 record 都是 `RecordAnchor`)。

## 決策總表

| 項目 | 決定 | 理由 |
|---|---|---|
| OCR | 雲端 Gemini(複用 `aiProvider.ts`) | 中文/手寫/表格辨識佳;日後換本地 LLM 強化隱私 |
| 圖文存法 | 2 個 blob(原圖、OCR文字)、1 個 anchor | 原圖可驗、文字可搜;共用一個存取政策 |
| 圖片 PII | 原圖不去識別,靠 Seal 加密+grant 保護 | 被授權者本就該看全貌;OCR 文字仍走 redaction |
| Summary 內容 | 混合:鏈上可驗證指標 + Walrus 加密長摘要 | 鏈上放可驗證計數/時間,自然語言摘要加密存 Walrus |
| Summary 更新 | 版本鏈:每次新 anchor、舊 tombstone | 複用 `create_anchor`+`revoke_anchor`,零 mutable 邏輯 |
| Summary 觸發 | 每次新增 record **自動**更新(背景、非阻塞) | UX 無感;失敗不毀建檔 |
| Summary 分享 | 複用現有 grant | summary 就是一種 `RecordAnchor` |
| Dashboard | 病人端先做(`seal_approve_owner` 自解) | 零新合約風險;醫生端日後再評估 |
| Provider | Gemini | 複用既有 adapter,最少新依賴 |
| 圖的 IBE id | **A 方案**:圖與文字共用 `content_hash` 當 Seal id | 零合約改動、零新攻擊面;完整性由 Walrus content-addressed blobId 保證 |

### A vs B(IBE id)決策記錄

- **A(採用)**:原圖也用 record 的 `content_hash`(=文字 hash)當 IBE id 加密。一個 record 的圖與文字共用同一 Seal 存取政策,`seal_approve` 完全不改。
- **B(否決)**:鏈上多存 `image_hash`,`seal_approve` 改成接受 `id ∈ {content_hash, image_hash}`。
- **否決理由**:B 的唯一好處(IBE id == 自身內容 hash 的自證完整性)A 已透過 Walrus content-addressed blobId + anchor 存死 `image_blob_id` 達成;B 卻在最該紅隊的 `seal_approve` 加分支與新攻擊面,換取 0 安全增益(圖文本就同 record、同存取政策)。正確心智模型:**Seal IBE id = record 的存取政策身分,非 blob 內容身分**;多 blob 時圖文共用 id 是正確一般化。

## Section 1 — 合約改動(schema,需重部署 testnet)

`RecordAnchor`(`contracts/portable_health/sources/record_anchor.move`)加 3 欄位:

```move
public struct RecordAnchor has key, store {
    // ...現有欄位不動...
    kind: u8,                  // 0 = record, 1 = summary
    image_blob_id: vector<u8>, // 原圖 blob;text-only / summary 留空
    covered_count: u64,        // kind=summary 時 = 濃縮幾筆診斷;record 恆 0
}
```

- `create_anchor` 多收 `kind`、`image_blob_id`、`covered_count` 三參數。現有文字 caller 傳 `kind=0, image_blob_id=空, covered_count=0`。
- **不新增 mutable update fn**。Summary 更新 = `create_anchor(kind=1,...)` 生新的 + `revoke_anchor(舊)`。
- `seal_approve` / `seal_approve_owner` / `access_grant` / `decryption_ticket` **全部不動**。
- 新增事件 `SummaryUpdated { record_id, patient, covered_count, created_at_ms }`,前端用它查「最新 summary」。
- `kind` / `covered_count` 為純展示欄位,**不得**被 `seal_approve` / `consume_grant` 信任(access control 不依賴它們)。

## Section 2 — 前端 pipeline / OCR 流程

新增/改動:

```
lib/ocr.ts            (新) Gemini vision: image → 結構化文字
lib/imagePipeline.ts  (新) 圖文雙 blob 上傳 + 單 anchor
lib/summary.ts        (新) 聚合所有 record → Gemini 摘要 → 加密上傳 → 新 anchor + revoke 舊
lib/aiProvider.ts     (改) 確認 Gemini adapter 支援 vision 入參
lib/recordPipeline.ts (改) createEncryptedRecord 多收 imageBlobId/kind/coveredCount
api/recordAnchor.ts   (改) create_anchor PTB 多傳 3 參數
```

### 圖文 record 建立(RecordCreate 加「拍照/上傳」分頁)

```
拍照/選圖 (input capture="environment")
  → ocr.extractText(image)            [Gemini vision]
  → 文字填入 textarea(沿用既有 redaction gate,使用者可編輯)
  → redact(text) 過閘
  → 平行:
       a. encrypt(redactedText, id=content_hash=sha256(text)) → uploadBlob → textBlobId
       b. encrypt(originalImage,  id=content_hash)            → uploadBlob → imageBlobId
  → create_anchor(kind=0, content_hash, walrus_blob_id=textBlobId,
                   image_blob_id=imageBlobId, covered_count=0)
```

注意:anchor 的 `content_hash` / IBE id 綁文字(主體可搜尋驗證);原圖用**同一個** `content_hash` 當 IBE id 加密(A 方案)。解密時(owner 或 grant ticket)兩個 blob 共用同一 `seal_approve` 即可解。

### Summary 生成(每次新增 record 後自動、背景、非阻塞)

```
解密病人所有 active record(seal_approve_owner)
  → Gemini 生摘要(用藥史 / 過敏 / 慢性病趨勢 / 時間線)
  → encrypt(summaryText, id=sha256(summaryText)) → uploadBlob
  → create_anchor(kind=1, content_hash=sha256(summary), walrus_blob_id,
                   image_blob_id=空, covered_count=N)
  → 若有舊 summary anchor → revoke_anchor(舊)
```

- record 上鏈 + 導到 share 頁照舊;summary 更新背景跑。
- summary 更新失敗**不得**讓 record 建立失敗(僅 log / 角落提示)。
- **並發防護**:summary 更新加前端鎖(同時只跑一個),後到的排隊用最新狀態重生,避免版本鏈分叉。
- demo 量級先不做 debounce。

## Section 3 — Patient Dashboard

新頁 `/patient/dashboard`(PatientShell 加 tab):

```
DashboardPage
  → 讀鏈上該病人所有 active RecordAnchor(kind=0)+ 最新 summary anchor(kind=1)
  → 鏈上可驗證區(免解密):診斷筆數、covered_count、時間線(visit_timestamp)、最後更新
  → 「解密摘要」按鈕 → seal_approve_owner 自解最新 summary → 顯示自然語言濃縮
  → 趨勢/統計:診斷頻率時間軸(用鏈上 timestamp,免解密即可畫)
```

元件:`patient/Dashboard.tsx` + `lib/dashboardQuery.ts`(查 + 聚合 anchor,純鏈上資料免解密)。

## Section 4 — 測試策略

### Move(`sui move test`)
- `create_anchor` 新參數:`kind=1` / `image_blob_id` 非空 路徑建出正確 anchor。
- summary 版本鏈:create summary → revoke 舊 → 舊 tombstone 後 `seal_approve` 該 fail(複用 cascade 測試模式)。
- 紅隊(`sui-red-team`,動了核心 anchor):
  1. 非 owner 呼叫 `create_anchor` 偽造他人 summary?(`patient` 綁 sender,驗)
  2. `covered_count` / `kind` 偽造能否繞過檢查?(驗 seal_approve / consume_grant 不信任這些欄位)
  3. 重部署後 `explainMoveError` 的 `(function:line)` 映射 drift(既有 guard test 更新行號)。

### 前端(vitest,注入式 pipeline 測法,不碰真 SDK)
- `ocr.ts`:mock Gemini,驗 image→text 抽取 + 失敗回傳。
- `imagePipeline.ts`:雙 blob 上傳順序、anchor 參數正確。
- `summary.ts`:聚合→生成→新 anchor→revoke 舊 順序;**summary 失敗不拋給 record 建立**(Rule 9:測 intent)。
- IBE id A 方案:驗圖與文字 blob 都用同一 `content_hash` 加密。

### Monkey testing
- 超大圖 / 非圖檔 / OCR 回空 / Gemini 回亂碼 / 連續快速建多筆 record(summary 自動更新 race → 版本鏈分叉;由前端鎖防護)。

## 風險與已知限制

- 重部署 testnet → 舊 record 不受影響,但 `frontend/.env.local` 的 `VITE_PORTABLE_HEALTH_PACKAGE_ID` 要更新為新 `published-at`,且 dev server 必須重啟(見 lessons 2026-05-02)。
- `explainMoveError` 的行號映射綁 deployed source map,重部署改行號要更新 guard test。
- Gemini API key 需放 `VITE_*`(前端可見)→ demo 可接受;production 應走後端代理(deferred)。
- 原圖明文出裝置(送 Gemini OCR)違反 e2e 加密前提 → 已知,選雲端時接受;日後本地 LLM 解決。
- 自動 summary 每次新 record = 解密全部 + 1 LLM call + 2 交易,資料量大時成本上升(deferred:debounce / 增量摘要)。
