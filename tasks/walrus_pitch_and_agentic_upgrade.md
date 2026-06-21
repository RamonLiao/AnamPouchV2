# AnamPouch — Walrus Pitch 重點與 Agentic 升級方向

## 1. 賽道定位

**主投賽道：Walrus**

AnamPouch 不是單純把病歷放上去中心化儲存，而是建立一個由患者擁有、可驗證、具隱私控制，並能供 AI 長期使用的健康記憶層。

Walrus 是產品不可替代的核心：

- 儲存加密後的病歷、錄音、文件及影像。
- 讓健康資料脫離單一醫院或平台，成為患者可攜帶的長期記憶。
- 與 Sui 鏈上 hash anchor 結合，證明資料來源及完整性。
- 與 Seal、Move AccessGrant 結合，實現限時、單次使用及可撤銷的解密權限。
- 為後續健康 Agent 提供跨時間、跨醫療機構的可信資料基礎。

**Web Agentic 是產品能力與未來升級方向，不是目前最適合申報的主賽道。**

---

## 2. 一句話 Pitch

### 英文

> AnamPouch is a patient-owned, privacy-preserving health memory layer for AI agents, powered by encrypted Walrus storage and policy-controlled access on Sui.

### 中文

> AnamPouch 是患者自主擁有的隱私健康記憶層，透過 Walrus 保存加密醫療資料，並利用 Sui 與 Seal 控制 AI 和醫療人員何時能存取。

---

## 3. 30 秒 Pitch

Patients visit different clinics, but their medical history remains fragmented across incompatible systems. Existing AI health products make this worse by asking patients to upload their most sensitive information into centralized clouds.

AnamPouch turns every consultation, report, and medication record into encrypted, patient-owned health memory. Medical content is structured by AI, encrypted in the browser, stored on Walrus, and anchored on Sui for integrity. Patients can grant a doctor time-limited, single-use access through a QR link, while Seal and Move enforce the permission at the decryption layer.

The result is a portable health memory that patients control today and trusted health agents can safely use tomorrow.

---

## 4. 核心問題

目前醫療資料存在三個結構性問題：

1. **資料碎片化**
   - 病歷分散在不同診所、醫院、紙本文件及藥袋中。
   - 患者通常無法取得完整、可攜且易於理解的醫療歷史。

2. **AI 隱私風險**
   - 中央化 AI 服務要求患者上傳敏感資料。
   - 患者無法控制資料保存位置、保存期限及後續用途。

3. **分享權限不足**
   - 傳統 PDF、訊息或雲端連結一旦分享便難以撤回。
   - 缺乏可驗證的存取紀錄、到期機制與最小權限控制。

---

## 5. 解決方案

AnamPouch 將非結構化醫療資料轉換成患者擁有的可驗證健康記憶：

```text
醫療對話、PDF、藥袋影像
        ↓
AI 轉錄與結構化
        ↓
患者確認內容
        ↓
瀏覽器端加密
        ↓
加密內容存入 Walrus
        ↓
Hash、Blob ID 與政策錨定到 Sui
        ↓
Seal 依 Move 政策控制解密
```

患者不需要相信 AnamPouch 伺服器會妥善保管明文病歷，因為產品設計上不需要讓伺服器持有明文。

---

## 6. Why Walrus

AnamPouch 需要的不只是檔案儲存，而是能支撐長期 AI 記憶的資料層。

### Walrus 在產品中的作用

- 保存醫療紀錄的大型加密 payload。
- 讓不同應用與未來 Agent 透過同一筆可信資料協作。
- 避免健康記憶被單一 SaaS 平台鎖定。
- 讓鏈上只保存 hash、Blob ID、時間與權限，不公開 PHI。
- 配合 Sui object model 建立資料、擁有者與授權間的關係。

### 如果沒有 Walrus

- 資料仍會回到中央化資料庫或單一雲端帳號。
- AI 記憶無法成為患者可攜、跨工具的資產。
- 無法形成「加密內容＋鏈上完整性＋政策解密」的完整可信鏈。

因此 Walrus 不是附加整合，而是 AnamPouch 的 persistent health memory layer。

---

## 7. Sui 技術差異化

