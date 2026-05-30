/**
 * Solution-grade tools. Each one composes the Box platform (content + Box AI API)
 * into something an enterprise customer would actually buy — not a thin wrapper over one endpoint.
 */
import type { BoxClient } from "box-typescript-sdk-gen";
import { readByteStream } from "box-typescript-sdk-gen/internal";
import { GOVERNANCE_RULES, rollupRisk, type RiskBand } from "./governance.js";

export type ContractReviewStandpoint = "委託者" | "受託者";

/** Fetch the plain-text representation of a Box file so we can scan / cite it locally. */
async function getFileText(client: BoxClient, fileId: string): Promise<string> {
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
  args: { fileId: string; standpoint?: ContractReviewStandpoint }
) {
  const standpoint = args.standpoint ?? "受託者";
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
- 該当する懸念がない観点は触れなくてよい。憶測で条項を捏造しないこと。原文にない内容は書かない。`;

  const res = await client.ai.createAiAsk({
    mode: "single_item_qa",
    prompt,
    items: [{ id: args.fileId, type: "file" }],
    includeCitations: true,
  });
  const citations =
    res?.citations?.map((c) => ({
      file: c.name ?? c.id,
      snippet: c.content,
    })) ?? [];
  return { standpoint, answer: res?.answer ?? "", citations };
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
  args: { fileId: string; templateKey: string; data: Record<string, unknown> }
) {
  const res = await client.fileMetadata.createFileMetadataById(
    args.fileId,
    "enterprise" as never,
    args.templateKey,
    args.data as never
  );
  return { applied: true, instanceId: (res as { id?: string })?.id };
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
