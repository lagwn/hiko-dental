# 歯科医院予約システム

歯科医院向けのオンライン予約システムです。患者がWebから簡単に予約でき、医院側で効率的に管理できます。

## 特徴

- 📱 **スマホファースト** - モバイル最適化されたUI
- 🔒 **セキュア** - トークン認証、bcryptハッシュ、Helmet対応
- 📧 **自動メール** - 予約確認メールを自動送信
- 📅 **予約カレンダー** - 週間表示で予約を一覧管理
- 👤 **患者管理** - 簡易カルテ機能付き

## 技術スタック

- **フロントエンド**: HTML / CSS / Vanilla JavaScript
- **バックエンド**: Node.js + Express
- **データベース**: SQLite（better-sqlite3）
- **メール**: Nodemailer

## セットアップ

### 1. 依存パッケージのインストール

```bash
npm install
```

### 2. 環境変数の設定

`.env.example` を `.env` にコピーして編集します。

```bash
cp .env.example .env
```

**重要な設定項目:**

```env
# セッションシークレット（本番環境では必ず変更）
SESSION_SECRET=your-super-secret-session-key

# SMTP設定（メール送信用）
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# 予約受付ルール
BOOKING_CUTOFF_DAYS=2    # 予約締切（◯日前）
BOOKING_CUTOFF_HOURS=3   # 予約締切（◯時間前）
BOOKING_MAX_DAYS_AHEAD=60 # 最遠予約日（◯日先まで）
```

### 3. データベースの初期化

```bash
npm run init-db
npm run seed
```

### 4. サーバーの起動

```bash
npm run dev
```

サーバーが起動したら、以下のURLにアクセスできます：

- **予約ページ**: http://localhost:3000/
- **管理画面**: http://localhost:3000/manage.html

## 初期管理者アカウント

| 項目 | 値 |
|------|-----|
| ユーザー名 | `admin` |
| パスワード | `admin123` |

⚠️ **本番環境では必ずパスワードを変更してください**

## フォルダ構成

```
/予約システム
├── server/
│   ├── index.js          # Expressサーバー
│   ├── db/
│   │   ├── schema.sql    # DBスキーマ
│   │   ├── init.js       # DB初期化スクリプト
│   │   ├── seed.js       # 初期データ投入
│   │   └── clinic.db     # SQLiteデータベース（自動生成）
│   └── lib/
│       ├── security.js   # セキュリティユーティリティ
│       ├── slots.js      # 空き枠生成ロジック
│       └── mailer.js     # メール送信機能
├── client/
│   ├── index.html        # 患者向け予約ページ
│   ├── manage.html       # 管理画面
│   ├── css/
│   │   └── style.css     # スタイルシート
│   └── js/
│       ├── app.js        # 予約フローJS
│       └── manage.js     # 管理画面JS
├── .env.example          # 環境変数テンプレート
├── package.json
└── README.md
```

## API仕様

### 公開API（認証不要）

| Method | Endpoint | 説明 |
|--------|----------|------|
| GET | `/api/services` | メニュー一覧 |
| GET | `/api/staff` | スタッフ一覧 |
| GET | `/api/available-dates` | 予約可能日一覧 |
| GET | `/api/slots` | 空き時間スロット |
| POST | `/api/appointments` | 予約作成 |
| GET | `/api/appointments/by-token` | トークンで予約取得 |
| POST | `/api/appointments/cancel` | 予約キャンセル |

### 管理者API（認証必要）

| Method | Endpoint | 説明 |
|--------|----------|------|
| POST | `/api/admin/login` | ログイン |
| POST | `/api/admin/logout` | ログアウト |
| GET | `/api/admin/me` | セッション確認 |
| GET | `/api/admin/appointments` | 予約一覧 |
| GET | `/api/admin/appointments/:id` | 予約詳細 |
| PUT | `/api/admin/appointments/:id` | 予約更新 |
| DELETE | `/api/admin/appointments/:id` | 予約削除 |
| GET | `/api/admin/appointments/export/csv` | CSVエクスポート |
| GET | `/api/admin/patients` | 患者一覧 |
| GET | `/api/admin/patients/:id` | 患者詳細 |
| POST | `/api/admin/patients/:id/notes` | 患者メモ追加 |

## セキュリティ

- ✅ サーバーサイドバリデーション
- ✅ XSS対策（HTMLエスケープ）
- ✅ レート制限（予約API）
- ✅ Helmetによるセキュアヘッダー
- ✅ bcryptパスワードハッシュ
- ✅ セキュアトークン（SHA-256ハッシュ保存）
- ✅ HttpOnly / Secure / SameSite Cookie

## 本番環境へのデプロイ

### HTTPS設定

本番環境では必ずHTTPSを使用してください。以下の方法があります：

1. **リバースプロキシ**: Nginx + Let's Encrypt
2. **PaaS**: Render, Railway, Heroku など
3. **クラウド**: AWS, GCP の Load Balancer + SSL証明書

### 環境変数

```env
NODE_ENV=production
SESSION_SECRET=<本番用の強力なシークレット>
BASE_URL=https://your-domain.com
```

### プロセス管理

PM2などを使用してプロセスを管理することを推奨します。

```bash
npm install -g pm2
pm2 start server/index.js --name dental-reservation
```

## Gmail SMTP設定

Gmailを使用する場合、アプリパスワードを使用する必要があります。

1. Googleアカウントの2段階認証を有効化
2. [アプリパスワード](https://myaccount.google.com/apppasswords) を生成
3. 生成されたパスワードを `SMTP_PASS` に設定

## ライセンス

MIT License