| 技術 | AnamPouch 中的用途 |
|---|---|
| Walrus | 儲存加密病歷、文件及多媒體內容 |
| Seal | 根據鏈上政策釋放解密能力 |
| Move objects | 表達病歷錨點、授權及解密票證 |
| Sui Clock | 強制執行授權期限 |
| PTB | 原子化建立病歷錨點與授權操作 |
| zkLogin | 讓患者及醫師用既有帳號登入 |
| Enoki Sponsored Transactions | 降低醫師使用及鏈上操作門檻 |
| gRPC / Sui reads | 查詢病歷、物件與交易狀態 |

核心安全特性：

- 病歷明文不上鏈。
- 授權只能使用一次。
- 過期後 Seal key server 不應釋放解密材料。
- 患者可以撤銷尚未使用的授權。
- 每次建立、分享與使用都有鏈上可驗證軌跡。

---

## 8. Demo 故事線

建議 Demo 聚焦一條完整且容易理解的患者旅程。

### Step 1：建立健康記憶

患者使用 Google 登入，錄製看診內容或上傳醫療文件。AI 將內容整理為結構化病歷，患者可以在儲存前確認。

### Step 2：加密與驗證

病歷在瀏覽器內加密，加密 payload 上傳 Walrus，hash 與 Blob ID 透過 PTB 錨定到 Sui。

畫面應明確顯示：

- Walrus Blob ID
- Sui transaction digest
- Integrity verified
- No plaintext on-chain

### Step 3：分享給醫師

患者建立一個有期限、單次使用的分享 QR 或 deep link。

醫師登入後：

1. consume AccessGrant；
2. 取得 DecryptionTicket；
3. Seal 驗證鏈上政策；
4. 讀取 Walrus ciphertext；
5. 在瀏覽器記憶體中解密並顯示。

### Step 4：證明安全性

再次開啟同一連結，系統在簽名前或鏈上執行時拒絕重放。

如果時間允許，再展示：

- 過期授權拒絕解密；
- 患者撤銷授權；
- 改動 ciphertext 後 integrity verification 失敗。

### Demo 結尾

> The patient does not send a medical file to a doctor. The patient grants temporary, verifiable access to encrypted health memory they own.

---

## 9. 評審可能提問

### 為什麼不用一般雲端資料庫？

一般雲端資料庫仍由平台控制。AnamPouch 的目標是讓健康記憶跨醫院、跨應用及跨 Agent 持續存在，而且不依賴 AnamPouch 公司永久營運。

### 為什麼需要區塊鏈？

鏈上不保存病歷內容，而是保存完整性證明、擁有關係、授權狀態、期限與使用紀錄。這些資訊必須由患者和醫師共同驗證，不能只相信平台資料庫。

### Walrus 上的資料是公開的嗎？

Walrus 保存的是 ciphertext。沒有符合 Seal policy 的解密能力，取得 blob 並不等於取得病歷。

### 撤銷後，已看過的醫師能忘記內容嗎？

不能。任何人看到明文後都可能記錄內容。撤銷的實際保證是阻止未來重新取得解密材料，而不是讓接收者遺忘已經看過的資料。

### 這是否已經符合 HIPAA、GDPR 或醫療法規？

目前是展示 privacy-by-design 與可驗證權限的技術產品，不應宣稱已取得法規認證。正式進入醫療市場仍需要資料處理、同意、刪除權、保存政策與醫療器材分類等法律審查。

### AI 會不會提供錯誤醫療建議？

MVP 應將 AI 定位為資料整理、風險提示與決策支援，而不是自主診斷。所有高風險輸出應顯示來源、信心、限制，並要求患者或醫療人員確認。

---

## 10. Agentic 升級願景

目前 AI 主要負責單次資料結構化與問答。下一階段應把它升級為持續使用患者健康記憶、但受明確權限約束的健康 Agent 系統。

Agentic 升級的原則：

> Agent can observe, reason, and propose. High-impact actions still require explicit human approval.

不應讓 Agent 自主進行診斷、修改病歷、授權第三方或執行醫療決策。

---

## 11. 建議的 Agent 能力

### 11.1 Health Memory Agent

