/**
 * Solution-grade tools. Each one composes the Box platform (content + Box AI API)
 * into something an enterprise customer would actually buy — not a thin wrapper over one endpoint.
 */
import type { BoxClient } from "box-typescript-sdk-gen";
import { readByteStream } from "box-typescript-sdk-gen/internal";
import { GOVERNANCE_RULES, rollupRisk, type RiskBand } from "./governance.js";

export type ContractReviewStandpoint = "委託者" | "受託者";
type MetadataScope = "enterprise" | "global";

type ReviewMetadataFieldMapping = Partial<{
  reviewStatus: string;
  reviewedAt: string;
  reviewStandpoint: string;
  reviewSummary: string;
  highestSeverity: string;
  citationsCount: string;
}>;

type ContractFileReference = {
  fileId?: string;
  boxUrl?: string;
  fileName?: string;
  contractQuery?: string;
};

type ReviewMetadataOptions = {
  writeMetadata?: boolean;
  metadataTemplateKey?: string;
  metadataScope?: MetadataScope;
  metadataFieldMapping?: ReviewMetadataFieldMapping;
  metadata?: Record<string, unknown>;
};

type ResolvedContractFile = {
  id: string;
  name?: string;
  matchedBy: "fileId" | "boxUrl" | "fileName" | "contractQuery";
};

export type ContractSearchCandidate = {
  id: string;
  name?: string;
};

