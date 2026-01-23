# 彦歯科医院 予約システム - Vercelデプロイガイド

## 概要

このガイドでは、歯科医院予約システムをVercel + Neon PostgreSQLにデプロイする手順を説明します。

---

## 1. Neon PostgreSQL セットアップ

### 1.1 アカウント作成

1. [Neon Console](https://console.neon.tech/) にアクセス
2. GitHubまたはGoogleアカウントでサインアップ
3. 新しいプロジェクトを作成
   - Project Name: `hiko-dental-clinic`
   - Region: `Asia Pacific (Singapore)` を推奨

### 1.2 データベース接続情報を取得

1. プロジェクトダッシュボードで「Connection Details」をクリック
2. 「Connection string」をコピー（以下の形式）:
   ```
   postgres://user:password@ep-xxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
   ```

### 1.3 初期データ投入

ローカル環境からシードデータを投入します：

```bash
# .envにDATABASE_URLを設定
echo "DATABASE_URL=postgres://user:password@..." >> .env

# シードスクリプト実行
npm run seed:postgres
```

---

## 2. Vercel デプロイ

### 2.1 Vercel CLIインストール（初回のみ）

```bash
npm install -g vercel
```

### 2.2 Vercelにログイン

```bash
vercel login
```

### 2.3 プロジェクトリンク

```bash
cd /path/to/予約システム
vercel link
```

### 2.4 環境変数設定

Vercelダッシュボード > Settings > Environment Variables で以下を設定：

| 変数名 | 値 |
|--------|-----|
| `DATABASE_URL` | Neonの接続文字列 |
| `SESSION_SECRET` | ランダムな長い文字列（32文字以上推奨） |
| `NODE_ENV` | `production` |
| `BASE_URL` | デプロイ後のURL（例: `https://hiko-dental.vercel.app`） |

SMTPメール設定（オプション）:

| 変数名 | 値 |
|--------|-----|
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | Gmailアドレス |
| `SMTP_PASS` | Gmailアプリパスワード |

### 2.5 デプロイ実行

```bash
# プレビューデプロイ
vercel

# 本番デプロイ
vercel --prod
```

---

## 3. デプロイ後の確認

1. **予約システム**: `https://your-domain.vercel.app/`
2. **管理画面**: `https://your-domain.vercel.app/manage.html`
3. **管理者ログイン**: 
   - ユーザー名: `admin`
   - パスワード: `admin123`（初期値）

> ⚠️ **重要**: 本番環境では必ず管理者パスワードを変更してください

---

## 4. トラブルシューティング

### 接続エラーが発生する場合

1. DATABASE_URLが正しく設定されているか確認
2. Neonプロジェクトがアクティブか確認
3. Vercelのログを確認: `vercel logs`

### 静的ファイルが表示されない場合

`vercel.json`のルーティング設定を確認してください。

### セッションが保持されない場合

1. `SESSION_SECRET`が設定されているか確認
2. `BASE_URL`が正しいか確認
3. クッキー設定（Secure, SameSite）を確認

---

## 5. ローカル開発

### SQLite版（オフライン開発用）

```bash
npm run dev:sqlite
```

### PostgreSQL版（Neon接続）

```bash
# .envにDATABASE_URLを設定後
npm run dev
```

---

## ファイル構成

```
予約システム/
├── vercel.json          # Vercel設定
├── package.json         # 依存関係
├── .env                 # 環境変数（ローカル用）
├── .env.example         # 環境変数テンプレート
├── client/              # フロントエンド
│   ├── index.html
│   ├── manage.html
│   ├── css/
│   └── js/
└── server/
    ├── index.postgres.js  # メインサーバー（PostgreSQL版）
    ├── index.js           # メインサーバー（SQLite版）
    ├── db/
    │   ├── db.js            # PostgreSQL接続モジュール
    │   ├── schema.postgres.sql
    │   ├── seed.postgres.js
    │   └── ...
    └── lib/
        ├── slots.postgres.js  # スロット計算（PostgreSQL版）
        ├── slots.js           # スロット計算（SQLite版）
        ├── mailer.js
        └── security.js
```
