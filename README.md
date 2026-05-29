# box-ai-solution-kit

A **Model Context Protocol (MCP) server** that turns the **Box AI API** into governed, vertical
document workflows — a *solution layer* on top of Box's native platform for enterprises that
outgrow out-of-the-box features.

> **Why this exists.** Box already ships an excellent generic MCP server and a powerful Box AI API.
> Where enterprise customers — especially in regulated industries — outgrow the native features is in
> *governed, business-specific workflows*: contract intelligence, compliance tagging, and audit trails
> that map to a data-classification policy. This project demonstrates how to compose Box's own
> primitives into that solution layer, and expose it through MCP so it drops straight into Claude,
> Cursor, or any MCP host.

This is a portfolio / reference implementation, not a Box product.

## What it does

Each tool is a **solution operation**, not a raw API passthrough:

| Tool | What it does | Box primitive used |
|------|--------------|--------------------|
| `box_ai_ask` | Answers a question grounded in one or more Box files, **with citations** | Box AI `/ai/ask` |
| `box_extract_contract` | Extracts key **Japanese** contract fields (counterparty, term, auto-renewal, termination notice, amount, governing law) | Box AI `/ai/extract_structured` |
| `box_governance_scan` | Scans content for PII / sensitive markers and rolls findings up to a **risk band** | text representation + policy rules |
| `box_writeback_metadata` | Persists extracted/derived fields back onto the file as **enterprise metadata** (auditable record) | Box Metadata API |
| `box_post_summary_comment` | Attaches a human-readable review summary to the file as a **comment** (in-context review trail) | Box Comments API |

Chained together by an agent, these implement an end-to-end **"contract intake → review → govern"**
workflow: extract the key terms, scan for sensitive data, write the structured result back as metadata,
and leave a reviewer-facing summary comment — all inside Box, all auditable.

## Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). At a glance:

```
MCP host (Claude / Cursor)
        │  stdio
        ▼
box-ai-solution-kit  ──►  Box AI API  (ask / extract_structured)
        │                 Box Content API (metadata / comments / files)
        └─ governance rules (policy-driven, not hard-coded in production)
```

## Setup

### 1. Get a Box developer account + app (≈ 5 min)
1. Sign up for a free Box account and open the **Developer Console** (`app.box.com/developers/console`).
2. **Create Platform App → Custom App**. Pick an auth method (either works for a Developer Token).
3. Open the app's **Configuration** tab → **Generate Developer Token** (valid 60 min).

> For something more durable than a 60-minute token, configure **Client Credentials Grant (CCG)** and
> authorize the app in the Admin Console. The server supports both — see `.env.template`.

### 2. Run
```bash
npm install
npm run build
cp .env.template .env   # paste BOX_DEV_TOKEN
npm start               # or wire into an MCP host (below)
```

### 3. Wire into Claude Desktop
Copy `claude_desktop_config.example.json` into your Claude Desktop config, fix the absolute path and
token, and restart. Then ask Claude: *"Extract the contract fields from Box file 123, scan it for PII,
and post a review summary."*

You can also drive it with the MCP Inspector:
```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

## Security notes
- Developer Tokens are short-lived and scoped to the developer's own account — demo only.
- Governance rules are conservative defaults; in a real engagement they are driven by the customer's
  classification policy (ISMS / 個人情報保護法 / Pマーク), not hard-coded.
- No document content is persisted by this server; it streams through to Box AI and back.

## Tech
TypeScript · `box-typescript-sdk-gen` (official Box SDK) · `@modelcontextprotocol/sdk` · `zod`.

---
日本語の概要は [`README.ja.md`](README.ja.md) を参照。
