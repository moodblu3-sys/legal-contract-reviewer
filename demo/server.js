import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const app = express();
const PORT = 3000;

app.use(express.json());
const projectRoot = join(__dirname, '..');
app.use('/presentation', express.static(join(projectRoot, 'presentation')));
app.use(express.static(join(__dirname, 'public')));

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

app.post('/api/contracts/:id/governance', (req, res) => {
  const { id } = req.params;
  const result = REVIEW_RESULTS[id];
  if (!result) {
    return res.status(404).json({ error: 'Not available' });
  }
  res.json(result.governanceScan);
});

app.post('/api/contracts/:id/extract', (req, res) => {
  const { id } = req.params;
  const result = REVIEW_RESULTS[id];
  if (!result) {
    return res.status(404).json({ error: 'Not available' });
  }
  res.json(result.extractedFields);
});

app.post('/api/ai-ask', (req, res) => {
  const { question } = req.body;
  const answers = {
    default: {
      answer: 'Box AI が社内ドキュメントを分析した結果をお伝えします。ご質問の内容に関連する契約書・社内規程を参照し、以下の回答を生成しました。',
      citations: ['業務委託基本契約書 第15条', '社内規程集 第3章']
    }
  };

  const knowledgeBase = [
    {
      keywords: ['損害賠償', '賠償', '責任'],
      answer: '当社の契約書における損害賠償条項を確認しました。\n\n■ ABC損害保険との業務委託契約（CTR-2024-001）\n・第15条にて、受託者は「一切の損害を賠償する」と規定されています\n・上限額の定めがないため、リスクが高い状況です\n・業界標準では委託料の12ヶ月分を上限とするのが一般的です\n\n■ 推奨アクション\n損害賠償上限の設定と、間接損害の免責条項の追加を推奨します。',
      citations: ['業務委託基本契約書 第15条（損害賠償）', '契約管理ガイドライン 第4章']
    },
    {
      keywords: ['解約', '解除', '終了'],
      answer: '契約の解約・解除条件についてお調べしました。\n\n■ ABC損害保険との業務委託契約\n・委託者は30日前通知で無条件解除可能（第20条）\n・受託者側には同等の解除権なし\n\n■ XYZテクノロジーとの保守契約\n・中途解約時は残期間分の50%が違約金（第10条）\n・解約通知期間は90日前\n\nいずれの契約も、受託者側の解除権強化を推奨します。',
      citations: ['業務委託基本契約書 第20条（契約解除）', 'システム保守契約書 第10条（中途解約）']
    },
    {
      keywords: ['秘密保持', 'NDA', '機密'],
      answer: '秘密保持に関する条項を確認しました。\n\nABC損害保険との契約では、秘密保持義務の存続期間が契約終了後10年間と設定されています。これは業界標準（3〜5年）と比較して過度に長期であり、交渉による短縮を推奨します。',
      citations: ['業務委託基本契約書 第8条（秘密保持）']
    }
  ];

  if (question) {
    const matched = knowledgeBase.find(kb =>
      kb.keywords.some(kw => question.includes(kw))
    );
    if (matched) {
      return res.json({ answer: matched.answer, citations: matched.citations });
    }
  }

  res.json(answers.default);
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

import { createServer } from 'http';

const server = createServer(app);
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Demo server running at http://localhost:${PORT}`);
  console.log(`Presentation at http://localhost:${PORT}/presentation.html`);
});
