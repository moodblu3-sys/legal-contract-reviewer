#!/usr/bin/env node
import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { createBoxClient } from "./box.js";
import { getFileText, reviewContract, type ContractReviewStandpoint } from "./tools.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: process.env.BOX_ENV_PATH ?? resolve(__dirname, "..", ".env"), quiet: true });

const port = Number(process.env.PORT ?? 3000);
const signingSecret = process.env.SLACK_SIGNING_SECRET;
const botToken = process.env.SLACK_BOT_TOKEN;
const skipSignature = process.env.SLACK_SKIP_SIGNATURE === "true";
const searchFolderId = process.env.BOX_SEARCH_FOLDER_ID;
const pendingSelections = new Map<string, PendingSelection>();
const threadContexts = new Map<string, ThreadContext>();

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

type ParsedReviewText = {
  cleaned: string;
  standpoint: ContractReviewStandpoint;
  boxUrl?: string;
  fileName?: string;
  searchQuery: string;
  searchTerms: string[];
};

type SearchCandidate = {
  id: string;
  name?: string;
};

type PendingSelection = {
  candidates: SearchCandidate[];
  standpoint: ContractReviewStandpoint;
  expiresAt: number;
};

type ThreadContext = {
  file: SearchCandidate;
  standpoint: ContractReviewStandpoint;
  expiresAt: number;
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
  const searchTerms = buildSearchTerms(cleaned, explicitFileName, boxUrl);
  return {
    cleaned,
    standpoint,
    boxUrl,
    fileName: explicitFileName,
    searchQuery: searchTerms.join(" "),
    searchTerms,
  };
}

function buildSearchTerms(text: string, fileName?: string, boxUrl?: string): string[] {
  if (fileName) return [fileName];
  if (boxUrl) return [];

  const normalized = text
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[、。,.!?！？「」『』（）()]/g, " ")
    .replace(/\b(review|contract|box)\b/gi, " ")
    .replace(/について|に関して|に関する|との|という|の|と/g, " ")
    .replace(/契約書|契約|危ない|条項|記載|レビュー|見て|確認|リスク|側|立場|この|その|あの|ある|ない|です|ます/g, " ")
    .replace(/受託者|委託者|甲|乙|発注者|依頼者|ベンダー|委託先/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const tokens = normalized
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .slice(0, 4);
  return tokens;
}

function selectionKey(channel: string, threadTs?: string) {
  return `${channel}:${threadTs ?? "root"}`;
}

function parseSelectionNumber(text: string): number | undefined {
  const cleaned = text.replace(/<@[^>]+>/g, "").trim();
  const match = cleaned.match(/^(?:候補)?\s*([1-5１２３４５])(?:番|で|を|お願いします|です)?\s*$/);
  if (!match?.[1]) return undefined;
  return "１２３４５".includes(match[1]) ? "１２３４５".indexOf(match[1]) + 1 : Number(match[1]);
}

function pruneExpiredSelections() {
  const now = Date.now();
  for (const [key, value] of pendingSelections.entries()) {
    if (value.expiresAt < now) pendingSelections.delete(key);
  }
  for (const [key, value] of threadContexts.entries()) {
    if (value.expiresAt < now) threadContexts.delete(key);
  }
}

function normalizeSearchText(text: string) {
  return text
    .toLowerCase()
    .replace(/[・\s　、。,.!?！？「」『』（）()\-_]/g, "");
}

async function filterCandidatesByRequiredTerms(candidates: SearchCandidate[], terms: string[]) {
  if (terms.length === 0) return candidates;
  const normalizedTerms = terms.map(normalizeSearchText).filter(Boolean);
  const matched: SearchCandidate[] = [];
  for (const candidate of candidates) {
    const text = await getFileText(getClient(), candidate.id);
    const haystack = normalizeSearchText(`${candidate.name ?? ""}\n${text}`);
    if (normalizedTerms.every((term) => haystack.includes(term))) {
      matched.push(candidate);
    }
  }
  return matched;
}

async function searchContractCandidates(query: string, requiredTerms: string[]): Promise<SearchCandidate[]> {
  if (!query) return [];
  const results = await getClient().search.searchForContent({
    query,
    type: "file",
    contentTypes: ["name", "file_content"],
    fileExtensions: ["pdf"],
    ancestorFolderIds: searchFolderId ? [searchFolderId] : undefined,
    limit: 5,
    fields: ["id", "name", "type"],
  });
  const candidates =
    results.entries?.flatMap((entry) => {
      const item = entry as { id?: string; name?: string; type?: string };
      return item.type === "file" && item.id ? [{ id: item.id, name: item.name }] : [];
    }) ?? [];
  return filterCandidatesByRequiredTerms(candidates, requiredTerms);
}

function formatCandidatePrompt(candidates: SearchCandidate[], query: string) {
  const rows = candidates
    .map((candidate, index) => `${index + 1}. ${candidate.name ?? candidate.id}`)
    .join("\n");
  return [
    `候補が${candidates.length}件見つかりました。どの契約書をレビューしますか？`,
    query ? `検索語: ${query}` : undefined,
    "",
    rows,
    "",
    "このスレッドで番号だけ返信してください。例: `1`",
  ].filter(Boolean).join("\n");
}