function extractFileIdFromBoxUrl(boxUrl: string): string | undefined {
  const patterns = [
    /\/file\/(\d+)/,
    /\/files\/(\d+)/,
    /[?&]file_id=(\d+)/,
  ];
  for (const pattern of patterns) {
    const match = boxUrl.match(pattern);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

async function resolveContractFile(
  client: BoxClient,
  ref: ContractFileReference
): Promise<ResolvedContractFile> {
  if (ref.fileId) return { id: ref.fileId, matchedBy: "fileId" };

  if (ref.boxUrl) {
    const fileId = extractFileIdFromBoxUrl(ref.boxUrl);
    if (!fileId) {
      throw new Error("Box URLからファイルIDを特定できませんでした。BoxのファイルURLを指定してください。");
    }
    return { id: fileId, matchedBy: "boxUrl" };
  }

  if (ref.fileName) {
    const results = await client.search.searchForContent({
      query: `"${ref.fileName}"`,
      type: "file",
      contentTypes: ["name"],
      fileExtensions: ["pdf"],
      ancestorFolderIds: process.env.BOX_SEARCH_FOLDER_ID ? [process.env.BOX_SEARCH_FOLDER_ID] : undefined,
      limit: 5,
      fields: ["id", "name", "type"],
    });
    const files =
      results.entries?.flatMap((entry) => {
        const item = entry as { id?: string; name?: string; type?: string };
        return item.type === "file" && item.id ? [{ id: item.id, name: item.name }] : [];
      }) ?? [];
    const exactMatches = files.filter(
      (entry) => entry.name?.toLowerCase() === ref.fileName?.toLowerCase()
    );

    if (exactMatches.length === 1) {
      return { id: exactMatches[0].id, name: exactMatches[0].name, matchedBy: "fileName" };
    }

    if (files.length === 1) {
      return { id: files[0].id, name: files[0].name, matchedBy: "fileName" };
    }

    if (files.length > 1) {
      const candidates = files.map((entry) => entry.name ?? entry.id).join(", ");
      throw new Error(`候補が複数見つかりました。対象を絞ってください: ${candidates}`);
    }

    throw new Error(`Box上で "${ref.fileName}" というPDFが見つかりませんでした。`);
  }

  if (ref.contractQuery) {
    const candidates = await findContractCandidates(client, { query: ref.contractQuery });
    if (candidates.length === 1) {
      return { id: candidates[0].id, name: candidates[0].name, matchedBy: "contractQuery" };
    }

    if (candidates.length > 1) {
      const names = candidates.map((entry, index) => `${index + 1}. ${entry.name ?? entry.id}`).join("\n");
      throw new Error(`候補が複数見つかりました。どの契約書か選んでください。\n${names}`);
    }

    throw new Error(`Box上で "${ref.contractQuery}" に一致するPDFが見つかりませんでした。`);
  }

  throw new Error("レビュー対象を指定してください。Box URL、ファイル名、fileId、または自然文のcontractQueryが必要です。");
}

/** Fetch the plain-text representation of a Box file so we can scan / cite it locally. */
export async function getFileText(client: BoxClient, fileId: string): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const file = await client.files.getFileById(fileId, {
      queryParams: { fields: ["representations"] },
      headers: { xRepHints: "[extracted_text]" },
    });
    const representation = file.representations?.entries?.find(
      (entry) => entry.representation === "extracted_text"
    );

    if (!representation) {
      throw new Error(`No extracted_text representation is available for file ${fileId}.`);
    }

    if (representation.status?.state === "success" && representation.content?.urlTemplate) {
      const url = representation.content.urlTemplate.replace("{+asset_path}", "");
      const response = await client.makeRequest({
        method: "GET",
        url,
        responseFormat: "binary",
      });
      if (!response.content) {
        throw new Error(`Downloaded extracted_text representation was empty for file ${fileId}.`);
      }
      return (await readByteStream(response.content)).toString("utf8");
    }

    if (representation.status?.state === "none" && representation.info?.url) {
      await client.makeRequest({
        method: "GET",
        url: representation.info.url,
        responseFormat: "json",
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(`extracted_text representation is still pending for file ${fileId}.`);
}

function buildContractSearchTerms(query: string): string[] {
  const normalized = query
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[、。,.!?！？「」『』（）()]/g, " ")
    .replace(/\b(review|contract|box)\b/gi, " ")
    .replace(/について|に関して|に関する|との|という|の|と/g, " ")
    .replace(/契約書|契約|危ない|条項|記載|レビュー|見て|確認|リスク|側|立場|この|その|あの|ある|ない|です|ます/g, " ")
    .replace(/受託者|委託者|甲|乙|発注者|依頼者|ベンダー|委託先/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalized
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .slice(0, 4);
}

function normalizeSearchText(text: string) {
  return text
    .toLowerCase()
    .replace(/[・\s　、。,.!?！？「」『』（）()\-_]/g, "");
}

function getBoxStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const maybeError = error as { responseInfo?: { statusCode?: number } };
  return maybeError.responseInfo?.statusCode;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function escapeMetadataPath(key: string): string {
  return `/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`;
}

function extractReviewSummary(answer: string): string {
  const trimmed = answer.trim();
  const summaryMatch = trimmed.match(/総評[：:\s]*(.+?)(?:\n{2,}|\n[-【]|$)/s);
  const summary = summaryMatch?.[1]?.trim() || trimmed.split("\n").find((line) => line.trim())?.trim() || "";
  return summary.length > 500 ? `${summary.slice(0, 497)}...` : summary;
}

function detectHighestSeverity(answer: string): "高" | "中" | "低" | "不明" {
  if (/重大度[：:\s]*高|重大度[（(]\s*高\s*[）)]|【重大度[：:\s]*高/.test(answer)) return "高";
  if (/重大度[：:\s]*中|重大度[（(]\s*中\s*[）)]|【重大度[：:\s]*中/.test(answer)) return "中";
  if (/重大度[：:\s]*低|重大度[（(]\s*低\s*[）)]|【重大度[：:\s]*低/.test(answer)) return "低";
  return "不明";
}

function buildReviewMetadata(args: {
  answer: string;
  standpoint: ContractReviewStandpoint;
  citationsCount: number;
  fieldMapping?: ReviewMetadataFieldMapping;
  metadata?: Record<string, unknown>;
}) {
  const values = {
    reviewStatus: "完了",
    reviewedAt: new Date().toISOString(),
    reviewStandpoint: args.standpoint,
    reviewSummary: extractReviewSummary(args.answer),
    highestSeverity: detectHighestSeverity(args.answer),
    citationsCount: args.citationsCount,
  };
  const defaultMapping: Required<ReviewMetadataFieldMapping> = {
    reviewStatus: "reviewStatus",
    reviewedAt: "reviewedAt",
    reviewStandpoint: "reviewStandpoint",
    reviewSummary: "reviewSummary",
    highestSeverity: "highestSeverity",
    citationsCount: "citationsCount",
  };
  const data: Record<string, unknown> = {};
  for (const [logicalKey, value] of Object.entries(values)) {
    const templateKey =
      args.fieldMapping?.[logicalKey as keyof ReviewMetadataFieldMapping] ??
      defaultMapping[logicalKey as keyof ReviewMetadataFieldMapping];
    if (templateKey) data[templateKey] = value;
  }
  return { ...data, ...(args.metadata ?? {}) };
}

export async function findContractCandidates(
  client: BoxClient,
  args: { query: string; limit?: number }
): Promise<ContractSearchCandidate[]> {
  const terms = buildContractSearchTerms(args.query);
  if (terms.length === 0) return [];

  const results = await client.search.searchForContent({
    query: terms.join(" "),
    type: "file",
    contentTypes: ["name", "file_content"],
    fileExtensions: ["pdf"],
    ancestorFolderIds: process.env.BOX_SEARCH_FOLDER_ID ? [process.env.BOX_SEARCH_FOLDER_ID] : undefined,
    limit: args.limit ?? 5,
    fields: ["id", "name", "type"],
  });
  const candidates =
    results.entries?.flatMap((entry) => {
      const item = entry as { id?: string; name?: string; type?: string };
      return item.type === "file" && item.id ? [{ id: item.id, name: item.name }] : [];
    }) ?? [];

  const normalizedTerms = terms.map(normalizeSearchText).filter(Boolean);
  const matched: ContractSearchCandidate[] = [];
  for (const candidate of candidates) {
    const text = await getFileText(client, candidate.id);
    const haystack = normalizeSearchText(`${candidate.name ?? ""}\n${text}`);
    if (normalizedTerms.every((term) => haystack.includes(term))) {
      matched.push(candidate);
    }
  }
  return matched;
}

/** 1) Ask a question across one or more Box files and return an answer WITH citations. */
export async function aiAskWithCitations(
  client: BoxClient,
  args: { fileIds: string[]; question: string }
) {
  const res = await client.ai.createAiAsk({
    mode: args.fileIds.length > 1 ? "multiple_item_qa" : "single_item_qa",
    prompt: args.question,
    items: args.fileIds.map((id) => ({ id, type: "file" as const })),
    includeCitations: true,
  });
  const citations =
    res?.citations?.map((c) => ({
      file: c.name ?? c.id,
      snippet: c.content,
    })) ?? [];
  return { answer: res?.answer ?? "", citations };
}

/** 2) Extract structured contract fields (JP-aware) using Box AI extract_structured. */
export async function extractContractFields(
  client: BoxClient,
  args: { fileId: string }
) {
  const fields = [
    { key: "counterparty", displayName: "契約相手方", type: "string", prompt: "契約の相手方となる当事者の正式名称" },
    { key: "effective_date", displayName: "契約開始日", type: "date" },
    { key: "term", displayName: "契約期間", type: "string" },
    { key: "auto_renewal", displayName: "自動更新の有無", type: "enum", options: [{ key: "あり" }, { key: "なし" }, { key: "不明" }] },
    { key: "termination_notice", displayName: "解約予告期間", type: "string", prompt: "解約に必要な事前通知期間" },
    { key: "amount", displayName: "契約金額", type: "string" },
    { key: "governing_law", displayName: "準拠法", type: "string" },
  ];
  const res = await client.ai.createAiExtractStructured({
    items: [{ id: args.fileId, type: "file" }],
    fields,
  });
  // Structured values surface in the response's rawData (typed loosely by the SDK).
  return (res?.answer?.rawData ?? res?.rawData ?? {}) as Record<string, unknown>;
}

/** 3) Review a Japanese contract from a specific legal standpoint. */
export async function reviewContract(
  client: BoxClient,
  args: ContractFileReference & { standpoint?: ContractReviewStandpoint } & ReviewMetadataOptions
) {
  const standpoint = args.standpoint ?? "受託者";
  const file = await resolveContractFile(client, args);
  const prompt = `あなたは企業法務の専門家です。添付の契約書を「${standpoint}」の立場でレビューし、懸念点を洗い出してください。

以下の8つの観点で精査すること：
1. 一方的に不利な条項（責任・賠償の偏り）
2. 解約・中途解約の条件（予告期間、違約金）
3. 自動更新の妥当性
4. 損害賠償の上限・範囲
5. 秘密保持の範囲と期間
6. 知的財産権の帰属
7. 準拠法・管轄
8. 曖昧・多義的で解釈が割れる表現

出力形式：
- 冒頭に「総評」を1〜2文（このまま締結してよいか、${standpoint}が最も注意すべき点は何か）
- その後、懸念点を【重大度: 高 → 中 → 低】の順に列挙
- 各懸念点は以下を必ず含める：
  - 該当条項（第◯条など。特定できない場合は「全体」）
  - リスク内容（${standpoint}にとって何が問題か）
  - 重大度（高/中/低）
  - 推奨アクション（どう修正・交渉すべきか具体的に）
- 該当する懸念がない観点は触れなくてよい。憶測で条項を捏造しないこと。原文にない内容は書かない。
- 回答は自然な日本語で書くこと。"Based on general knowledge" などの英語注記は不要。`;

  const res = await client.ai.createAiAsk({
    mode: "single_item_qa",
    prompt,
    items: [{ id: file.id, type: "file" }],
    includeCitations: true,
  });
  const citations =
    res?.citations?.map((c) => ({
      file: c.name ?? c.id,
      snippet: c.content,
    })) ?? [];
  const answer = res?.answer ?? "";
  const shouldWriteMetadata =
    args.writeMetadata === true ||
    Boolean(args.metadataTemplateKey) ||
    Boolean(process.env.BOX_REVIEW_METADATA_TEMPLATE_KEY);
  const metadataTemplateKey = args.metadataTemplateKey ?? process.env.BOX_REVIEW_METADATA_TEMPLATE_KEY;

  if (!shouldWriteMetadata) {
    return { file, standpoint, answer, citations };
  }

  if (!metadataTemplateKey) {
    throw new Error(
      "レビュー結果をメタデータへ書き込むには metadataTemplateKey または BOX_REVIEW_METADATA_TEMPLATE_KEY が必要です。"
    );
  }

  let metadataWriteback;
  try {
    metadataWriteback = await writebackMetadata(client, {
      fileId: file.id,
      templateKey: metadataTemplateKey,
      scope: args.metadataScope,
      data: buildReviewMetadata({
        answer,
        standpoint,
        citationsCount: citations.length,
        fieldMapping: args.metadataFieldMapping,
        metadata: args.metadata,
      }),
    });
  } catch (error) {
    metadataWriteback = {
      applied: false,
      operation: "failed",
      error: getErrorMessage(error),
    };
  }
  return { file, standpoint, answer, citations, metadataWriteback };
}

/** 4) Governance scan: detect PII / sensitive content, roll up to a risk band. */
export async function governanceScan(
  client: BoxClient,
  args: { fileId: string }
) {
  const text = await getFileText(client, args.fileId);
  const hits: { rule: string; label: string; severity: "low" | "medium" | "high"; count: number }[] = [];
  for (const rule of GOVERNANCE_RULES) {
    const matches = text.match(rule.pattern);
    if (matches && matches.length > 0) {
      hits.push({ rule: rule.id, label: rule.label, severity: rule.severity, count: matches.length });
    }
  }
  const risk: RiskBand = rollupRisk(hits);
  return { fileId: args.fileId, risk, findings: hits };
}

/** 5) Write a key/value back to the file as Box metadata (auditable record). */
export async function writebackMetadata(
  client: BoxClient,
  args: { fileId: string; templateKey: string; data: Record<string, unknown>; scope?: MetadataScope }
) {
  const scope = args.scope ?? "enterprise";
  const entries = Object.entries(args.data).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return { applied: false, operation: "skipped", reason: "No metadata fields supplied" };

  try {
    const res = await client.fileMetadata.createFileMetadataById(
      args.fileId,
      scope,
      args.templateKey,
      Object.fromEntries(entries) as never
    );
    return { applied: true, operation: "created", instanceId: (res as { id?: string })?.id };
  } catch (error) {
    if (getBoxStatusCode(error) !== 409) throw error;
  }

  const existing = (await client.fileMetadata.getFileMetadataById(
    args.fileId,
    scope,
    args.templateKey
  )) as Record<string, unknown>;
  const operations = entries.map(([key, value]) => ({
    op: Object.prototype.hasOwnProperty.call(existing, key) ? "replace" : "add",
    path: escapeMetadataPath(key),
    value,
  }));
  const res = await client.fileMetadata.updateFileMetadataById(
    args.fileId,
    scope,
    args.templateKey,
    operations as never
  );
  return { applied: true, operation: "updated", instanceId: (res as { id?: string })?.id };
}

/** 6) Post a human-readable summary as a Box comment (review trail in-context). */
export async function postSummaryComment(
  client: BoxClient,
  args: { fileId: string; message: string }
) {
  const res = await client.comments.createComment({
    message: args.message,
    item: { id: args.fileId, type: "file" },
  });
  return { posted: true, commentId: (res as { id?: string })?.id };
}
