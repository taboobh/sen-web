# 預覽部署：Cloudflare Pages ＋ Cloudflare Access（限夥伴檢視）

目標：每個 Pull Request 自動產生預覽網址，**只有被邀請的夥伴（Google 帳號）能開啟**，不需自己架站。
平台設定在 Cloudflare 網頁上操作（需由專案擁有者的 Cloudflare 帳號完成）；以下步驟以目前介面為準，名稱若有出入請依畫面調整。

## 一、前置：程式碼要在 GitHub 上

1. 程式碼放在獨立的 GitHub 私有 repository（`taboobh/sen-web`），本資料夾內容位於 repository 最上層。
2. 本資料夾已含：`.node-version`（Node 22）、`public/_headers`（禁止搜尋引擎收錄）、`package-lock.json`。

## 二、建立 Pages 專案

1. Cloudflare 後台 → Workers & Pages → Create → Pages → Connect to Git，授權 GitHub 並選擇此 repository。
2. 建置設定：

| 設定項 | 值 |
|---|---|
| Production branch | 你們的主要分支 |
| Root directory | 留空（repository 最上層即為本專案；若改放在大型 repository 的子資料夾，才填 `sen-web`） |
| Build command | `npm run build` |
| Build output directory | `dist` |

3. 環境變數（選填）：`VITE_USE_MOCK=true`（預設即為 true，可不設）。
4. 儲存後會得到 `https://<專案名>.pages.dev`；之後每個 Pull Request 會得到 `https://<提交碼>.<專案名>.pages.dev` 預覽網址，並由 Cloudflare 機器人貼回 PR。

## 三、限制只有夥伴能看（Cloudflare Access）

1. 後台 → Zero Trust（首次需設定團隊名稱並選免費方案）。
2. 登入方式（二選一，建議先用 A）：
   - **A. 單次驗證碼（One-time PIN）**：不需額外設定，夥伴輸入 Gmail 位址，收到驗證碼即可進入。
   - **B. Google 登入**：Zero Trust → Settings → Authentication → Add new → Google，需在 Google Cloud 建立 OAuth 用戶端並填入 Client ID／Secret。
3. Access → Applications → Add an application → Self-hosted：
   - 網域加入 `<專案名>.pages.dev` 與 `*.<專案名>.pages.dev`（正式與所有 PR 預覽都涵蓋）。
   - Policy：Action 選 Allow，Include 選 Emails，填入夥伴的 Google 信箱（或用 Emails ending in 以網域放行）。
4. 用無痕視窗開啟預覽網址，確認會先要求驗證；未在名單內的信箱應被拒絕。

## 四、新增或移除夥伴

只需修改 Access 的 Policy 信箱名單，不必動程式。人員異動時請同步移除。

## 五、注意事項

- 預覽只用合成資料（MSW 假資料）。**不得放入真實學生資料。**
- Pages 只提供靜態檔；假後端跑在瀏覽器內，不需要任何伺服器。
- 若日後改為打真實後端，需另外處理後端的網路存取與驗證，不要讓公開預覽直通正式資料。
- 預覽網址是否仍在 Access 保護內，請在新增專案或改名後重新確認。
- 免費方案的額度與功能以 Cloudflare 官方說明為準，使用前請再確認。
