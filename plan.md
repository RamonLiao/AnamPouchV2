# AnamPouch - Overall Project Plan & Milestones (Sui Tool Stacks Edition)

This file outlines the comprehensive vision, milestones, architecture decisions, and current progress for **AnamPouch** (Anamnesis Pouch), focusing exclusively on implementation utilizing the **Sui Tool Stacks**.

---

## 🎯 Project Goal

To build a privacy-first, decentralized, and smartphone-centric medical passport that allows patients to own and manage their complete medical history (voice recording summaries, diagnosis certificates, prescription bags) using client-side encryption, **Sui Network**, and **Walrus Storage** with a zero-friction sharing portal for doctors powered by the official **Sui Tool Stacks**.

---

## 🗺 System Architecture (Sui Tool Stacks)

### 1. Ingestion Layer
*   **Voice Recorder Component:** Captures clinical dialogue -> feeds into a lightweight LLM (3B-8B) -> produces SOAP JSON.
*   **Diagnosis Certificate Component:** Uploads PDFs/images -> OCR + clinical keyword parsing via a lightweight LLM.
*   **Medication Bag Component:** Pill packet OCR -> tracks active substances, daily schedules, and flags drug-drug interactions.

### 2. Cryptographic Sandbox (Browser-level)
*   **Key Derivation:** Patient connects wallet using **Sui dApp Kit** or **Sui zkLogin** -> signs a standard challenge -> derives AES-GCM-256 key via HKDF.
*   **Symmetric Encryption:** Plaintext medical records are encrypted in-memory.
*   **Asymmetric Wrapping (ECIES):** When sharing, the AES key is encrypted using the recipient doctor's public key.

### 3. Decentralized & Blockchain Layer (Sui Native)
*   **Walrus Protocol:** Encrypted payloads (media + medical timeline JSON) are published as immutable blobs on Walrus, Sui's native decentralized storage.
*   **Sui Network (Move 2024):**
    *   `medical_record::Record` Sui Object stores the `blob_id` and cryptographic hashes.
    *   `access_control::Grant` Sui Shared/Owned Object stores the `grant_id`, `doctor_address`, `wrapped_aes_key`, and `revoked` boolean state.
*   **Sui Programmable Transaction Blocks (PTB):** Atomic batched calls (e.g. minting NFT + updating grant record in one gas-efficient block).
*   **SuiNS:** Optional mapping to human-readable names for simplified record querying.

### 4. Zero-Friction Doctor Portal (Sui SDK)
*   **Gateway:** A static web viewer where doctors scan the QR code (containing target `grant_id` and `wrapped_aes_key`).
*   **Sui Sponsored Transactions:** The application sponsors the gas fees using Sui's native gas sponsorship mechanisms, providing a zero-gas, zero-wallet Web2 UX for doctors.
*   **Decryption:** Portal checks Sui blockchain via **Sui TypeScript SDK** for `revoked == false`, fetches the encrypted blob from Walrus, and decrypts it locally in browser memory.

---

## 🗓 Milestone Tracking

### Milestone 1: Core Specs & Documentation 🏁
*   [x] Establish ultimate feature specification in `README.md` (fully focused on Sui Network & Sui Tool Stacks).
*   [x] Create primary `plan.md` notes to maintain long-term memory.

### Milestone 2: Move Smart Contracts (Sui Move 2024) 🧪
*   [ ] Implement `medical_record` module: Create and store health record indices.
*   [ ] Implement `access_control` module: Manage dynamic grants, key routing, and real-time revocation.
*   [ ] Write unit tests for Move modules using official Sui test CLI tools.

### Milestone 3: AI Ingestion & Cryptography 🧠
*   [ ] Configure lightweight LLM (3B-8B) client/API Gateway to support Audio transcriptions, OCR processing for Diagnosis sheets, and drug-interaction warning logic.
*   [ ] Implement browser-side crypto library (HKDF, AES-GCM, ECIES) linked to Sui signature outputs.
*   [ ] Integrate Walrus Publisher/Aggregator SDK to handle large media blobs.

### Milestone 4: Patient Dashboard & Doctor Portal 📱
*   [ ] Build Next.js dashboard containing three main tabs: Today (insights), Records (verifiable timeline), Me (sharing hub) using **Sui dApp Kit**.
*   [ ] Integrate **Sui zkLogin** to provide Web2 social sign-in.
*   [ ] Develop the dynamic QR code generation system.
*   [ ] Build the Doctor Portal: read-only, zero-wallet Web Decryptor with **Sui Sponsored Transactions**.

---

## ⚠️ Key Design Decisions (Steering Committee Highlights)

1.  **Sui Object Model Advantage:**
    *   *Decision:* Instead of utilizing generic EVM mappings, Sui's unique Object Model models medical records as individual digital assets (owned objects), providing superior access controls.
2.  **No Seed Phrase for Patients via zkLogin:**
    *   *Decision:* Integrating Sui zkLogin allows patients to sign in using their Google/Apple credentials. This creates a non-custodial wallet on Sui behind the scenes, delivering Web2 user experiences with Web3 security.
3.  **Sui Sponsored Transactions for Doctors:**
    *   *Decision:* By using Sui's native sponsor-pay system, doctors can view historical medical records without registering a wallet or paying any gas fees, making Web3 onboarding frictionless.
4.  **PTBs for Optimal Gas & Execution Efficiency:**
    *   *Decision:* By batching multiple actions (e.g. minting NFT + updating key routing) into a single Programmable Transaction Block (PTB), we significantly optimize the latency and gas costs on Sui.

---

## 🚧 Current Status & Next Steps

*   **Done:** Defined ultimate product scope, designed architecture flow, updated primary `README.md` to highlight the Sui Tool Stacks (using lightweight LLM), and initialized `plan.md`.
*   **TODO for Next Chat:** Proceed to Milestone 2 (Sui Move Smart Contracts). Initialize `move-notes.md` and start drafting the Move modules in `/contracts` or `/move`.