負責將新資料與歷史病歷整合，而非每次只處理單一文件。

能力：

- 將新看診內容連結到既有症狀、疾病與用藥。
- 偵測病歷中的矛盾或重複資訊。
- 建立時間軸摘要。
- 回答「最近三個月有哪些變化」等跨紀錄問題。
- 每一項回答附上來源 RecordAnchor 與 Walrus blob reference。

這是最優先升級，因為它直接強化 Walrus 的長期記憶價值。

### 11.2 Medication Safety Agent

持續監控患者的用藥紀錄：

- 找出重複成分。
- 提示可能的藥物交互作用。
- 比對過敏史與新處方。
- 發現劑量或服用頻率矛盾。
- 產生「需要詢問醫師」的問題清單。

安全限制：

- 只能提示風險，不能指示停藥或自行改變劑量。
- 必須顯示資料來源及知識庫版本。
- 高風險警示應要求藥師或醫師確認。

### 11.3 Care Coordinator Agent

把多筆醫療事件轉成患者可以執行的後續工作：

- 建立回診與檢查提醒。
- 整理醫師要求的後續事項。
- 在患者授權後產生分享請求。
- 提醒病歷缺少必要檢查結果。
- 產生下次看診前的問題清單。

第一版只建立草稿或建議，不自動向醫療機構發送資料。

### 11.4 Clinical Review Agent

為醫師提供有限範圍的病歷閱讀助手：

- 在授權期限內產生病史摘要。
- 標記近期用藥、過敏與重大變化。
- 對每項結論提供原始紀錄引用。
- 授權結束後清除本地 session 與衍生內容。

患者 Agent 與醫師 Agent 必須使用不同權限，不應共享完整資料視野。

### 11.5 Consent Guardian Agent

協助患者理解分享行為：

- 用白話解釋醫師將取得哪些資料。
- 檢查分享範圍是否過大。
- 建議適當 TTL。
- 在送出交易前顯示風險摘要。
- 發現異常分享頻率或陌生接收者時要求再次確認。

這個 Agent 很適合結合 Sui policy 與 human-in-the-loop，能補強 Web Agentic 敘事。

---

## 12. Agentic 工作流程

建議將 Agent 行為設計成以下狀態機：

```text
Observe
  ↓
Retrieve authorized records
  ↓
Verify integrity and provenance
  ↓
Reason over scoped health memory
  ↓
Generate proposal with citations
  ↓
Policy check
  ↓
Human approval
  ↓
Execute permitted action
  ↓
Write audit artifact to Walrus
  ↓
Anchor action receipt on Sui
```

每次 Agent 執行都應產生：

- 使用了哪些 RecordAnchor；
- 讀取了哪些 Walrus blobs；
- 使用的模型與版本；
- 推理輸出的 hash；
- 使用者是否批准；
- 最終執行了什麼動作；
- 哪些敏感資料被分享。

---

## 13. Agent 權限模型

不要讓 Agent 直接持有無限制患者權限。建議新增 `AgentMandate` Move object。

概念欄位：

```text
AgentMandate
- owner
- agent_id
- allowed_record_scopes
- allowed_actions
- expires_at
- max_uses
- requires_confirmation
- revoked
```

建議 action 分級：

| 等級 | 行為 | 是否需要確認 |
|---|---|---|
| Read | 讀取指定紀錄、建立摘要 | 可由短期 mandate 授權 |
| Suggest | 建議提醒、問題清單、分享範圍 | 不直接執行 |
| Prepare | 建立交易或授權草稿 | 必須確認後才能送出 |
| Execute | 發布授權、分享資料或寫入紀錄 | 必須明確人工批准 |
| Prohibited | 診斷、改藥、無限期授權、刪改原始病歷 | 不允許 |

---

## 14. Agent Artifact 設計

Walrus 不應只保存原始病歷，也應保存 Agent 產生的可驗證 artifact：

- Health timeline summary
- Medication risk report
- Pre-visit briefing
- Doctor review summary
- Consent risk card
- Agent execution receipt

每個 artifact 應包含：

