---
title: "如何從 Auth0 遷移到開源身分提供者"
excerpt: "一份可以實際照做的 Auth0 遷移計畫：匯出 tenant 設定與使用者、透過 Auth0 客服取得密碼雜湊與 TOTP 密鑰、搬移應用程式與社群登入，並選擇一種讓使用者維持登入狀態的切換方式。"
coverImage: ./cover.webp
category: highlight
featured: true
metaTitle: "從 Auth0 遷移到開源 IdP：實作指南"
metaDescription: "從 Auth0 搬家：匯出 tenant 設定與使用者、向 Auth0 客服申請密碼雜湊與 MFA 密鑰、搬移應用程式與社群登入，並規劃切換與回退。"
publishedAt: 2025-12-16T17:40:16.768Z
updatedAt: 2026-11-17
readTime: 10
draft: false
faq:
  - q: "可以從 Auth0 匯出密碼雜湊嗎？"
    a: "後台和 Management API 都不行。你要開一個客服案件、提供 PGP 金鑰、由第二位 tenant 管理員確認申請，並取得 CISO 或副總裁以上層級主管在 Auth0 確認表單上的簽名。Auth0 會逐案審核，表明並非所有申請都符合資格，也不給處理時程。"
  - q: "Auth0 用什麼演算法雜湊密碼？"
    a: "bcrypt。Auth0 表示所有 database connection 的密碼都以 bcrypt 加鹽雜湊，所以能驗證 bcrypt 雜湊的目標系統可以直接接受它們。"
  - q: "離開 Auth0 時，使用者一定要重設密碼嗎？"
    a: "只有在 Auth0 拒絕匯出雜湊，或新系統無法驗證 bcrypt 時才需要。如果匯出被拒，你可以在每位回來的使用者第一次登入時把密碼拿去 Auth0 驗證並存下新的雜湊，再對從沒回來的使用者改用重設。"
  - q: "MFA 設定可以跟著使用者一起搬嗎？"
    a: "TOTP 密鑰可以，它和密碼雜湊在同一個客服匯出裡。透過 Guardian App 的推播通知、WebAuthn 憑證和簡訊註冊都搬不走，這些使用者要在新系統重新註冊。"
  - q: "遷移出問題時要怎麼回退？"
    a: "讓 Auth0 tenant 維持在目前的方案，直到新系統乾淨運作幾週；切換期間凍結個人資料與密碼修改；保留舊的 client ID 與 callback URL，這樣就能把 App 指回去。Auth0 沒有唯讀模式，所以凍結得由你自己執行。"
---

> **tl;dr**：要離開 Auth0 又不想讓使用者重設密碼，先用 Deploy CLI 匯出 tenant 設定、用 Management API 匯出使用者，再向 Auth0 客服開案申請密碼雜湊與 TOTP 密鑰，這兩樣只有申請才拿得到。接著把 Actions 裡的邏輯在新系統重建、把應用程式和社群登入指向新系統，然後一次切換，或用 session 交換讓使用者保持登入。在確定沒問題之前，別關掉 Auth0 tenant。

大多數 Auth0 遷移出問題的地方只有兩個細節。第一，你自己能執行的匯出並不包含密碼雜湊。第二，Actions 裡的程式碼早已悄悄成為登入流程的一部分，卻沒有人把它做了什麼寫下來。兩者都能解決，但前提是你在訂下日期之前就先規劃好。

這份指南是一套不管你要搬去哪裡都適用的計畫，依據的是 Auth0 在 2026 年 11 月的官方文件。如果你還在挑選目標系統，可以先看我們的[開源 Auth0 替代方案比較](/zh-hant/post/top-open-source-auth0-alternatives/)，裡面涵蓋 Authgear、Keycloak、Ory 等選項。

## 為什麼團隊現在想離開 Auth0

Auth0 很容易上手，大多數離開的團隊其實都用得很順好幾年。通常是這四件事讓情況改變：

