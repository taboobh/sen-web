# sen-web：特教通報網前端原型

React + Vite + TypeScript + Ant Design，後端以瀏覽器內的 MSW 假 API 取代，**不需要後端、不需要自己架站**。

## 快速開始

```bash
npm install
npm run dev        # 本機開發
npm test           # 授權引擎單元測試
npm run build      # 產生靜態檔 dist/
```

## 讓夥伴直接點開看（不自己架站）

`dist/` 是純靜態檔案（使用 HashRouter、相對路徑），可放到任何靜態託管：GitHub Pages、Cloudflare Pages、Netlify、Azure Static Web Apps。
建議設定「每個 Pull Request 自動產生預覽網址」，夥伴點連結即可檢視。

## 內容

- 模擬登入（選示範帳號；正式登入方式尚未決定，暫不沿用 Keycloak）、多身分切換、依權限顯示的模組首頁與側邊選單。
- 學生資料示範「資料範圍」：清單由（假）後端依角色、範圍、教育階段、責任關係過濾。
- 治理畫面：帳號與角色指派、角色 × 模組 × 動作矩陣、範圍樹（分區 = 多個行政區／鄉鎮）、授權稽核紀錄。
- 家長、學生登入不納入第一階段。
- 權限模擬：詢問後端「目前身分能不能做某件事」，並顯示拒絕原因。
- 教育輔具模組不保留，13 個模組中不含該功能。

## 結構

```
src/auth/engine.ts      授權引擎（純函式）與單元測試
src/mock/               假資料、假後端（MSW handlers）
src/api/client.ts       所有後端呼叫的唯一出口
src/auth/AuthContext    「我的權限」與身分切換
src/pages, src/layout   畫面
```

## 之後接真實後端

1. 設 `VITE_USE_MOCK=false`，MSW 不再啟動。
2. 只需修改 `src/api/client.ts`（網址、登入憑證標頭）。
3. 後端提供與 `MePermissions`（見 `src/types.ts`）相同格式的「我的權限」介面，並在每個 API 重新執行授權檢查。前端的隱藏與停用只是體驗，不是安全邊界。

## 限制

- 示範權限矩陣、角色與範圍都是**示範值，待業務核准**。
- 角色切換不是正式授權；資料全為合成資料。
- 學生清單以外的功能畫面目前是「功能掛載點」。
