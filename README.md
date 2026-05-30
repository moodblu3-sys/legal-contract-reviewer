# legal-contract-reviewer

> デモ画像プレースホルダ：Claude Desktopで `Boxの sample_risky_contract.pdf を受託者の立場でレビューして` と依頼し、契約リスクレビューが返る画面を掲載予定。

**Box AI API** を使い、日本語契約書を法務観点でレビューする **MCPサーバー**。
Box公式MCPやBox AI APIを置き換えるものではなく、その上に乗る「業務特化のソリューション層」として実装したリファレンスです。

本プロジェクトはポートフォリオ兼リファレンス実装であり、Box公式製品ではありません。

## ねらい

Boxは、汎用MCPサーバーと強力なBox AI APIをすでに提供しています。
一方、エンタープライズ顧客が実務で必要とするのは、契約レビュー、リスク分類、監査証跡、メタデータ反映といった業務プロセスに沿った体験です。

このプロジェクトでは、契約書本文を外部LLMに出さず、Box AIを使ってBox境界内で処理する構成を取ります。
日本のエンタープライズ利用を想定し、個人情報・秘密情報・契約リスクを扱う前提で、ガバナンスを重視しています。

## デモ体験

ユーザーはMCPツール名やBox file IDを意識しません。
Claude Desktop上で、自然言語で依頼します。

```text
Boxの sample_risky_contract.pdf を受託者の立場でレビューして
```

```text
Boxの sample_risky_contract.pdf を委託者側でリスクレビューして
```

```text
このBox URLの契約書を、受託者側でレビューして
```

内部では `box_review_contract` が呼ばれ、Box URL、ファイル名、またはfile IDから対象ファイルを解決します。
同じ契約書でも、委託者・受託者の立場を変えてレビューできます。

## 主な機能

| ツール | 内容 | 使うBox機能 |
|------|------|-----------|
| `box_review_contract` | 日本語契約書を法務観点でレビュー。重大度順の懸念点、推奨アクション、出典を返す | Box AI `/ai/ask` |
| `box_extract_contract` | 契約相手方、期間、自動更新、解約予告、金額、準拠法などを構造化抽出 | Box AI `/ai/extract_structured` |
| `box_governance_scan` | PII・機密情報を検出し、リスクバンドに集約 | Boxテキスト表現 + ポリシールール |
| `box_writeback_metadata` | 抽出・判定結果をエンタープライズメタデータとして書き戻し | Box Metadata API |
| `box_post_summary_comment` | レビュー要約をBoxファイルのコメントとして残す | Box Comments API |
| `box_ai_ask` | Box内のファイルを根拠に、出典付きで質問応答 | Box AI `/ai/ask` |

エージェントで連結すると、次の流れをBox内で完結できます。

```text
契約取り込み → 契約レビュー → ガバナンス確認 → メタデータ反映 → コメント記録
```

## アーキテクチャ

詳細は [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) を参照。

```text
Claude Desktop / Cursor などのMCPホスト
        │ stdio
        ▼
legal-contract-reviewer
        ├─ Box AI API（ask / extract_structured）
        ├─ Box Content API（files / comments）
        ├─ Box Metadata API
        └─ ガバナンスルール
```

## セットアップ

### 1. Boxアプリを作成

1. Box Developer Consoleを開く
2. Custom Appを作成
3. 認証方式を選択
   - 簡易デモ：Developer Token
   - 継続利用：Client Credentials Grant（CCG）
4. 必要なスコープを有効化
   - ファイル読み取り
   - Box AI
   - メタデータ
   - コメント

### 2. 認証情報を設定

短時間のデモはDeveloper Tokenで動かせます。

```bash
cp .env.template .env
# .env に BOX_DEV_TOKEN を設定
```

CCGで動かす場合は、`.env` に次を設定します。

```bash
BOX_CLIENT_ID=
BOX_CLIENT_SECRET=
BOX_ENTERPRISE_ID=
```

`BOX_ENTERPRISE_ID` を使う場合、MCPサーバーはサービスアカウントとして動作します。
そのため、サービスアカウントが所有または参照できるBoxファイルだけをレビューできます。

ユーザー代理で実行したい場合は `BOX_USER_ID` を使います。
ただし、無料のBox Developer環境では as-user が `invalid_grant` になる場合があります。
有料のEnterprise環境では、管理者承認とアプリ設定によりas-user構成を取れます。

### 3. ビルドと起動

```bash
npm install
npm run build
npm start
```

### 4. Claude Desktopに接続

`claude_desktop_config.example.json` を参考に、Claude DesktopのMCP設定へ `dist/index.js` の絶対パスを登録します。
設定後、Claude Desktopを再起動します。

例：

```text
Boxの sample_risky_contract.pdf を受託者の立場でレビューして
```

MCP Inspectorでも確認できます。

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

## デモ用ファイル

脆弱な条項を意図的に含む `sample_risky_contract.pdf` を、Boxの `legal-contract-reviewer-demo` フォルダへアップロード済みです。
ファイル名検索で参照できます。

デモ例：

```text
Boxの sample_risky_contract.pdf を受託者の立場でレビューして
```

```text
Boxの sample_risky_contract.pdf を委託者側でリスクレビューして
```

## セキュリティとガバナンス

- 契約書本文はこのMCPサーバーに保存しません
- 契約書の解析はBox AI APIを通じて実行します
- `.env` は `.gitignore` 済みで、リポジトリへコミットしません
- Developer Tokenは60分で失効するため、デモ用途です
- CCGではサービスアカウントの権限範囲がそのまま参照可能範囲になります
- `box_governance_scan` のPII検出はPoC実装です。本番では企業の分類ポリシーに合わせてルール化します

## 技術スタック

- TypeScript
- `box-typescript-sdk-gen`
- `@modelcontextprotocol/sdk`
- `zod`
- Box AI API
- Box Content API
- Box Metadata API
