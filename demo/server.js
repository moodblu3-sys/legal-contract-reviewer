import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createServer } from 'http';
import Anthropic from '@anthropic-ai/sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const app = express();
const PORT = 3000;

app.use(express.json());
const projectRoot = join(__dirname, '..');
app.use('/presentation', express.static(join(projectRoot, 'presentation')));
app.use(express.static(join(__dirname, 'public')));

// ── 契約書データ ──

const SAMPLE_CONTRACTS = [
  {
    id: 'CTR-2024-001',
    name: '業務委託基本契約書_ABC損害保険.pdf',
    counterparty: 'ABC損害保険株式会社',
    type: '業務委託契約',
    uploadDate: '2024-11-15',
    status: 'pending',
    boxFileId: '1234567890',
    size: '2.4MB'
  },
  {
    id: 'CTR-2024-002',
    name: 'システム保守契約書_XYZテクノロジー.pdf',
    counterparty: 'XYZテクノロジー株式会社',
    type: 'システム保守契約',
    uploadDate: '2024-12-01',
    status: 'pending',
    boxFileId: '1234567891',
    size: '1.8MB'
  },
  {
    id: 'CTR-2024-003',
    name: '秘密保持契約書_DEFコンサルティング.pdf',
    counterparty: 'DEFコンサルティング株式会社',
    type: '秘密保持契約（NDA）',
    uploadDate: '2024-12-10',
    status: 'reviewed',
    boxFileId: '1234567892',
    size: '0.9MB'
  }
];

const REVIEW_RESULTS = {
  'CTR-2024-001': {
    summary: 'ABC損害保険との業務委託基本契約書です。受託者側の立場からレビューを実施しました。全体として委託者に有利な条項が複数確認されており、交渉による修正を推奨します。',
    overallRisk: 'high',
    riskScore: 78,
    concerns: [
      {
        severity: '高',
        category: '損害賠償・責任制限',
        title: '損害賠償の上限条項なし',
        detail: '第15条：受託者の損害賠償責任について上限額の定めがなく、「一切の損害を賠償する」との文言があります。実損害に加え、逸失利益・間接損害も含む可能性があり、リスクが極めて高い条項です。',
        recommendation: '損害賠償の上限を委託料の12ヶ月分に制限し、間接損害・逸失利益を免責とする修正を提案してください。',
        clause: '第15条（損害賠償）'
      },
      {
        severity: '高',
        category: '解約条件',
        title: '一方的な即時解除条項',
        detail: '第20条：委託者は30日前の書面通知で理由なく契約を解除できますが、受託者側には同等の権利がありません。また、解除時の精算条項が不明確です。',
        recommendation: '双方に同等の解除権を付与し、解除時の既履行部分の対価支払いを明記する条項を追加してください。',
        clause: '第20条（契約解除）'
      },
      {
        severity: '中',
        category: '知的財産権',
        title: '成果物の権利帰属が広範',
        detail: '第12条：業務過程で生じた一切の知的財産権が委託者に帰属するとの定めです。受託者が従前から保有する汎用ツール・ライブラリまで譲渡対象に含まれる可能性があります。',
        recommendation: '受託者の既存知的財産権を除外する条項を追加し、成果物の範囲を明確に定義してください。',
        clause: '第12条（知的財産権）'
      },
      {
        severity: '中',
        category: '秘密保持',
        title: '秘密保持義務の期間が長い',
        detail: '第8条：秘密保持義務の存続期間が「契約終了後10年間」と設定されています。業界標準（3〜5年）と比較して過度に長期です。',
        recommendation: '秘密保持期間を契約終了後3年間に短縮する交渉を推奨します。',
        clause: '第8条（秘密保持）'
      },
      {
        severity: '低',
        category: '自動更新',
        title: '自動更新条項の通知期間',
        detail: '第3条：1年間の自動更新で、更新拒否には60日前の通知が必要です。通知期間がやや長めですが、一般的な範囲内です。',
        recommendation: '通知期間を30日に短縮する交渉を検討してください。',
        clause: '第3条（契約期間）'
      }
    ],
    extractedFields: {
      counterparty: 'ABC損害保険株式会社',
      contractTerm: '2025年1月1日〜2025年12月31日（1年間）',
      autoRenewal: 'あり（1年ごと自動更新）',
      terminationNotice: '60日前（委託者側のみ30日前で可）',
      amount: '月額 3,500,000円（税別）',
      governingLaw: '日本法',
      jurisdiction: '東京地方裁判所',
      effectiveDate: '2025年1月1日'
    },
    governanceScan: {
      riskLevel: 'medium',
      findings: [
        { rule: '個人情報', count: 3, detail: '担当者名・連絡先が本文中に記載' },
        { rule: 'メールアドレス', count: 2, detail: '担当者メールアドレスが記載' }
      ]
    }
  },
  'CTR-2024-002': {
    summary: 'XYZテクノロジーとのシステム保守契約書です。委託者（発注者）の立場からレビューを実施しました。SLA定義が不十分であり、保守対応範囲の明確化が必要です。',
    overallRisk: 'medium',
    riskScore: 52,
    concerns: [
      {
        severity: '高',
        category: 'SLA・サービスレベル',
        title: 'SLA定義の欠如',
        detail: '保守契約にもかかわらず、障害対応時間・復旧目標時間（RTO）・稼働率保証などのSLA定義がありません。',
        recommendation: '障害レベル別の対応時間（緊急：2時間以内、重大：4時間以内等）とペナルティ条項を追加してください。',
        clause: '第5条（保守業務の内容）'
      },
      {
        severity: '中',
        category: '責任範囲',
        title: '保守対象範囲が曖昧',
        detail: '第4条：「本システムの正常な運用に必要な保守業務」との表現が抽象的で、具体的な作業内容が不明確です。',
        recommendation: '保守対象のシステム・コンポーネントを別紙で明示し、対象外作業も定義してください。',
        clause: '第4条（保守対象）'
      },
      {
        severity: '低',
        category: '契約期間',
        title: '中途解約時の精算が明確',
        detail: '第10条：中途解約時は残期間分の保守料の50%を違約金として支払う旨が明記されており、リスクは限定的です。',
        recommendation: '現行条項で問題ありません。',
        clause: '第10条（中途解約）'
      }
    ],
    extractedFields: {
      counterparty: 'XYZテクノロジー株式会社',
      contractTerm: '2025年4月1日〜2026年3月31日（1年間）',
      autoRenewal: 'あり（1年ごと自動更新）',
      terminationNotice: '90日前',
      amount: '月額 800,000円（税別）',
      governingLaw: '日本法',
      jurisdiction: '東京地方裁判所',
      effectiveDate: '2025年4月1日'
    },
    governanceScan: {
      riskLevel: 'low',
      findings: [
        { rule: 'メールアドレス', count: 1, detail: '連絡窓口のメールアドレス記載' }
      ]
    }
  }
};

