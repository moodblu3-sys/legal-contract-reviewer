/**
 * Governance rules used by the `box_governance_scan` tool.
 *
 * This is the piece that differentiates a *solution architect* from an app developer:
 * the value is not "AI can read the file", it is "AI-assisted classification that maps to
 * a control framework, writes an auditable record back to the content, and flags risk".
 *
 * Patterns below are deliberately conservative starting points for a JP enterprise context.
 * In a real engagement these would be driven by the customer's data-classification policy
 * (e.g. ISMS / Pマーク / 個人情報保護法) rather than hard-coded.
 */

export interface GovernanceRule {
  id: string;
  label: string;
  /** Rough severity used to compute an overall risk band. */
  severity: "low" | "medium" | "high";
  /** Regex applied to the document's text representation. */
  pattern: RegExp;
}

export const GOVERNANCE_RULES: GovernanceRule[] = [
  {
    id: "jp_mynumber",
    label: "マイナンバー (個人番号らしき12桁)",
    severity: "high",
    pattern: /(?<!\d)\d{4}[\s-]?\d{4}[\s-]?\d{4}(?!\d)/g,
  },
  {
    id: "credit_card",
    label: "クレジットカード番号らしき16桁",
    severity: "high",
    pattern: /(?<!\d)(?:\d[ -]?){15}\d(?!\d)/g,
  },
  {
    id: "email",
    label: "メールアドレス (個人情報)",
    severity: "low",
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  },
  {
    id: "jp_phone",
    label: "電話番号らしき文字列",
    severity: "low",
    pattern: /(?<!\d)0\d{1,4}-\d{1,4}-\d{3,4}(?!\d)/g,
  },
  {
    id: "secret_label",
    label: "機密ラベル (社外秘 / Confidential など)",
    severity: "medium",
    pattern: /(社外秘|極秘|機密|Confidential|CONFIDENTIAL|Internal Only)/g,
  },
];

export type RiskBand = "none" | "low" | "medium" | "high";

export function rollupRisk(
  hits: { severity: GovernanceRule["severity"] }[]
): RiskBand {
  if (hits.some((h) => h.severity === "high")) return "high";
  if (hits.some((h) => h.severity === "medium")) return "medium";
  if (hits.length > 0) return "low";
  return "none";
}
