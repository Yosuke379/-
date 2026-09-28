# Slot Booking API

定員管理のあるイベント予約 REST API です。JavaScript / Node.js と PostgreSQL で構築し、Docker Compose で API とデータベースを起動できます。

## この作品で示す設計

- **同時予約と定員超過防止**: 予約・キャンセル・定員変更のトランザクションでイベント行を SELECT ... FOR UPDATE し、イベント単位で更新を直列化します。
- **再送に強い予約操作**: 同じユーザーが予約を再送しても予約行を重複作成しません。キャンセル済みの予約は再予約で復帰します。
- **認証と権限**: bcrypt によるパスワードハッシュ、短時間有効な JWT、イベント作成者だけが編集できる所有者チェック。
- **入力とデータの境界**: Zod によるリクエスト検証、SQL のプレースホルダー、DB 側の制約、共通エラー形式。
- **運用の基本**: DB マイグレーション、ヘルスチェック、graceful shutdown、コンテナビルドを行う GitHub Actions。

## 起動

必要なもの: Docker Desktop または Docker Engine と Docker Compose。

    Copy-Item .env.example .env

環境設定ファイルの JWT_SECRET と POSTGRES_PASSWORD をローカル用の値に変更してから起動します。

    docker compose up --build

API は http://localhost:3000、OpenAPI 定義は [openapi.yaml](./openapi.yaml) です。起動確認:

    curl http://localhost:3000/healthz

停止は docker compose down、DB データも消す場合は docker compose down -v です。

## API の使い方

### 1. アカウント作成とログイン

    curl.exe -X POST http://localhost:3000/api/v1/auth/register -H "Content-Type: application/json" -d '{"email":"demo@example.com","password":"a-strong-password-123"}'

    curl.exe -X POST http://localhost:3000/api/v1/auth/login -H "Content-Type: application/json" -d '{"email":"demo@example.com","password":"a-strong-password-123"}'

ログイン応答の data.accessToken を次の Authorization: Bearer <token> に渡します。

### 2. イベント作成と予約

    curl.exe -X POST http://localhost:3000/api/v1/events -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d '{"title":"Node.js勉強会","description":"小規模な勉強会","startsAt":"2027-04-01T10:00:00+09:00","capacity":20}'

    curl.exe http://localhost:3000/api/v1/events
    curl.exe -X POST http://localhost:3000/api/v1/events/<event-id>/reservations -H "Authorization: Bearer <token>"

### エンドポイント

| Method | Path | 認証 | 内容 |
| --- | --- | --- | --- |
| GET | /healthz | 不要 | DB 接続を含むヘルスチェック |
| POST | /api/v1/auth/register | 不要 | 会員登録 |
| POST | /api/v1/auth/login | 不要 | ログイン、JWT 発行 |
| GET | /api/v1/events | 不要 | イベント一覧。limit / offset 対応 |
| GET | /api/v1/events/:eventId | 不要 | イベント詳細と残席 |
| POST | /api/v1/events | 必要 | イベント作成 |
| PATCH | /api/v1/events/:eventId | 必要 | 作成者による編集 |
| POST | /api/v1/events/:eventId/reservations | 必要 | 自分の予約。再送可能 |
| DELETE | /api/v1/events/:eventId/reservations/me | 必要 | 自分の予約をキャンセル |
| GET | /api/v1/reservations/me | 必要 | 自分の予約一覧 |

エラーは { "error": { "code", "message", "details?", "requestId" } } 形式です。

## 同時実行制御

予約処理は以下を一つの DB トランザクションで実行します。

1. 対象イベント行を FOR UPDATE でロックする。
2. 既存予約を調べ、同一ユーザーの再送なら既存予約を返す。
3. 確定済み予約数を読み、残席がなければ 409 EVENT_FULL を返す。
4. 予約行を作成、またはキャンセル状態から確定状態に戻す。

同じイベントに対する予約書き込みが直列化されるため、複数リクエストが同時に到着しても定員を超えません。キャンセルと定員変更も同じイベント行をロックします。ロック範囲はイベント単位なので、別イベントの予約は独立して処理できます。

この方式は単一 PostgreSQL を使う小〜中規模サービスの題材として分かりやすさを優先しています。極端に人気のイベントでは一行ロックがボトルネックになるため、負荷計測後にキュー等を検討する余地があります。

## ディレクトリ構成

    src/
      app.js                 Express アプリと共通ミドルウェア
      server.js              DB pool、HTTP 起動、終了処理
      config/env.js          環境変数の検証
      db/migrate.js          マイグレーションランナー
      middleware/            認証、入力検証
      routes/                認証、イベント、予約 API
      lib/                   エラー型、トランザクション
    db/migrations/           バージョン管理された SQL
    openapi.yaml              API 定義
    Dockerfile
    docker-compose.yml

## ローカルで Node.js から起動

PostgreSQL を別途用意し、環境設定ファイルを作成したうえで:

    npm install
    npm run db:migrate
    npm run dev

npm run check は JavaScript の構文チェックです。Dockerfile は本番向け依存だけを含むイメージを作ります。

## GitHub に公開するとき

1. .env はコミットせず、GitHub Secrets やデプロイ先の環境変数を使います。
2. README の実行例を自分の環境で動かし、画面キャプチャや API の応答例を追記します。
3. リポジトリの About に Node.js, JavaScript, PostgreSQL, Docker, REST API を設定します。
4. 自分で実装した判断（ロック方式、制約、制限事項）を面接で説明できるようにします。

## 制限と次の改善候補

- JWT の有効期限は 1 時間で、リフレッシュトークンやログアウト用の失効リストはありません。
- レート制限はインメモリです。複数 API インスタンスに拡張する際は Redis など共有ストアが必要です。
- メール確認、パスワード再設定、決済、キャンセル待ちは対象外です。
- 本番公開前には TLS、秘密情報管理、DB バックアップ、監視、脅威モデルに合わせた追加対策が必要です。

## ライセンス

MIT License. See [LICENSE](./LICENSE).
