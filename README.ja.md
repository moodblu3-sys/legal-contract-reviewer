# legal-contract-reviewer（日本語概要）

**Box AI API** を、ガバナンス付きの業務特化ワークフローに仕立てる **MCPサーバー**。
Boxのネイティブ機能（公式MCP / Box AI API）の「上に乗るソリューション層」を実装したリファレンス。

## なぜ作ったか
Boxは汎用MCPサーバーと強力なBox AI APIをすでに提供している。顧客がネイティブ機能を「超える」のは、
規制業種における**ガバナンス付きの業務特化ワークフロー**——契約インテリジェンス、コンプライアンスの
タグ付け、監査証跡——を求めるとき。本プロジェクトは、Box自身のプリミティブを組み合わせてその層を作り、
MCPで公開することで Claude / Cursor からそのまま使えるようにしたもの。

## ツール
| ツール | 内容 | 使うBox機能 |
|------|------|-----------|
| `box_ai_ask` | 複数ファイルを根拠に**出典付き**で回答 | Box AI `/ai/ask` |
| `box_extract_contract` | **日本語契約書**の主要項目（相手方・期間・自動更新・解約予告・金額・準拠法）を抽出 | Box AI `/ai/extract_structured` |
| `box_governance_scan` | PII・機密情報を検出し**リスクバンド**に集約 | テキスト表現 + ポリシールール |
| `box_writeback_metadata` | 抽出結果を**エンタープライズメタデータ**として書き戻し（監査可能） | Box Metadata API |
| `box_post_summary_comment` | レビュー要約をファイルに**コメント**として添付 | Box Comments API |

エージェントで連結すると「契約取り込み → レビュー → ガバナンス」の一連の流れが、すべてBox内・監査可能な
形で回る。

## セットアップ
英語の [`README.md`](README.md) を参照（Developer Console でCustom App作成 → Developer Token発行 →
`.env` に設定 → `npm run build && npm start`）。
