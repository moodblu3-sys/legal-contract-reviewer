#!/usr/bin/env node
import { config } from "dotenv";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "..", ".env"), quiet: true });
/**
 * legal-contract-reviewer — an MCP server exposing governed Box AI workflows.
 *
 * Transport: stdio (works with Claude Desktop, Cursor, and the MCP Inspector).
 * Each tool is a *solution operation*, not a raw API passthrough.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createBoxClient } from "./box.js";
import {
  aiAskWithCitations,
  extractContractFields,
  findContractCandidates,
  reviewContract,
  governanceScan,
  writebackMetadata,
  postSummaryComment,
} from "./tools.js";

const client = createBoxClient();
const server = new McpServer({ name: "legal-contract-reviewer", version: "0.1.0" });

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}
function fail(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return { isError: true, content: [{ type: "text" as const, text: `Error: ${msg}` }] };
}

server.registerTool(
  "box_ai_ask",
  {
    title: "Ask Box AI with citations",
    description:
      "Answer a question grounded in one or more Box files. Returns the answer plus source citations.",
    inputSchema: {
      fileIds: z.array(z.string()).min(1).describe("Box file IDs to ground the answer on"),
      question: z.string().describe("The question to answer"),
    },
  },
  async ({ fileIds, question }) => {
    try {
      return ok(await aiAskWithCitations(client, { fileIds, question }));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "box_extract_contract",
  {
    title: "Extract contract fields (JP)",
    description:
      "Extract key Japanese contract fields (相手方/契約期間/自動更新/解約予告/金額/準拠法) from a Box file via Box AI extract_structured.",
    inputSchema: { fileId: z.string().describe("Box file ID of the contract") },
  },
  async ({ fileId }) => {
    try {
      return ok(await extractContractFields(client, { fileId }));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "box_find_contracts",
  {
    title: "Find contract PDFs in Box",
    description:
      "Find Japanese contract PDF candidates in Box from a natural-language query such as company name and contract type. If the user identifies a contract by company name or contract type and the target is ambiguous, use this tool before reviewing.",
    inputSchema: {
      query: z.string().describe("Natural-language search query, for example: グローバルコマースとの業務委託契約"),
      limit: z.number().int().min(1).max(10).default(5).describe("Maximum number of candidates to return"),
    },
  },
  async ({ query, limit }) => {
    try {
      return ok(await findContractCandidates(client, { query, limit }));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "box_review_contract",
  {
    title: "Review contract risks (JP)",
    description:
      "Review a Japanese contract from the 委託者 or 受託者 standpoint. If the user identifies the target by company name or contract type, pass that natural-language target as contractQuery. The contract can also be identified by Box URL, file name, or file ID. Returns legal concerns, severity, recommended actions, and citations.",
    inputSchema: {
      contractQuery: z.string().optional().describe("Natural-language target contract query, for example: グローバルコマースとの業務委託契約"),
      boxUrl: z.string().optional().describe("Box file URL, when the user pasted a Box link"),
      fileName: z.string().optional().describe("Contract PDF file name to search for in Box"),
      fileId: z.string().optional().describe("Box file ID, for fallback/debug use"),
      standpoint: z.enum(["委託者", "受託者"]).default("受託者").describe("Review standpoint inferred from the user's request"),
    },
  },
  async ({ fileId, boxUrl, fileName, contractQuery, standpoint }) => {
    try {
      return ok(await reviewContract(client, { fileId, boxUrl, fileName, contractQuery, standpoint }));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "box_governance_scan",
  {
    title: "Governance / PII scan",
    description:
      "Scan a Box file for PII and sensitive content, then roll findings up to a risk band (none/low/medium/high).",
    inputSchema: { fileId: z.string().describe("Box file ID to scan") },
  },
  async ({ fileId }) => {
    try {
      return ok(await governanceScan(client, { fileId }));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "box_writeback_metadata",
  {
    title: "Write metadata back to Box",
    description:
      "Persist extracted/derived fields onto a Box file as enterprise metadata (auditable record).",
    inputSchema: {
      fileId: z.string(),
      templateKey: z.string().describe("Enterprise metadata template key"),
      data: z.record(z.unknown()).describe("Key/value pairs to write"),
    },
  },
  async ({ fileId, templateKey, data }) => {
    try {
      return ok(await writebackMetadata(client, { fileId, templateKey, data }));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "box_post_summary_comment",
  {
    title: "Post review summary as a Box comment",
    description: "Attach a human-readable review summary to a Box file as a comment.",
    inputSchema: { fileId: z.string(), message: z.string() },
  },
  async ({ fileId, message }) => {
    try {
      return ok(await postSummaryComment(client, { fileId, message }));
    } catch (e) {
      return fail(e);
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("legal-contract-reviewer MCP server running on stdio");