- **規模一大就很貴。** Auth0 按每月活躍使用者計費，而產品成長後需要的功能，往往落在更高的方案。超過自助方案之後，價格就是一場談判。
- **Rules 與 Hooks 已於 2026 年 11 月 18 日終止服務。** [Auth0 文件](https://auth0.com/docs/customize/rules)載明了這個日期，2023 年 10 月之後建立的 tenant 從來沒有這些功能。還留在裡面的邏輯已經停止執行，正在把它改寫成 Actions 的團隊，會問自己是否還要在 Auth0 上重寫。
- **資料在地化。** 登入系統保存著每一位客戶的 Email、電話號碼和登入紀錄。關於這些資料可以放在哪裡、誰有權要求交出，各地的規範都在收緊。把它交給一家美國的託管服務商，已經不像以前那麼容易說服人。
- **主導權。** Universal Login、Actions 和 Management API 是 Auth0 的介面，不是你的。開源身分提供者讓你能讀原始碼、決定在哪裡執行、修改你需要的部分。

## 第一步：匯出 tenant 設定

在匯出任何一個使用者之前，先把其他東西全部抓下來。Auth0 的 [Deploy CLI](https://auth0.com/docs/deploy-monitor/deploy-cli-tool) 會把 tenant 的設定寫成 YAML。先建立一個對 Management API 有讀取權限的 machine-to-machine 應用程式，然後：

```bash
npm install -g auth0-deploy-cli

export AUTH0_DOMAIN=your-tenant.eu.auth0.com
export AUTH0_CLIENT_ID=...
export AUTH0_CLIENT_SECRET=...

a0deploy export --format=yaml --output_folder=./auth0-tenant
```

輸出內容涵蓋應用程式（含 callback URL 與 grant type）、connections、Actions、角色與權限、品牌設定、Email 範本等。其中三個部分決定了這次遷移的工作量：

- **應用程式。** 每一個都是你要在新系統重建的 OIDC client。記下類型（regular web、single-page、native 或 machine-to-machine）、callback 與 logout URL，以及它呼叫哪些 API。
- **Connections。** Database connection 存放你的使用者。社群 connection（Google、Apple、GitHub）和企業 connection（SAML、OIDC、Entra ID、Google Workspace）指向別人的身分提供者，改個設定就能搬。
- **Actions。** 這是在登入過程中執行的自訂程式碼：加入 claims、擋掉特定網域的註冊、呼叫你的 CRM、強制管理員使用 MFA。逐一讀過，用白話把它做的事寫下來。有些對應到新系統的一個設定，有些需要 webhook，有些你會發現已經不需要了。

匯出內容也會列出你的 API（resource server）與其 scope，你的後端程式碼檢查的就是這些。把這份清單留到第五步。

## 第二步：匯出使用者

使用者匯出是在 [Management API](https://auth0.com/docs/manage-users/user-migration/bulk-user-exports) 上執行的一個 job，也可以從後台的 User Management、Users、Import/Export Users 操作。免費方案沒有這個功能。請選 JSON 而不是 CSV：CSV 最多只能有 30 個欄位，而且無法把 `app_metadata` 或 `user_metadata` 當成完整物件匯出。

```bash
curl -X POST "https://$AUTH0_DOMAIN/api/v2/jobs/users-exports" \
  -H "Authorization: Bearer $MGMT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "format": "json",
    "fields": [
      {"name": "user_id"}, {"name": "email"}, {"name": "email_verified"},
      {"name": "username"}, {"name": "phone_number"}, {"name": "name"},
      {"name": "given_name"}, {"name": "family_name"}, {"name": "picture"},
      {"name": "identities"}, {"name": "app_metadata"}, {"name": "user_metadata"},
      {"name": "blocked"}, {"name": "created_at"}, {"name": "last_login"}
    ]
  }'
```

不帶 `connection_id` 就會一次匯出所有 connection。輪詢 `GET /api/v2/jobs/{job_id}` 直到狀態變成 `completed`，再從 `location` URL 下載檔案。連結只有 60 秒有效，job 和檔案在 24 小時後就會刪除，所以請把下載寫成腳本。

檔案是 gzip 壓縮的 newline-delimited JSON，一行一個使用者。在規劃任何事情之前，先算一下你有哪些類型的使用者：

```bash
gunzip -c users.json.gz | jq -r '.identities[0].provider' | sort | uniq -c
```

provider 是 `auth0` 的使用者，密碼存在 database connection 裡。其他的（`google-oauth2`、`apple`、`samlp`、`waad` 等）都是透過別的提供者登入，沒有密碼需要遷移。這個比例告訴你第三步的密碼問題會影響多少人。

匯出檔裡沒有的兩樣東西：

- **角色。** Auth0 的 RBAC 角色存在角色上，不在使用者上。先用 `GET /api/v2/roles` 列出角色，再對每個角色分頁呼叫 `GET /api/v2/roles/{id}/users`。
- **密碼雜湊。** 這要靠第三步。

把每個使用者的 `user_id` 留下來。你自己的資料庫幾乎一定存了它，格式像 `auth0|5f1e...` 或 `google-oauth2|1098...`，而新系統會發出不同的 `sub`。你要嘛把舊 ID 當成自訂屬性匯入、在登入時查對，要嘛在匯入後跑一次性腳本改寫你的外鍵。

## 第三步：取得密碼雜湊，並為拿不到做準備

Auth0 用 [bcrypt](https://auth0.com/blog/hashing-in-action-understanding-bcrypt/) 雜湊 database connection 的密碼。bcrypt 雜湊可以被任何實作 bcrypt 的系統驗證，所以理論上你的使用者可以保留密碼。實務上，把雜湊拿出來是一套流程，不是一次 API 呼叫。

Auth0 只透過[客服案件](https://auth0.com/docs/manage-users/user-migration/export-password-hashes-and-mfa-secrets)釋出雜湊。截至 2026 年 11 月，文件上的要求是：

- 申請時要寫明 tenant 名稱，並附上 PGP 公鑰。
- 需要另一位 tenant 管理員確認申請，除非只有一位管理員。
- 需要 CISO、CSO 或副總裁以上層級的主管簽署 Auth0 的 Hashed Password and MFA Secret Export Acknowledgment 表單。打字的姓名不算數。
- Auth0 會先審核資格。文件寫著「並非所有申請都符合匯出資格」，也沒有給出處理時程。
- 檔案以 PGP 加密交付，下載連結只有開案者能開啟，三天內有效。

盡早開案，在你告訴使用者任何事情之前，因為答案會改變你的計畫。你有三個選項，依優先順序排列：

| 選項 | 使用者保留密碼？ | 需要 | 代價 |
|---|---|---|---|
| **匯入雜湊** | 是 | Auth0 核准匯出；目標系統能驗證 bcrypt | 一個客服案件，加上一些耐心 |
| **首次登入時驗證** | 是，限有回來的使用者 | Auth0 繼續運作；一個小服務，把密碼拿去 Auth0 驗證後存下新的雜湊 | 兩套系統並行數週；還要為從沒回來的使用者準備方案 |
| **強制重設** | 否 | 寄一封密碼重設信給所有人 | 客服工單，而且有些使用者不會回來 |

第二個選項可行，是因為 Auth0 的 Resource Owner Password grant 讓後端可以拿密碼到 database connection 驗證。它是權宜之計，不是終點。訂一個期限，到期後把剩下的人全部重設。

## 第四步：決定 MFA 怎麼辦

同一個客服匯出可以包含 MFA 密鑰，實務上指的是用驗證器 App 註冊的使用者的 TOTP 種子。這些可以直接匯入任何接受 TOTP 密鑰的系統。

其他的都搬不走：

- 透過 Auth0 Guardian App 的**推播通知**綁在 Auth0 上。
- **WebAuthn 與 passkeys** 綁定在 Auth0 的網域，公鑰也留在 Auth0 的儲存裡。
- **簡訊與 Email 驗證碼**沒有可以匯出的密鑰。重新註冊只是再確認一次電話號碼。

所以 MFA 的計畫就是：一份誰註冊了什麼的清單、一則說明需要重新註冊一次的切換公告，以及在新系統重新強制 MFA 之前的寬限期。那份清單可以用 `GET /api/v2/users/{id}/authentication-methods` 逐一查到。如果有 Action 對某個群組強制 MFA，這條政策在第五步搬。

## 第五步：搬移應用程式與後端的 token 檢查

每一個 Auth0 應用程式都會變成新系統裡的一個 client。grant type 直接對應：regular web app 用 authorization code flow，SPA 與原生 App 用 authorization code 加 PKCE，machine-to-machine 用 client credentials。從第一步的匯出檔複製 callback URL 與 logout URL。

Universal Login 是大多數團隊低估的部分。登入頁面是 Auth0 替你渲染的，你加上的品牌設定、自訂文字或頁面範本都在 Auth0 裡面。新系統會渲染自己的頁面，所以預期要把品牌設定重做一次。如果你是對著 Auth0 的 authentication API 自己做了登入 UI，那改寫的工程更大，也是改用託管頁面的好時機。

你的後端現在檢查的是 Auth0 的 access token。每一個都要改 issuer、金鑰和 audience：

| 檢查項目 | Auth0 | 遷移後 |
|---|---|---|
| Issuer（`iss`） | `https://your-tenant.eu.auth0.com/` | 新系統的端點，從它的 OpenID discovery 文件讀取 |
| 金鑰 | `https://your-tenant.eu.auth0.com/.well-known/jwks.json` | `/.well-known/openid-configuration` 裡的 `jwks_uri` |
| Audience（`aud`） | 你註冊的 API identifier | 看新系統放什麼；查它的文件 |
| Subject（`sub`） | `auth0\|...` 或 `google-oauth2\|...` | 每個使用者一個新 ID，見第二步 |
| 權限 | `permissions` 陣列，或由 Action 加上的命名空間 claims | 新系統的角色 claim，或查你自己的資料庫 |

把後端的修改放在一個 feature flag 後面，在切換期間同時接受兩個 issuer。這樣你才能一次搬一個應用程式，不必一口氣部署所有服務。

最後，回到第一步盤點的 Actions，逐一決定歸宿：新系統的內建設定、新系統的 webhook、你自己 App 裡的修改，或直接刪掉。

## 第六步：搬移社群與企業 connection

只要你在每個提供者那邊沿用同一個 OAuth app，社群 connection 就是最簡單的部分。使用者是由提供者的穩定 subject 識別的，所以在 Auth0 用 Google 登入的那個人，到了新系統仍然是同一個 Google 使用者。不要新建 Google 或 Apple app。把新系統的 callback URL 加進現有的 app，切換完成後再移除 Auth0 的 URL。

兩件事要確認：

- **帳號連結。** 匯入的使用者有 Email。當他第一次在新系統用 Google 登入時，系統必須把這個 Google 身分接到既有帳號上，而不是建立一個重複帳號。確認你的目標系統支援用已驗證的 Email 連結，並決定是否要使用者用密碼確認一次。這個確認步驟就是用來阻止攻擊者拿著某個提供者上未驗證的 Email 來接管帳號。
- **Sign in with Apple。** Apple 的私人轉寄 Email 只會投遞到你在該開發者團隊底下向 Apple 註冊過的網域。沿用同一個 Apple 開發者團隊與 Services ID，並把新系統的寄件網域註冊進去，否則用轉寄信箱的使用者會收不到你寄的每一封信。

企業 connection 在客戶那邊都有一位對口，要由他新增一個 service provider 或 client。這是整個計畫裡前置時間最長的部分。一拿到新系統的 metadata URL 就開始談，而且在每個客戶確認之前，都要讓 Auth0 的 connection 保持運作。

## 第七步：選擇切換方式，並保留回退路線

切換有三種方式，哪一種適合你，取決於強制登出的代價有多大。

1. **一次切換。** 凍結 Auth0 上的密碼與個人資料修改，執行最後一次匯出與匯入，把應用程式部署成指向新系統，然後所有人重新登入。最簡單，適合內部工具或可以安排維護時段的單一 App。
2. **讓使用者保持登入。** 照上面的方式匯入使用者，然後讓你的 App 暫時同時接受 Auth0 session 與新系統的 session。當一個帶著有效 Auth0 token 的請求進來時，一個小端點驗證它，並為同一位使用者在新系統建立 session。使用者完全無感。消費者 App 一旦登出就等於流失，就該走這條路。
3. **按應用程式分階段。** 一次搬一個應用程式，後端同時接受兩個 issuer（第五步）。整段期間兩套系統都在運作，所以其中一邊的個人資料修改不會同步到另一邊。適合應用程式多、使用者少的情況，或搭配修改凍結一起用。

不管選哪一種，都要留一條退路：

- **讓 Auth0 tenant 維持在目前的方案**，直到新系統乾淨運作幾週，而且在雜湊匯出到手之前絕對不要取消。
- **在最後一次匯出前凍結個人資料與密碼修改。** Auth0 沒有唯讀開關，所以要在 database connection 關閉註冊、在你的 App 停用密碼修改流程，並暫停會寫入使用者 metadata 的 Actions。
- **保留舊的 client ID 與 callback URL**，這樣把 App 指回去只是改設定。
- **第一週盯著四個數字：** 登入成功率、密碼重設量、寫著「無法登入」的客服工單，以及 MFA 註冊數。這四個數字會告訴你匯入與雜湊驗證有沒有成功。

## 遷移到 Authgear

如果你要搬到 [Authgear](/zh-hant/compare/auth0-alternative/)，上面的步驟會對應到幾個具體的做法。

**使用者連同 bcrypt 雜湊一起匯入。** [User Import API](https://docs.authgear.com/reference/apis/user-import-api) 可以在一筆紀錄裡接受每個使用者的 bcrypt 雜湊、TOTP 密鑰、角色、群組、自訂屬性與停用旗標。把 Auth0 的匯出檔轉成它的 schema，分批送出：

```json
{
  "identifier": "email",
  "records": [
    {
      "email": "alice@example.com",
      "email_verified": true,
      "name": "Alice Lee",
      "password": { "type": "bcrypt", "password_hash": "$2b$10$..." },
      "mfa": { "totp": { "secret": "JBSWY3DPEHPK3PXP" } },
      "roles": ["admin"],
      "custom_attributes": { "auth0_user_id": "auth0|5f1e4c2a9b..." },
      "disabled": false
    }
  ]
}
```

先在 Portal 宣告 `auth0_user_id` 這個自訂屬性，過渡期間你的後端就能用舊 ID 查到使用者。匯入是以 job 執行，每一筆紀錄都有自己的結果，所以一筆壞資料不會讓整批失敗。第二次執行時帶上 `upsert: true`，可以套用第一次匯出到凍結之間發生的個人資料變更。

**Session 可以延續。** Authgear 的[零停機遷移](https://docs.authgear.com/migration/zero-downtime-migration)就是第七步「讓使用者保持登入」的文件化版本：你的 App 驗證 Auth0 token，為對應的 Authgear 使用者呼叫 Admin API 的 `createSession`，再把 Authgear session 交回去。如果可以接受登出，[批次遷移](https://docs.authgear.com/admin-and-operations/migration/bulk-migration)的指南更短。

**社群登入會接到匯入的使用者上。** 把 `https://<your-authgear-endpoint>/sso/oauth2/callback/google` 加進 Auth0 正在用的同一個 Google OAuth client，然後把[帳號連結](https://docs.authgear.com/authentication-and-access/social-enterprise-login-providers/account-linking)設成 `action: login_and_link`，Email 符合某個匯入使用者的 Google 登入，就會在一次性確認後併入該帳號。

**後端改設定就能切換。** 為每個應用程式開啟「Issue JWT as access token」，把 middleware 指向 Authgear discovery 文件裡的 `jwks_uri`，並改從 `https://authgear.com/claims/user/roles` claim 讀取角色，取代 Auth0 的 `permissions`。參考[在後端驗證 JWT](https://docs.authgear.com/get-started/backend-api/jwt)。

機制以外的部分：

- Authgear 是 OIDC 提供者，也能作為 SAML 身分提供者，所以企業 connection 和你自己的 App 都是改設定就能搬。
- 登入頁面用你自己的 CSS 與 HTML 客製，Universal Login 的品牌設定就放這裡。
- 採 Apache-2.0 授權開源。你可以自行部署完整功能，也可以交給我們在你選擇的地區代管專屬私有雲，包括台灣。看[資料在地化](/zh-hant/solutions/data-sovereignty/)了解怎麼運作。

想在規劃之前先試試看，可以用 Docker Compose [在 10 分鐘內於本機跑起 Authgear](/zh-hant/post/self-hosted-authentication-docker-kubernetes/)。我們的團隊會協助處理 Auth0 客服案件、匯入與切換。[預約示範](/zh-hant/schedule-demo)，帶著你的 tenant 匯出檔來，我們一起走一遍計畫。

## 常見問題

### 可以從 Auth0 匯出密碼雜湊嗎？

後台和 Management API 都不行。你要開一個客服案件、提供 PGP 金鑰、由第二位 tenant 管理員確認申請，並取得 CISO 或副總裁以上層級主管在 Auth0 確認表單上的簽名。Auth0 會逐案審核，表明並非所有申請都符合資格，也不給處理時程。

### Auth0 用什麼演算法雜湊密碼？

bcrypt。Auth0 表示所有 database connection 的密碼都以 bcrypt 加鹽雜湊，所以能驗證 bcrypt 雜湊的目標系統可以直接接受它們。

### 離開 Auth0 時，使用者一定要重設密碼嗎？

只有在 Auth0 拒絕匯出雜湊，或新系統無法驗證 bcrypt 時才需要。如果匯出被拒，你可以在每位回來的使用者第一次登入時把密碼拿去 Auth0 驗證並存下新的雜湊，再對從沒回來的使用者改用重設。

### MFA 設定可以跟著使用者一起搬嗎？

TOTP 密鑰可以，它和密碼雜湊在同一個客服匯出裡。透過 Guardian App 的推播通知、WebAuthn 憑證和簡訊註冊都搬不走，這些使用者要在新系統重新註冊。

### 遷移出問題時要怎麼回退？

讓 Auth0 tenant 維持在目前的方案，直到新系統乾淨運作幾週；切換期間凍結個人資料與密碼修改；保留舊的 client ID 與 callback URL，這樣就能把 App 指回去。Auth0 沒有唯讀模式，所以凍結得由你自己執行。
