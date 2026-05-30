#!/usr/bin/env node
import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { createBoxClient } from "./box.js";
import { reviewContract, type ContractReviewStandpoint } from "./tools.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: process.env.BOX_ENV_PATH ?? resolve(__dirname, "..", ".env"), quiet: true });

const port = Number(process.env.PORT ?? 3000);
const signingSecret = process.env.SLACK_SIGNING_SECRET;
const botToken = process.env.SLACK_BOT_TOKEN;
const skipSignature = process.env.SLACK_SKIP_SIGNATURE === "true";
const defaultContractFileName = process.env.DEFAULT_CONTRACT_FILE_NAME ?? "sample_risky_contract.pdf";

type ReviewRequest = {
  text: string;
  channel: string;
  threadTs?: string;
};

type SlackEventEnvelope = {
  type?: string;
  challenge?: string;
  event?: {
    type?: string;
    text?: string;
    channel?: string;
    ts?: string;
    thread_ts?: string;
    bot_id?: string;
    subtype?: string;
  };
};

let client: ReturnType<typeof createBoxClient> | undefined;

function getClient() {
  client ??= createBoxClient();
  return client;
}

function sendText(res: ServerResponse, status: number, text: string) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(text);
}

function sendJson(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, rejectBody) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        req.destroy();
        rejectBody(new Error("Request body is too large."));
      }
    });
    req.on("end", () => resolveBody(body));
    req.on("error", rejectBody);
  });
}

function verifySlackSignature(req: IncomingMessage, rawBody: string): boolean {
  if (skipSignature) return true;
  if (!signingSecret) return false;

  const timestamp = req.headers["x-slack-request-timestamp"];
  const signature = req.headers["x-slack-signature"];
  if (typeof timestamp !== "string" || typeof signature !== "string") return false;

  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > 60 * 5) return false;

  const base = `v0:${timestamp}:${rawBody}`;
  const digest = `v0=${createHmac("sha256", signingSecret).update(base).digest("hex")}`;
  const expected = Buffer.from(digest);
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function parseReviewText(text: string) {
  const cleaned = text.replace(/<@[^>]+>/g, "").trim();
  const standpoint: ContractReviewStandpoint =
    /委託者|甲側|発注者|依頼者/.test(cleaned)
      ? "委託者"
      : /受託者|乙側|ベンダー|委託先/.test(cleaned)
        ? "受託者"
        : "受託者";
  const boxUrl = cleaned.match(/https?:\/\/\S*box\S*/i)?.[0]?.replace(/[)、）\].。]+$/, "");
  const explicitFileName = cleaned.match(/[^\s"'`「」]+\.pdf/i)?.[0];
  const fileName = explicitFileName ?? defaultContractFileName;
  return { cleaned, standpoint, boxUrl, fileName };
}

function splitSlackText(text: string, maxLength = 3300): string[] {
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining.length > maxLength) {
    const cutAt = Math.max(
      remaining.lastIndexOf("\n\n", maxLength),
      remaining.lastIndexOf("\n", maxLength),
      remaining.lastIndexOf("。", maxLength)
    );
    const end = cutAt > 800 ? cutAt + 1 : maxLength;
    chunks.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

async function postSlackMessage(channel: string, text: string, threadTs?: string) {
  if (!botToken) {
    throw new Error("SLACK_BOT_TOKEN is not set.");
  }

  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      authorization: `Bearer ${botToken}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel,
      text,
      mrkdwn: true,
      thread_ts: threadTs,
      unfurl_links: false,
      unfurl_media: false,
    }),
  });
  const data = (await response.json()) as { ok?: boolean; error?: string; ts?: string };
  if (!data.ok) {
    throw new Error(`Slack API error: ${data.error ?? response.statusText}`);
  }
  return data.ts;
}

function formatSlackReview(result: Awaited<ReturnType<typeof reviewContract>>) {
  const source = result.file.name ?? result.file.id;
  const citations = result.citations.length;
  return [
    `*契約レビュー結果（${result.standpoint}）*`,
    `対象: ${source} / 出典: ${citations}件`,
    "",
    result.answer,
  ].join("\n");
}

async function handleReviewRequest(request: ReviewRequest) {
  try {
    const parsed = parseReviewText(request.text);
    await postSlackMessage(
      request.channel,
      `レビューを開始しました。対象: ${parsed.fileName ?? parsed.boxUrl ?? "未指定"} / 立場: ${parsed.standpoint}`,
      request.threadTs
    );
    const result = await reviewContract(getClient(), {
      fileName: parsed.fileName,
      boxUrl: parsed.boxUrl,
      standpoint: parsed.standpoint,
    });
    const chunks = splitSlackText(formatSlackReview(result));
    let threadTs = request.threadTs;
    for (const chunk of chunks) {
      threadTs = (await postSlackMessage(request.channel, chunk, threadTs)) ?? threadTs;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await postSlackMessage(request.channel, `レビューに失敗しました: ${message}`, request.threadTs);
  }
}

async function handleEvents(req: IncomingMessage, res: ServerResponse, rawBody: string) {
  const payload = JSON.parse(rawBody) as SlackEventEnvelope;
  if (payload.type === "url_verification") {
    sendJson(res, 200, { challenge: payload.challenge });
    return;
  }

  sendText(res, 200, "ok");

  const event = payload.event;
  if (!event?.channel || !event.text || event.bot_id || event.subtype) return;
  if (event.type !== "app_mention" && event.type !== "message") return;

  void handleReviewRequest({
    text: event.text,
    channel: event.channel,
    threadTs: event.thread_ts ?? event.ts,
  });
}

async function handleCommand(res: ServerResponse, rawBody: string) {
  const params = new URLSearchParams(rawBody);
  const text = params.get("text") ?? "";
  const channel = params.get("channel_id");
  const threadTs = params.get("thread_ts") ?? undefined;
  if (!channel) {
    sendJson(res, 200, { response_type: "ephemeral", text: "channel_idを取得できませんでした。" });
    return;
  }

  sendJson(res, 200, {
    response_type: "ephemeral",
    text: "契約レビューを開始しました。結果はこのチャンネルに投稿します。",
  });

  void handleReviewRequest({ text, channel, threadTs });
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method !== "POST") {
      sendText(res, 404, "not found");
      return;
    }

    const rawBody = await readBody(req);
    if (!verifySlackSignature(req, rawBody)) {
      sendText(res, 401, "invalid slack signature");
      return;
    }

    if (url.pathname === "/slack/events") {
      await handleEvents(req, res, rawBody);
      return;
    }

    if (url.pathname === "/slack/commands") {
      await handleCommand(res, rawBody);
      return;
    }

    sendText(res, 404, "not found");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendText(res, 500, message);
  }
});

server.listen(port, () => {
  console.error(`Slack contract review app listening on http://localhost:${port}`);
});
