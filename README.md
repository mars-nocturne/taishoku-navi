# 退職届ナビ — 退職届の作成・郵送代行アプリ

お客さんがフォームに入力して電子署名するだけで、運営者（ポジティブキャリア）が
正式な縦書き退職届を印刷し、会社へ郵送する**請負サービス**のPWAアプリ。

## 仕組み

```
お客さん                          運営者（あなた）
────────────────────            ────────────────────
依頼タブで入力＋署名
  → 受付番号発行（T-0001）
  → 銀行振込（名義の先頭に受付番号）
                                  管理タブで入金確認 →「入金を確認した」
                                  退職届・添え状・封筒見本を印刷
                                  簡易書留で発送 →「発送した」＋追跡番号入力
追跡タブで配達を見守る
                                  配達確認 →「完了にする」
```

- **料金・振込先・発送方法**は `config.js` で設定（口座ができたら `bank` を記入）
- **管理画面**は運営者専用ページ `admin.html`（例: https://mars-nocturne.github.io/taishoku-navi/admin.html ）
  からログイン。お客様用ページには管理系のUIは一切出ない。URLはアプリからリンクせず noindex
- 会社との交渉は行わない（非弁行為の回避）— 利用規約 第2条に明記

## 初回セットアップ（未実施ならこの2つ）

1. Authentication > Users > Add user で運営者アカウントを作成（Auto Confirm にチェック）し、
   発行された User UID を `supabase_setup.sql` の `taishoku_is_operator()` に書き込む
2. Supabase ダッシュボード > SQL Editor で `supabase_setup.sql` を実行

運営者の判定はサーバー側（SQL関数のUID照合）で行い、クライアントは RPC で結果だけを受け取る。
コード内に運営者のメールアドレス等の識別情報は置かない。

## 新規依頼のメール通知（Edge Function）

新しい依頼の INSERT／キャンセルを Webhook で受けて、運営者メールに通知する。
コードは `supabase/functions/notify-order/index.ts`。設定手順：

1. [Resend](https://resend.com) に無料登録して API キーを発行
   （無料枠のままなら差出人は `onboarding@resend.dev`、送信先は自分の登録メールのみ。
   独自ドメインを認証すれば任意の宛先・差出人にできる）
2. Supabase CLI でデプロイとシークレット設定：

   ```
   supabase functions deploy notify-order --no-verify-jwt --project-ref drkxgjvoqgqjubderbab
   supabase secrets set RESEND_API_KEY=re_xxxx WEBHOOK_SECRET=＜ランダムな合言葉＞ --project-ref drkxgjvoqgqjubderbab
   ```

   （CLI を使わない場合はダッシュボード > Edge Functions で `notify-order` を作成して
   コードを貼り付け、「Verify JWT」をオフに。シークレットは Edge Functions > Secrets で設定）
3. ダッシュボード > Database > Webhooks で新規作成：
   - テーブル `taishoku_orders`、イベント **Insert と Update**
   - タイプ HTTP Request / POST、URL `https://drkxgjvoqgqjubderbab.supabase.co/functions/v1/notify-order`
   - HTTP ヘッダーに `x-webhook-secret: ＜手順2と同じ合言葉＞` を追加
4. アプリから試しに依頼を1件入れて、`positive.career.2026@gmail.com` に
   「【退職届ナビ】新しい依頼 T-xxxx」が届けば完了（テスト注文は管理タブでキャンセル）

通知先や差出人を変えるときはシークレット `NOTIFY_TO` / `MAIL_FROM` を設定する。

### お客様宛の自動メール（受付確認・入金確認・発送完了・キャンセル）

コードには実装済み。有効化には **独自ドメインの Resend 認証が必要**（無料枠は
未認証だと登録者本人宛にしか送れないため）。手順：

1. ドメインを取得（年1,000〜2,000円程度。Cloudflare Registrar・お名前.com など）
2. Resend ダッシュボード > Domains > Add Domain でドメインを登録し、
   表示される DNS レコード（DKIM 等）をドメイン側に追加して Verify
3. シークレットを追加：
   - `MAIL_FROM` = `退職届ナビ <info@あなたのドメイン>`
   - `CUSTOMER_MAIL` = `on`
4. ダッシュボードの Edge Functions > notify-order > Code で最新の
   `supabase/functions/notify-order/index.ts` を貼り直して再デプロイ

`CUSTOMER_MAIL=on` にするまでお客様宛は一切送られない（運営者通知のみ）。
振込先の記載（`BANK_LINES`）は `config.js` の `bank` と同期を保つこと。

## 技術構成

- バニラJS・ビルド不要（union_app と同じ構成）
- バックエンド: Supabase（結成ナビと同一プロジェクト、`taishoku_orders` テーブル＋RLS）
  - 依頼者=匿名サインイン、自分の注文のみ閲覧・キャンセル可
  - 運営者=メールログイン、全件の閲覧・更新可（RLSでメール判定）
- PWA: `manifest.webmanifest` + `sw.js`（オフライン対応）
- 縦書きは CSS `writing-mode: vertical-rl`、印刷は `@media print` でA4整形
- 電子署名は Canvas で取得し、90度回転して縦書き書面に押印代わりに印字
- **更新時の注意**: `sw.js` の `CACHE` バージョン（`taishoku-app-vN`）を上げること

## ローカル確認

```
python -m http.server 8091 --directory taishoku_app
```

（`.claude/launch.json` に `taishoku_app` 設定済み）

## 公開前のTODO

- [ ] 銀行口座を開設し `config.js` の `bank` を記入（開業届 → 屋号付き口座）
- [ ] `tokushoho.html` の【要記入】（運営責任者・所在地・電話番号）を埋める
- [ ] GitHubリポジトリ作成 → GitHub Pages公開
