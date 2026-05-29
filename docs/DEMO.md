# Demo script (for the 2nd interview)

Keep it under ~5 minutes. The point is not "I can call an API" — it's "I think like a solution
architect and I move fast." Aim for: **problem → solution layer → live workflow → how I'd productionize.**

## 0. One-sentence frame (say this first)
> "Box ships a generic MCP server and the Box AI API. I built the *solution layer* on top — a governed
> contract-intake workflow — because that's where enterprise customers outgrow the native features. Let
> me show it running inside Claude."

This signals up front that you **know Box's own products** (credibility) and that you understand the
SA role (solutions, not plumbing).

## 1. Setup shown on screen (10s)
- `claude_desktop_config.json` with the server wired in.
- A Box folder with one sample Japanese contract PDF.

## 2. Live workflow (the core, ~2 min)
Ask Claude one natural-language instruction and let the tools chain:
> 「このBoxフォルダの契約書から主要項目を抽出して、PII/機密をスキャンして、リスクが中以上なら
> レビュー依頼のコメントを残し、結果をメタデータに書き戻して。」

Narrate what each tool does as it fires: extract → scan → (conditional) comment → metadata write-back.
End by showing the **metadata and the comment now living on the file in the Box UI** — "auditable,
in-context, queryable."

## 3. The architecture slide (1 min)
Show the mermaid flow from `docs/ARCHITECTURE.md`. Emphasize: grounding+citations, structured output,
write-back as the governed record.

## 4. "How I'd take this to a customer" (1 min) — this is the SA money shot
Walk the 5 extension points from ARCHITECTURE.md: metadata templates, webhook triggers, human-in-the-loop
for high risk, Box Shield as a second signal, model pinning. This shows you think past the demo.

## Talking points to land
- **AI depth:** built as an MCP server (the thing Box's own tooling — Cursor/Claude Code — assumes),
  used Box AI ask *and* extract_structured, handled citations and JP fields.
- **Security/governance edge (your differentiator):** the governance scan + risk band + auditable
  write-back is the part most app devs skip. Tie it to your AWS Security / CISSP background explicitly.
- **Speed & ownership:** "I heard the role wants AI×Box solutions for customers who outgrow native
  features, so over the weekend I built one." Initiative is itself the signal Box hires for ("GSD").
- **HQ/English:** README is in English; offer to walk a US stakeholder through it.

## If asked about the official Box MCP
Good — answer directly: "Right, Box ships both a remote and a self-hosted MCP. I didn't rebuild that;
generic access is solved. I built the vertical layer that the generic server can't be — policy-driven
governance and structured write-back for a specific regulated workflow." That answer *is* the job.

## Honesty guardrails (don't oversell)
- It's a reference implementation on a dev account, not production-tested at scale.
- Box AI quality varies by tier/model; extract on complex tables needs tuning.
- The regex governance is a starting point; real classification would use Box Shield + policy.
