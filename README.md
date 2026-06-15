# AnamPouch 🎒🩺

> **A privacy-first, smartphone-centric AI medical assistant that empowers patients with true data sovereignty through browser-based encryption, lightweight LLM (3B-8B) structures, and Sui tool stacks verified on Walrus storage.**

---

### What's in a Name? 🎒
* **Anamnesis** (Greek for *reminiscence* / clinical medical history): Representing our AI core that structures scattered clinical dialogues, paper reports, and drug lists into permanent health memory.
* **Pouch** (a secure, lightweight portable wallet): Embodying our Web3 architecture where patient data is securely locked under client-side crypto keys, stored natively on Sui/Walrus, and carried with ultimate sovereignty.

---

## The Business Pain Point & Our Solution

**The Pain Point:** 
Modern healthcare is plagued by fragmented data silos across different clinics, leaving patients without a unified, accessible medical history. Furthermore, capturing comprehensive consultation dialogue, paper diagnosis reports, and complex medication labels, and sending them to the cloud for AI analysis raises severe privacy, security, and regulatory compliance concerns.

**Our Solution:** 
AnamPouch returns medical data ownership to the patient by establishing a sovereign digital medical passport. By allowing patients to record doctor consultations, upload PDF diagnosis certificates, and capture medicine bag images, the application leverages a lightweight LLM (3B-8B) to structure this data entirely client-side. The compiled reports are encrypted inside the browser using keys derived from the patient's **Sui Wallet**, stored permanently on **Walrus Protocol** (Sui's native decentralized storage), and anchored to the **Sui Blockchain**. This completely eliminates cloud privacy risks and hospital data silos while keeping the patient in absolute control.

## System Architecture

Our platform employs a **Sui-Native Hybrid Architecture** (Browser Cryptography + Sui Tool Stacks + Walrus Storage) to guarantee absolute privacy and trust:

*   **Multimodal AI Medical Processing:** Consultations are recorded and transcribed, paper certificates are digitized, and pill bags are scanned. The client-side application integrates a lightweight LLM (3B-8B) to parse and structure raw text, PDF documents, and image assets into unified clinical JSON reports.
*   **Zero-Trust Browser Storage & Cryptography:** Utilizing the official **Sui dApp Kit** and **Sui zkLogin**, the patient signs in using traditional Google/Apple OAuth to derive a non-custodial wallet. The patient signs a deterministic challenge to derive a local AES-GCM-256 key via HKDF. All structured reports and large multimedia files are encrypted in-memory and published directly to **Walrus Protocol** using the Walrus SDK.
*   **Sui Move Contract Immutability:** Using the **Sui CLI**, we deploy highly secure **Sui Move 2024 Edition** smart contracts. Key metadata, Walrus Blob IDs, and record hash fingerprints are anchored to the Sui Blockchain using **Sui Programmable Transaction Blocks (PTB)** to guarantee immutability, data origin, and tamper-proof auditing.
*   **Ephemeral Dynamic Authorisation:** To share records, the patient encrypts the AES key using the doctor's public key (via ECIES). This grant is written to the Sui blockchain. Doctors use a zero-friction Web Viewer to access the record. With **Sui Sponsored Transactions**, gas is paid by the application, meaning doctors scan the QR code and view decrypted data instantly—**no wallet, no app, and no gas required**. The patient can instantly call our Sui Move contract to flag the grant as `revoked`, terminating access globally in sub-seconds.

## Core Features

*   **Home Dashboard & Insights:** A daily overview powered by **Sui dApp Kit** displaying medication calendars, scheduled doses, and personalized AI health insights based on chronological medical trends.
*   **Multimodal AI Ingestion:** A recording, uploading, and camera interface that transcribes conversations into SOAP notes, OCRs paper clinical diagnoses, and parses medicine bags to cross-reference drug-to-drug interactions.
*   **Verifiable Medical Timeline on Walrus:** A chronological "Portable Record" timeline pulling encrypted payloads from Walrus, complete with Sui blockchain verification badges (Sui Transaction Hash) to prove absolute integrity and origin.
*   **Granular Sui Move Access Management:** A secure sharing hub utilizing Sui Move objects to issue granular, time-locked data access grants. Patients control who views their records, with the ability to instantly revoke access on-chain at any moment.
*   **Local AI Health Assistant:** A private conversational agent resolving queries based on the patient's decrypted Walrus records (e.g. "Will this prescribed medicine interact with my current pills?") without transmitting any unencrypted details to third-party servers.

## Live Demo & Deployment

