# push-worker（プッシュ通知の送信用 Cloudflare Worker）

通知（`notifications`）が作成されると、ページ（`account-widgets.js` の `VOCABOOST_SEND_PUSH`）がこのWorkerに送信を依頼します。
Workerは依頼者のログインを確認し、宛先ユーザーのスマホ（`pushTokens` に登録された端末）へ Firebase Cloud Messaging で送信します。

- Cloudflare Workers の無料プラン（1日10万リクエストまで）で動きます。
- Firebase は Spark（無料）プランのままで大丈夫です（Cloud Messaging 自体は無料）。

## 準備するもの

- Cloudflare のアカウント（無料。カード登録は不要）
- Node.js（`npx wrangler` を使うため）

## デプロイ手順

1. **サービスアカウントの秘密鍵を取得する**
   Firebaseコンソール →「プロジェクトの設定」→「サービス アカウント」→「新しい秘密鍵を生成」でJSONファイルをダウンロードする。
   **このファイルは絶対にリポジトリに入れないこと**（Firestoreを管理者として読み書きできてしまうため）。

2. **Workerをデプロイする**
   ```sh
   cd push-worker
   npm install
   npx wrangler login
   npx wrangler deploy
   ```
   最後に表示される `https://vocaboost-push.<あなたのサブドメイン>.workers.dev` がWorkerのURL。
   初回のデプロイで自分自身への接続（`wrangler.toml` の `services`）がエラーになる場合は、その行を一時的にコメントアウトしてデプロイし、戻してからもう一度デプロイする。

3. **秘密鍵をWorkerに登録する**
   ```sh
   npx wrangler secret put FIREBASE_SERVICE_ACCOUNT < ダウンロードした秘密鍵.json
   ```

4. **サイト側の設定**
   - `account-widgets.js` の `PUSH_WORKER_URL` に手順2のURLを貼り付ける。
   - Firebaseコンソール →「プロジェクトの設定」→「Cloud Messaging」→「ウェブプッシュ証明書」で鍵ペアを生成し、公開鍵を `account-widgets.js` の `PUSH_VAPID_KEY` に貼り付ける。
     同じ画面で「Firebase Cloud Messaging API (V1)」が「有効」になっていることも確認する。
   - `firestore.rules` を Firebaseコンソール（Firestore Database → ルール）に反映する（`pushTokens`・`pushSent` を追加している）。

## 補足

- 管理者のメールアドレスは `wrangler.toml` の `ADMIN_EMAILS` にもある。管理者を変更したら、ここも書き換えて再デプロイする。
- 呼び出し元のサイトを限定したい場合は、`wrangler.toml` の `[vars]` に `ALLOWED_ORIGIN = "https://（サイトのドメイン）"` を追加する（無くても、ログイン中のユーザーしか送信を依頼できない）。
- 送信の記録は Cloudflare のダッシュボード（Workers → vocaboost-push → ログ）か `npx wrangler tail` で確認できる。
- テスト: `npm test`（GoogleのAPIは偽物に差し替えて動作を確認する）
