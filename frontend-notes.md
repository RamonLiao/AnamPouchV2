# Frontend Notes - AnamPouch 前端開發筆記與長期記憶

## 1. UI 設計系統與風格指南

### 1.1 主色彩系統 (基於 `theme.css`)
我們在主應用與 Landing Page 中採用一致的明亮、溫潤且具備信賴感的醫療科技色彩系統：

* **背景與光影 (Background & Light Glow)**
  * `--bg`: `#FBFCFD` (極淡藍灰色，傳遞潔淨無瑕的氛圍)
  * `--primary-soft`: `#EBF5FB` (左上偏光漸層)
  * `--accent-soft`: `#F0F9F8` (右上偏光漸層)
* **核心品牌色 (Brand Colors)**
  * `--primary`: `#2D5A8E` (典雅紺藍，主按鈕、Logo 與重點強調使用)
  * `--primary-light`: `#7FC5E3` (天空藍，邊框、卡片 hover 及圖標裝飾用)
  * `--accent`: `#B5E5E0` (薄荷綠，驗證 Badge 與強調用)
* **文字與排版 (Typography & Text)**
  * `--text`: `#1A3A5C` (深紺藍，標題與內文字)
  * `--text-muted`: `#64748B` (slate 灰色，次要描述文字)
  * `主要字體 (UI)`: `'Inter', system-ui, -apple-system, sans-serif` (系統界面使用，傳遞清晰專業感)
  * `品牌字體 (Logo / Header)`: `'Fredoka' / 'Quicksand'` (極具溫和親和力的圓角無襯線字體，用於 Logo 識別與社群橫幅)
* **容器與邊界 (Containers & Borders)**
  * `--card-bg`: `#ffffff` (純白卡片底色)
  * `--border`: `#E2E8F0` (柔和灰色細邊框)
  * `--radius`: `16px` (大圓角，使 UI 更溫和易親近)

### 1.3 品牌視覺資產 (Brand Visual Assets)
所有視覺設計皆嚴格遵循亮色系醫療色彩系統（#FBFCFD, #EBF5FB, #F0F9F8, #2D5A8E），已存放於 `frontend/public/` 目錄下：
* **官方 Logo**:
  * [anampouch_logo_original.png](file:///Users/ramonliao/Documents/Code/Project/Web3/Hackathon/2026_Sui_Overflow/Tracks/3-Walrus/AnamPouchV2/frontend/public/anampouch_logo_original.png)：原始 Logo（帶白底與品牌副標）。
  * [anampouch_logo_transparent.png](file:///Users/ramonliao/Documents/Code/Project/Web3/Hackathon/2026_Sui_Overflow/Tracks/3-Walrus/AnamPouchV2/frontend/public/anampouch_logo_transparent.png)：透明去背 Logo。
* **背景與橫幅**:
  * [anampouch_bg.png](file:///Users/ramonliao/Documents/Code/Project/Web3/Hackathon/2026_Sui_Overflow/Tracks/3-Walrus/AnamPouchV2/frontend/public/anampouch_bg.png)：dApp 主畫面背景，融入半透明醫療十字與流線波浪。
  * [anampouch_twitter_banner.png](file:///Users/ramonliao/Documents/Code/Project/Web3/Hackathon/2026_Sui_Overflow/Tracks/3-Walrus/AnamPouchV2/frontend/public/anampouch_twitter_banner.png)：社群推特橫幅（卡片包裝版，帶 "Your Trusted Web3 Medical Companion" 標語）。
  * [anampouch_social_banner.png](file:///Users/ramonliao/Documents/Code/Project/Web3/Hackathon/2026_Sui_Overflow/Tracks/3-Walrus/AnamPouchV2/frontend/public/anampouch_social_banner.png)：通用社群宣傳 Banner（無邊框滿版，帶 "Your Decentralized Medical Travel Wallet on Sui & Walrus" 標語）。

### 1.2 卡片微互動 (Card Micro-animations)
所有的區塊卡片均應具備以下懸停（hover）反饋動畫，以確保操作時的動態高級感：
```css
.card {
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
.card:hover {
    transform: translateY(-6px);
    box-shadow: 0 10px 25px -5px rgb(45 90 142 / 0.08);
    border-color: var(--primary-light);
}
```

---

## 2. 歷史重要決策紀錄

### 2.1 Landing Page 全面亮色化重構
* **時間**：2026-05-31
* **背景**：原有 `landing.html` 採用暗黑極客風格（Dark Mode），與主應用的亮色系醫療主題產生嚴重的視覺割裂。
* **調整內容**：
  1. 將 `:root` 的色彩完全更換為與 `theme.css` 一致的優雅亮色系統。
  2. 左上角 Header 與 Footer 引入 `/anampouch_logo_transparent.png` 官方透明 Logo，配合優雅的旋轉放大 Hover 動畫。
  3. 導入主次的 CTA (Call to Action) 行動呼籲設計（「Launch App」與「Learn More」按鈕）。
  4. 調整 **Mermaid 系統架構圖** 的 CSS `classDef` 與初始化設定，使用亮色系的 `base` 主題及藍綠漸層填充，確保架構圖在明亮底色下清晰且高質感。
  5. 加入更健全的 RWD 響應式佈局，手機端會自動收折導覽列，並將按鈕展開為全寬。
  6. **視覺微調（Logo 緊湊大氣化）**：應使用者反饋，將 Landing Page Header 的 Logo 圖片高度放大至 **`58px`**，品牌文字字體增至 **`1.75rem`**，並將圖片與文字間的距離縮減至緊湊的 **`6px`**，大幅消除視覺割裂感，使品牌 Lockup 更為渾然一體；Footer Logo 高度同步拉大至 **`36px`**。
  7. **患者端門戶（Patient Portal Logo 同步微調）**：同步修改 `Shell.tsx` 中的內部 Header Logo，寬高調增至 **`50px`**，圖文間距同樣縮減至 **`6px`** 以保持一致的品牌緊湊美感；登入頁 `AuthLogin.tsx` 中的原始 Logo 維持大器的 **`110px`** 尺寸。

---

## 3. 前端待辦事項 (TODO)
* `[ ]` 設計更精緻的 Mobile Navigation menu (漢堡選單)，進一步提升行動端體驗。
* `[ ]` 為 Landing page 卡片引入基於 scroll 的滾動淡入動畫 (Scroll-reveal effects)。
* `[ ]` 確保主 App 路由與 `landing.html` 的轉換連結始終完美相容。