* **App:** https://anam-pouch.vercel.app
* **Network:** Sui **testnet**
* **Package (current, v2):** [`0x003541284dfd4ff30719150942dda62970c1643d4d5fa7abf6183819c903bbd5`](https://testnet.suivision.xyz/package/0x003541284dfd4ff30719150942dda62970c1643d4d5fa7abf6183819c903bbd5)
* **Original package (v1, Seal namespace + event/type matching):** `0x42a2d8ebcc940f2a5866fa59c5e8b1fcde3f095f9b8736f143c85f55c2110b01`
* **Modules:** `record_anchor` · `access_grant` · `decryption_ticket` · `errors`

### Try it in 90 seconds

1. Open the app, sign in with **Google** (Sui zkLogin — no seed phrase, no wallet extension).
2. Record / upload a consultation. The lightweight LLM structures it into a clinical JSON report.
3. Watch **Encrypt & Anchor** run: AES-GCM in the browser → Walrus blob → `create_anchor` PTB lands on-chain.
4. Open the **Verifiable Timeline** to see the record with its Sui transaction hash.
5. **Share with a doctor:** issue a time-boxed `access_grant`; the doctor opens the QR-linked web viewer — **no wallet, no app, no gas** (Enoki Sponsored Transactions).
6. **Revoke** in one tap → `revoke_grant` flips the grant on-chain; the viewer loses access in sub-seconds.

## Stack

| Layer | Choice |
|---|---|
| Frontend | React + Vite, **Sui dApp Kit** |
| Auth | **Sui zkLogin** (Google/Apple OAuth) via **Enoki**, ZKP proxied server-side so the API key never reaches the client |
| AI | Lightweight LLM (3B–8B), client-side multimodal (audio → SOAP, PDF OCR, pill-bag vision) |
| Crypto | Browser AES-GCM-256, key via HKDF from a deterministic Sui signature; **Seal** threshold encryption for doctor access control |
| Storage | **Walrus Protocol** (Sui-native decentralized blob storage) |
| Chain | **Sui Move 2024 Edition**, deployed via Sui CLI, anchored with **PTBs** |
| Gas (doctor) | **Enoki Sponsored Transactions** — app pays, doctor pays nothing |

## On-Chain Access Control (already implemented)

Time-boxed access is **enforced on-chain by Move + the Sui `Clock`**, not by an external scheduler or best-effort cron:

* `access_grant::issue_grant` stamps `expires_at_ms = now + ttl_ms`.
* `access_grant::consume_grant` asserts `now < expires_at_ms` (else `EGrantExpired`) and is single-use.
* `record_anchor::seal_approve` (the Seal key-server policy check) re-validates the decryption ticket's expiry on every decrypt — so an expired or revoked grant **fails at the key-server layer**, not just in the UI.
* `revoke_grant` flips the grant and emits `GrantRevoked`; the grant object is kept (never deleted) so the audit trail survives.

This means auto-expiry needs no KeeperHub/keeper bot: the chain refuses to release keys past `expires_at_ms`.

## Trade-offs (on purpose)

| Choice | Reason |
|---|---|
| **Seal threshold encryption** instead of ECIES-to-doctor-pubkey | Doctors don't carry keypairs. Seal binds access to an on-chain policy (`seal_approve`), so revocation — not key custody — is the access primitive. |
| **Walrus**, not IPFS/Arweave | Sui-native, integrates with the same PTB + object model; the chain holds the hash, Walrus holds the (encrypted) blob. |
| **zkLogin**, not a browser wallet | Patients onboard with Google/Apple; no extension, no seed phrase. |
| Package split: `published-at` (v2) for **Move-call targets**, `original-id` (v1) for **Seal namespace + event/type filters** | Sui struct/event type tags keep the *defining* package id across upgrades; Seal asserts version on the namespace package. Splitting avoids both `InvalidPackageError` and empty record lists after upgrade. |
| **No PHI on-chain** — only content hash, Walrus blob id, hospital id, timestamps | Regulatory hygiene; the chain proves integrity and origin, never exposes medical content. |

## Roadmap — Planned Upgrades

Cross-chain feature parity sweep (vs our 0G and Solana siblings) surfaced these as the next increments:

1. **Doctor self-decrypt for zkLogin users (Flow B).** The viewer / Seal `SessionKey` personal-message signature is currently wired to a browser wallet (`useCurrentAccount`); zkLogin users need a zkLogin-compatible `SessionKey` signing path. *This is the top blocker for the full share→consume demo.*
2. **Grant index for QR resolution.** A shared `GrantRegistry` (Table<grant_id, GrantInfo>) so the QR carries only `grant_id` and the viewer resolves the rest on-chain.
3. **SuiNS naming layer.** Optional human-readable `.sui` names for patients/grants instead of raw hex.
4. **PWA / offline-first.** `vite-plugin-pwa` + IndexedDB (Dexie) cache of already-decrypted records, so the timeline works offline — matching our "smartphone-centric" claim.
5. **Soulbound records.** `RecordAnchor` currently has `key, store` (transferable). Drop the `store` ability (or freeze post-creation) to make each record a true non-transferable, soulbound medical object owned by the patient.

## Notes for Judges (honest gaps)

* **Flow A (encrypt → anchor → verifiable timeline) is end-to-end live on testnet** under zkLogin. Flow B (doctor consume / patient self-decrypt) is wired on-chain (`consume_grant`, `seal_approve`) but the zkLogin Seal `SessionKey` signing path is the remaining piece — see Roadmap #1.
* **Testnet faucet rate-limits (HTTP 429) per IP.** Pre-fund the zkLogin address before a live demo; the code catches it and shows a retry prompt.