// ── 稟議書データ ──

const SAMPLE_RINGI = [
  {
    id: 'RNG-2025-042',
    title: 'クラウドセキュリティ監視ツール導入',
    applicant: '山田 太郎',
    department: 'IT推進部',
    amount: 4800000,
    category: 'IT投資',
    priority: '通常',
    submittedAt: '2025-06-02T09:30:00',
    status: 'pending_classification',
    attachments: ['見積書_CloudMonitor.pdf', '製品比較表.xlsx'],
    boxFileId: '2000000001'
  },
  {
    id: 'RNG-2025-043',
    title: '代理店向け研修プログラム外部委託',
    applicant: '佐藤 花子',
    department: '営業企画部',
    amount: 12500000,
    category: '外部委託',
    priority: '通常',
    submittedAt: '2025-06-03T14:15:00',
    status: 'pending_classification',
    attachments: ['研修企画書.pdf', '委託先選定理由書.pdf', '見積書3社.pdf'],
    boxFileId: '2000000002'
  },
  {
    id: 'RNG-2025-041',
    title: 'オフィス複合機リース契約更新',
    applicant: '鈴木 一郎',
    department: '総務部',
    amount: 960000,
    category: '経費',
    priority: '低',
    submittedAt: '2025-06-01T11:00:00',
    status: 'approved',
    attachments: ['リース契約書.pdf'],
    boxFileId: '2000000003'
  },
  {
    id: 'RNG-2025-040',
    title: '海外再保険ブローカー契約締結',
    applicant: '田中 洋平',
    department: '再保険部',
    amount: 85000000,
    category: '契約締結',
    priority: '高',
    submittedAt: '2025-05-30T16:45:00',
    status: 'in_review',
    attachments: ['ブローカー契約書.pdf', 'デューデリジェンス報告書.pdf', '取締役会付議資料.pdf'],
    boxFileId: '2000000004'
  }
];

