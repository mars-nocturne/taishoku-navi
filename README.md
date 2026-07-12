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
- **管理画面**はヘッダーの⚙️から運営者メールでログインすると出現
- 会社との交渉は行わない（非弁行為の回避）— 利用規約 第2条に明記

## 初回セットアップ（未実施ならこの2つ）

1. Supabase ダッシュボード > SQL Editor で `supabase_setup.sql` を実行
2. Authentication > Users > Add user で運営者アカウントを作成
   （Email: config.js の operatorEmail、Auto Confirm にチェック）

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