```json
{
  "artifactType": "medication-risk-report",
  "sourceRecordIds": ["0x..."],
  "sourceBlobIds": ["..."],
  "model": "model-name-and-version",
  "createdAt": 0,
  "patientApproved": false,
  "content": {},
  "contentHash": "..."
}
```

原始病歷與 Agent 衍生內容必須分開保存，避免 AI 輸出被誤認為醫療事實。

---

## 15. Agentic 升級優先級

### Phase 1：強化 Walrus Pitch

- 完善 patient → Walrus → Sui → doctor E2E。
- 補上 revoke demo。
- 顯示 blob、hash、transaction 與 Seal policy 驗證資訊。
- 把 AI 回答連回來源病歷。
- 明確區分原始病歷與 AI 衍生摘要。

### Phase 2：Persistent Health Memory

- 實作跨紀錄檢索。
- 建立 Health Memory Agent。
- 產生有引用來源的時間軸摘要。
- 將 Agent artifact 加密儲存到 Walrus。
- 在 Sui 上錨定 artifact hash 與來源關係。

### Phase 3：Human-in-the-loop Agent

- 實作 Medication Safety Agent。
- 實作 Consent Guardian。
- 建立 proposal → review → approve 流程。
- Agent 只能準備交易，患者確認後才簽署。

### Phase 4：On-chain Agent Mandate

- 新增 `AgentMandate` Move module。
- 限制資料範圍、動作、期限與使用次數。
- 建立 revoke、expiry 與 audit events。
- Agent 執行結果形成 Walrus artifact＋Sui receipt。

### Phase 5：Multi-agent Care Workflow

- Health Memory Agent 整理歷史。
- Medication Agent 進行風險檢查。
- Care Coordinator 產生後續計畫。
- Consent Guardian 檢查分享範圍。
- 人類批准後才執行鏈上授權或外部動作。

---

## 16. Hackathon 前建議完成項目

### Must Have

- 穩定展示加密寫入 Walrus。
- 穩定展示鏈上 anchor。
- 穩定展示 doctor consume＋Seal decrypt。
- 展示 single-use replay rejection。
- README 與簡報不再描述已完成但實際未完成的功能。
- 預先準備有 gas、有效 session 與測試資料的 demo 帳號。

### High Value

- Revoke UI 與 revoke 後拒絕解密。
- Agent 回答附上病歷來源引用。
- 顯示 Walrus blob integrity verification。
- 加入一個跨多筆病歷的 Health Memory Agent demo。
- 產生並保存一份 Agent artifact。

### Post-Hackathon

- 完整 AgentMandate。
- 多代理協作。
- PWA 與離線模式。
- 醫院／醫師身份註冊與驗證。
- 法規、刪除權及資料保存政策。
- 臨床知識來源版本化與醫療安全評估。

---

## 17. 不應過度宣稱的內容

Pitch 與 Demo 應避免以下說法：

- 「完全符合 HIPAA／GDPR／醫療法規」
- 「AI 可以診斷疾病」
- 「撤銷可以讓已看過資料的人忘記」
- 「所有 AI 都在本地執行」——若 demo 實際使用 OpenAI 或 Gemini
- 「醫師完全不需要 gas」——若 Sponsored Transactions 尚未在展示流程中穩定完成
- 「病歷不可轉讓」——如果 `RecordAnchor` 仍具有 `store` 且未凍結

更安全的表述：

- privacy-preserving architecture
- patient-controlled access
- verifiable integrity and provenance
- decision support, not medical diagnosis
- designed for future compliance review
- encrypted data portability

---

## 18. 最終 Pitch 結構

建議簡報依以下順序：

1. 患者的醫療記憶被困在不同醫療機構。
2. 中央化 AI 又要求患者交出最敏感的資料。
3. AnamPouch 把資料轉成患者擁有的加密健康記憶。
4. Walrus 保存內容，Sui 證明完整性，Seal 強制存取政策。
5. 現場展示建立、驗證、分享、解密與 replay rejection。
6. 下一步讓健康 Agent 在患者授權下持續使用這份記憶。
7. 結尾強調：Walrus 讓 AI memory 成為患者資產，而不是平台資產。

### Closing line

> Walrus gives AI persistent memory. AnamPouch makes sure that health memory belongs to the patient.