const CLASSIFICATION_RESULTS = {
  'RNG-2025-042': {
    aiCategory: 'IT投資（ソフトウェア）',
    aiPriority: '通常',
    estimatedApprovalRoute: '部長 → IT統括部長 → 管理本部長',
    reason: '金額480万円はIT投資の部長決裁上限（500万円）以内ですが、全社セキュリティに関わるため IT統括部長の承認を推奨します。',
    riskFlags: [],
    requiredAttachments: ['見積書', '製品比較表', 'セキュリティ要件チェックシート'],
    missingAttachments: ['セキュリティ要件チェックシート'],
    relatedPolicies: ['IT投資管理規程 第5条', '情報セキュリティポリシー 第12条'],
    extractedFields: {
      vendor: 'CloudMonitor株式会社',
      contractPeriod: '2025年7月〜2026年6月（1年間）',
      paymentTerms: '年額一括払い',
      budgetCode: 'IT-2025-SEC-003'
    }
  },
  'RNG-2025-043': {
    aiCategory: '外部委託（教育研修）',
    aiPriority: '高',
    estimatedApprovalRoute: '部長 → 営業統括本部長 → 管理本部長 → 経営会議',
    reason: '金額1,250万円は部長決裁上限（1,000万円）を超過。経営会議付議が必要です。また、外部委託先の選定理由について、3社比較の妥当性確認を推奨します。',
    riskFlags: [
      { level: '注意', message: '金額が部長決裁上限を超過 → 経営会議付議が必要' },
      { level: '確認', message: '委託先との既存取引実績なし → 与信審査を推奨' }
    ],
    requiredAttachments: ['研修企画書', '委託先選定理由書', '見積書（3社以上）', '与信調査結果'],
    missingAttachments: ['与信調査結果'],
    relatedPolicies: ['外部委託管理規程 第8条', '購買管理規程 第3条（競争見積）'],
    extractedFields: {
      vendor: 'グローバルHRソリューションズ株式会社',
      contractPeriod: '2025年8月〜2026年3月（8ヶ月間）',
      paymentTerms: '月額払い（初回のみ着手金20%）',
      budgetCode: 'SALES-2025-EDU-001'
    }
  }
};

// ── 契約書 API ──

app.get('/api/contracts', (req, res) => {
  res.json(SAMPLE_CONTRACTS);
});