function formatFollowUpAnswer(
  file: SearchCandidate,
  standpoint: ContractReviewStandpoint,
  answer: string,
  citations: { file?: string; snippet?: string }[]
) {
  return [
    `*追加確認（${standpoint}）*`,
    `対象: ${file.name ?? file.id} / 出典: ${citations.length}件`,
    "",
    answer,
  ].join("\n");
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
  const data = (await response.json()) as {
    ok?: boolean;
    error?: string;
    needed?: string;
    provided?: string;
    ts?: string;
  };
  if (!data.ok) {
    const scopeHint = data.needed ? ` needed=${data.needed} provided=${data.provided ?? ""}` : "";
    throw new Error(`Slack API error: ${data.error ?? response.statusText}${scopeHint}`);
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
    pruneExpiredSelections();
    const key = selectionKey(request.channel, request.threadTs);
    const selectionNumber = parseSelectionNumber(request.text);
    const pending = selectionNumber ? pendingSelections.get(key) : undefined;
    if (pending && selectionNumber) {
      const candidate = pending.candidates[selectionNumber - 1];
      if (!candidate) {
        await postSlackMessage(request.channel, "候補番号が範囲外です。1〜5の番号で返信してください。", request.threadTs);
        return;
      }
      pendingSelections.delete(key);
      await reviewResolvedCandidate(request, candidate, pending.standpoint);
      return;
    }

    const parsed = parseReviewText(request.text);
    const context = threadContexts.get(key);
    if (context && !parsed.fileName && !parsed.boxUrl) {
      await answerFollowUp(request, context, parsed.cleaned);
      return;
    }

    if (!parsed.fileName && !parsed.boxUrl) {
      const candidates = await searchContractCandidates(parsed.searchQuery, parsed.searchTerms);
      if (candidates.length === 0) {
        await postSlackMessage(
          request.channel,
          "契約書候補が見つかりませんでした。会社名、契約種別、Box URL、またはPDF名をもう少し具体的に指定してください。",
          request.threadTs
        );
        return;
      }
      if (candidates.length > 1) {
        pendingSelections.set(key, {
          candidates,
          standpoint: parsed.standpoint,
          expiresAt: Date.now() + 10 * 60 * 1000,
        });
        await postSlackMessage(request.channel, formatCandidatePrompt(candidates, parsed.searchQuery), request.threadTs);
        return;
      }
      await reviewResolvedCandidate(request, candidates[0], parsed.standpoint);
      return;
    }

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
    threadContexts.set(key, {
      file: { id: result.file.id, name: result.file.name },
      standpoint: result.standpoint,
      expiresAt: Date.now() + 60 * 60 * 1000,
    });
    const chunks = splitSlackText(formatSlackReview(result));
    let threadTs = request.threadTs;
    for (const chunk of chunks) {
      threadTs = (await postSlackMessage(request.channel, chunk, threadTs)) ?? threadTs;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await postSlackMessage(request.channel, `レビューに失敗しました: ${message}`, request.threadTs);
    } catch (postError) {
      const postMessage = postError instanceof Error ? postError.message : String(postError);
      console.error(`Failed to post Slack error message: ${postMessage}`);
      console.error(`Original review error: ${message}`);
    }
  }
}

async function reviewResolvedCandidate(
  request: ReviewRequest,
  candidate: SearchCandidate,
  standpoint: ContractReviewStandpoint
) {
  await postSlackMessage(
    request.channel,
    `レビューを開始しました。対象: ${candidate.name ?? candidate.id} / 立場: ${standpoint}`,
    request.threadTs
  );
  const result = await reviewContract(getClient(), {
    fileId: candidate.id,
    standpoint,
  });
  threadContexts.set(selectionKey(request.channel, request.threadTs), {
    file: { id: result.file.id, name: result.file.name ?? candidate.name },
    standpoint: result.standpoint,
    expiresAt: Date.now() + 60 * 60 * 1000,
  });
  const chunks = splitSlackText(formatSlackReview(result));
  let threadTs = request.threadTs;
  for (const chunk of chunks) {
    threadTs = (await postSlackMessage(request.channel, chunk, threadTs)) ?? threadTs;
  }
}

async function answerFollowUp(request: ReviewRequest, context: ThreadContext, userText: string) {
  const prompt = `あなたは企業法務の専門家です。添付の契約書について、すでに「${context.standpoint}」の立場でレビューしています。

ユーザーから次の追加依頼が来ました：
「${userText}」

対応方針：
- 新しい契約書検索は行わず、この契約書だけを対象に回答する。
- 条文番号や論点が指定されている場合は、その条文・論点に絞る。
- 「第1条からいこう」「第一条から」などの表現は、第1条について優先的に検討し、リスク、交渉方針、具体的な修正文案を出す依頼として扱う。
- 原文にない内容は捏造しない。
- 回答は自然な日本語で簡潔に書く。

出力形式：
- 対象条項
- ${context.standpoint}から見た問題点
- 推奨アクション
- 修正文案例`;

  const res = await getClient().ai.createAiAsk({
    mode: "single_item_qa",
    prompt,
    items: [{ id: context.file.id, type: "file" }],
    includeCitations: true,
  });
  const citations =
    res?.citations?.map((citation) => ({
      file: citation.name ?? citation.id,
      snippet: citation.content,
    })) ?? [];
  const chunks = splitSlackText(
    formatFollowUpAnswer(context.file, context.standpoint, res?.answer ?? "", citations)
  );
  let threadTs = request.threadTs;
  for (const chunk of chunks) {
    threadTs = (await postSlackMessage(request.channel, chunk, threadTs)) ?? threadTs;
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
