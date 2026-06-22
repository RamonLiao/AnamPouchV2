# Notes — open decisions

## 2026-06-21 — Revoke on expired grants (DECIDED option 1, revisit later)

**Context:** `isRevocable()` (`frontend/src/lib/grantStatus.ts`) controls whether the
Revoke button shows. The "Expired" status is derived from the **client clock**
(`Date.now()` vs `expires_at_ms`), NOT chain time. On-chain, `revoke_grant`
(access_grant.move:204-206) asserts only `!used && !revoked` — it does NOT check
expiry; `consume_grant` is the one that enforces expiry via the on-chain `Clock`.

**Trade-off:**
- Normal clock: client "Expired" == chain expired → doctor can't consume → revoke
  is a pointless gas-burning no-op. Hiding it = cleaner UX.
- Fast client clock: client shows "Expired" while the grant is STILL consumable
  on-chain → doctor can consume → hiding Revoke strands the patient's last
  defense.

**Decision (2026-06-21): Option 1 — hide Revoke on expired.** Accepted the narrow
fast-clock stranding risk for cleaner demo UX. `isRevocable` returns
`status === 'active'` only.

**Option 2 (deferred, discuss later):** Stop using the client clock to label
expiry at all — never show an "Expired" badge, let the chain be the sole expiry
authority, and keep Revoke always available for non-terminal grants. Removes the
"Expired but Revoke-able" UX contradiction without dropping the defense. Revisit
if the fast-clock attack surface becomes part of the security pitch.

History: session-21 dual-review originally chose "expired stays revocable"; the
f5ece1e frontend commit silently reverted it to option 1; after discussion we
confirmed option 1 intentionally and recorded option 2 here.

## 2026-06-22 — Image+OCR + on-chain summary + patient dashboard (SHIPPED on branch feat/image-ocr-summary-dashboard)

**Spec/Plan:** docs/superpowers/specs/2026-06-21-image-ocr-summary-dashboard-design.md / docs/superpowers/plans/2026-06-21-image-ocr-summary-dashboard.md

**What shipped (18 commits, SDD per-task review + opus final review):**
- Contract: RecordAnchor +kind/image_blob_id/covered_count, RecordCreated +kind. summaries = kind=1 versioned anchors (create new + revoke old). seal_approve/grant UNCHANGED.
- Image+OCR: Gemini OCR → text into redaction gate; image+text encrypted under SAME content_hash (scheme A), dual Walrus blobs, single anchor. Image now decryptable+viewable (RecordList "Decrypt image", owner path).
- Summary: auto-regenerated background after each record (failure-isolated, chained-promise exclusive lock); dashboard reads fork-tolerant latest (max created_at_ms, excl. tombstoned).
- Dashboard: /patient/dashboard — record count, timeline, decrypt latest summary.

**KEY DEPLOY FACT:** Move `compatible` upgrade FORBIDS struct field additions → had to FRESH PUBLISH. New package (original==published): 0x3be04d04f71d4d5c8afcbc8e8815c42fd25ff76ccdb3f2a1d9cef878eb0ff198. UpgradeCap 0x3b9ab4e9...  Old testnet records undecryptable (Seal namespace changed) — recreate demo data. .env.local updated; RESTART vite dev server.

**Verification:** Move 46/46, vitest 99/99, tsc 0 errors. Red-team 0 vulns (R11-R15 all defended). Monkey testing found+fixed orphan-blob-on-empty-text bug.

**Deferred (not blockers):** doctor-side image view (only patient now); debounce/indexer for summary event volume; SessionKey-per-record perf; pre-existing redactor.test.ts process.exit + its internal "1 fail" case (redact() is our OCR security gate — worth investigating separately).