app.get('/api/contracts/:id', (req, res) => {
  const contract = SAMPLE_CONTRACTS.find(c => c.id === req.params.id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  res.json(contract);
});

app.post('/api/contracts/:id/review', (req, res) => {
  const { id } = req.params;
  const { standpoint } = req.body;
  const result = REVIEW_RESULTS[id];
  if (!result) {
    return res.status(404).json({ error: 'Review not available for this contract' });
  }
  const contract = SAMPLE_CONTRACTS.find(c => c.id === id);
  if (contract) contract.status = 'reviewed';
  res.json({
    contractId: id,
    standpoint: standpoint || '受託者',
    reviewedAt: new Date().toISOString(),
    ...result
  });
});

app.post('/api/contracts/:id/writeback', (req, res) => {
  res.json({
    success: true,
    message: 'メタデータをBoxに書き戻しました',
    metadata: {
      reviewStatus: 'reviewed',
      riskLevel: 'high',
      reviewDate: new Date().toISOString(),
      reviewer: 'AI Contract Reviewer'
    }
  });
});

// ── 稟議書 API ──

app.get('/api/ringi', (req, res) => {
  res.json(SAMPLE_RINGI);
});

app.post('/api/ringi/:id/classify', (req, res) => {
  const { id } = req.params;
  const result = CLASSIFICATION_RESULTS[id];
  if (!result) {
    return res.status(404).json({ error: 'Classification not available' });
  }
  const ringi = SAMPLE_RINGI.find(r => r.id === id);
  if (ringi) ringi.status = 'classified';
  res.json({
    ringiId: id,
    classifiedAt: new Date().toISOString(),
    ...result
  });
});

app.post('/api/ringi/:id/submit', (req, res) => {
  res.json({
    success: true,
    message: 'Box Relay による承認ワークフローを開始しました',
    workflowId: 'WF-' + Date.now(),
    nextApprover: '部長',
    estimatedCompletion: '2〜3営業日'
  });
});

// ── AI Ask API ──

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const CONTRACT_CONTEXT = `
あなたは企業の法務・契約管理AIアシスタントです。以下の契約書データベースを参照して、ユーザーの質問に日本語で回答してください。
回答はBox AIが社内ドキュメントを横断検索して生成した形式で、具体的な条項番号・契約書名を引用してください。

## 管理中の契約書一覧

### CTR-2024-001: 業務委託基本契約書_ABC損害保険
- 相手方: ABC損害保険株式会社
- 種別: 業務委託契約
- 金額: 月額3,500,000円（税別）
- 契約期間: 2025年1月1日〜2025年12月31日（自動更新あり）
- リスク評価: 高（スコア78/100）
- 主要リスク条項:
  - 第15条（損害賠償）: 上限額の定めなし、「一切の損害を賠償する」—受託者に極めて不利
  - 第20条（契約解除）: 委託者は30日前通知で理由なく解除可能、受託者には同等権利なし
  - 第12条（知的財産権）: 業務過程の一切の知財が委託者に帰属、既存ツールも対象の可能性
  - 第8条（秘密保持）: 秘密保持期間が契約終了後10年（業界標準は3〜5年）
  - 第3条（契約期間）: 更新拒否に60日前通知が必要

### CTR-2024-002: システム保守契約書_XYZテクノロジー
- 相手方: XYZテクノロジー株式会社
- 種別: システム保守契約
- 金額: 月額800,000円（税別）
- 契約期間: 2025年4月1日〜2026年3月31日（自動更新あり）
- リスク評価: 中（スコア52/100）
- 主要リスク条項:
  - 第5条（保守業務の内容）: SLA定義なし、障害対応時間・RTO・稼働率保証の記載なし
  - 第4条（保守対象）: 保守範囲の記述が抽象的
  - 第10条（中途解約）: 残期間分の50%が違約金、解約通知90日前

### CTR-2024-003: 秘密保持契約書_DEFコンサルティング
- 相手方: DEFコンサルティング株式会社
- 種別: 秘密保持契約（NDA）
- ステータス: レビュー済み

## 社内規程（参照用）
- 契約管理ガイドライン: 損害賠償上限は委託料12ヶ月分が標準
- 情報セキュリティポリシー: 個人情報・機密情報の取扱い規定
- IT投資管理規程: IT投資の承認フロー（500万円超は統括部長承認）
`;

app.post('/api/ai-ask', async (req, res) => {
  const { question } = req.body;
  if (!question) {
    return res.status(400).json({ error: 'question is required' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.json({
      answer: 'Box AI が社内ドキュメントを分析した結果をお伝えします。（デモモード: ANTHROPIC_API_KEY 未設定のため固定応答）\n\nご質問の内容に関連する契約書・社内規程を参照し、以下の回答を生成しました。\n\n損害賠償条項に関しては、CTR-2024-001の第15条で上限額の定めがなく、リスクが高い状態です。交渉による修正を推奨します。',
      citations: ['業務委託基本契約書 第15条（損害賠償）', '社内規程集 第3章']
    });
  }

  try {
    const stream = anthropic.messages.stream({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
      thinking: { type: 'adaptive' },
      system: CONTRACT_CONTEXT,
      messages: [
        {
          role: 'user',
          content: `${question}\n\n回答形式:\n- 簡潔で実務的な回答\n- 具体的な条項番号を引用\n- 推奨アクションがあれば末尾に記載\n- citationsフィールド用の引用リストも最後にJSON形式で出力: {"citations": ["...", "..."]}`
        }
      ]
    });

    const message = await stream.finalMessage();
    const rawText = message.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    // extract optional citations JSON from the end of the response
    const citationsMatch = rawText.match(/\{"citations":\s*\[([^\]]*)\]\}/);
    let citations = [];
    let answer = rawText;
    if (citationsMatch) {
      try {
        citations = JSON.parse(citationsMatch[0]).citations;
        answer = rawText.slice(0, citationsMatch.index).trim();
      } catch {
        // leave answer intact if JSON parse fails
      }
    }

    res.json({ answer, citations });
  } catch (err) {
    console.error('Claude API error:', err.message);
    res.status(500).json({ error: 'AI応答の生成に失敗しました', detail: err.message });
  }
});

const server = createServer(app);
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Demo server running at http://localhost:${PORT}`);
  console.log(`Presentation at http://localhost:${PORT}/presentation.html`);
});
