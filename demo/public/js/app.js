let currentContractId = null;
let currentReviewData = null;
let currentRingiId = null;

document.addEventListener('DOMContentLoaded', () => {
  loadContracts();
  loadRingi();
  const chatInput = document.getElementById('chat-input');
  if (chatInput) chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChat();
  });
});

// ── Navigation ──

function showView(viewId) {
  document.querySelectorAll('.main').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.header-nav button').forEach(el => el.classList.remove('active'));
  const view = document.getElementById(`view-${viewId}`);
  if (view) view.classList.remove('hidden');
  const idx = { contracts: 0, ringi: 1, future: 2, architecture: 3 }[viewId];
  const buttons = document.querySelectorAll('.header-nav button');
  if (buttons[idx]) buttons[idx].classList.add('active');
}

// ═══════════════════════════════════════
// UC1: 契約書レビュー
// ═══════════════════════════════════════

async function loadContracts() {
  const res = await fetch('/api/contracts');
  const contracts = await res.json();
  const tbody = document.getElementById('contract-list');
  tbody.innerHTML = contracts.map(c => `
    <tr onclick="openReview('${c.id}', '${c.name}')">
      <td><strong>${c.id}</strong></td>
      <td>${c.name}</td>
      <td>${c.counterparty}</td>
      <td>${c.type}</td>
      <td>${c.uploadDate}</td>
      <td>
        <span class="status-badge ${c.status}">
          ${c.status === 'pending' ? '● 未レビュー' : '✓ レビュー済'}
        </span>
      </td>
      <td>
        <button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); openReview('${c.id}', '${c.name}')">
          レビュー
        </button>
      </td>
    </tr>
  `).join('');
}

function openReview(contractId, contractName) {
  currentContractId = contractId;
  document.getElementById('review-title').textContent = contractName;
  document.getElementById('review-panel').classList.add('active');
  document.getElementById('review-loading').classList.add('hidden');
  document.getElementById('review-results').style.display = 'none';
  document.getElementById('start-review-btn').classList.remove('hidden');
  document.getElementById('writeback-btn').classList.add('hidden');
  document.getElementById('writeback-success').classList.remove('show');
}

function closeReview() {
  document.getElementById('review-panel').classList.remove('active');
  currentContractId = null;
  currentReviewData = null;
}

async function startReview() {
  const standpoint = document.getElementById('standpoint-select').value;
  document.getElementById('start-review-btn').classList.add('hidden');
  document.getElementById('review-loading').classList.remove('hidden');
  document.getElementById('review-results').style.display = 'none';

  const steps = [
    { text: 'Box AI が契約書を読み取り中...', delay: 800 },
    { text: '条項の法的リスクを分析中...', delay: 1200 },
    { text: 'ガバナンス検査を実行中...', delay: 800 },
    { text: 'メタデータを抽出中...', delay: 600 }
  ];
  const loadingEl = document.getElementById('review-loading');
  const statusEl = loadingEl.querySelector('div:nth-child(2)');
  for (const step of steps) {
    statusEl.textContent = step.text;
    await new Promise(r => setTimeout(r, step.delay));
  }

  try {
    const res = await fetch(`/api/contracts/${currentContractId}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ standpoint })
    });
    currentReviewData = await res.json();
    renderReviewResults(currentReviewData);
    document.getElementById('review-loading').classList.add('hidden');
    document.getElementById('review-results').style.display = 'block';
    document.getElementById('writeback-btn').classList.remove('hidden');
  } catch (err) {
    statusEl.textContent = 'エラーが発生しました: ' + err.message;
  }
}

function renderReviewResults(data) {
  renderOverview(data);
  renderConcerns(data.concerns);
  renderExtracted(data.extractedFields);
  renderGovernance(data.governanceScan);
}

function renderOverview(data) {
  const el = document.getElementById('tab-overview');
  const riskClass = data.overallRisk;
  const riskLabel = { high: '高リスク', medium: '中リスク', low: '低リスク' }[riskClass];
  el.innerHTML = `
    <div class="risk-overview animate-in">
      <div class="risk-gauge">
        <div class="risk-circle ${riskClass}">
          <div class="risk-score">${data.riskScore}</div>
          <div class="risk-label">${riskLabel}</div>
        </div>
        <div style="font-size: 12px; color: var(--gray-500); margin-top: 8px;">
          指摘: ${data.concerns.length}件
          （高: ${data.concerns.filter(c => c.severity === '高').length} /
           中: ${data.concerns.filter(c => c.severity === '中').length} /
           低: ${data.concerns.filter(c => c.severity === '低').length}）
        </div>
      </div>
      <div class="risk-summary-text">
        <strong>AI レビューサマリー</strong><br><br>
        ${data.summary}
        <br><br>
        <strong>立場：</strong>${data.standpoint}<br>
        <strong>レビュー日時：</strong>${new Date(data.reviewedAt).toLocaleString('ja-JP')}
      </div>
    </div>
  `;
}

function renderConcerns(concerns) {
  const el = document.getElementById('tab-concerns');
  el.innerHTML = concerns.map((c, i) => {
    const sevClass = { '高': 'high', '中': 'medium', '低': 'low' }[c.severity];
    return `
      <div class="concern-card animate-in" style="animation-delay: ${i * 0.1}s">
        <div class="concern-header" onclick="toggleConcern(this)">
          <span class="severity-dot ${sevClass}"></span>
          <span class="concern-title">${c.title}</span>
          <span class="concern-category">${c.category}</span>
          <span class="concern-severity-label ${sevClass}">${c.severity}</span>
        </div>
        <div class="concern-body">
          <div class="concern-detail-label">検出内容</div>
          <div class="concern-detail">${c.detail}</div>
          <div class="concern-detail-label">推奨アクション</div>
          <div class="concern-recommendation">${c.recommendation}</div>
          <span class="concern-clause">${c.clause}</span>
        </div>
      </div>
    `;
  }).join('');
}

function renderExtracted(fields) {
  const el = document.getElementById('tab-extracted');
  const labels = {
    counterparty: '相手方', contractTerm: '契約期間', autoRenewal: '自動更新',
    terminationNotice: '解約予告期間', amount: '契約金額', governingLaw: '準拠法',
    jurisdiction: '管轄裁判所', effectiveDate: '契約開始日'
  };
  el.innerHTML = `
    <div class="animate-in">
      <p style="font-size: 13px; color: var(--gray-600); margin-bottom: 16px;">
        Box AI Extract Structured API により契約書から自動抽出された構造化データです。
      </p>
      <div class="extracted-fields">
        ${Object.entries(fields).map(([key, val]) => `
          <div class="field-item">
            <div class="field-label">${labels[key] || key}</div>
            <div class="field-value">${val}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderGovernance(scan) {
  const el = document.getElementById('tab-governance');
  const levelLabel = { low: '低', medium: '中', high: '高' }[scan.riskLevel];
  el.innerHTML = `
    <div class="animate-in">
      <p style="font-size: 13px; color: var(--gray-600); margin-bottom: 16px;">
        契約書内の個人情報（PII）・機密情報をポリシーベースで検出します。
      </p>
      <div class="governance-badge ${scan.riskLevel}">
        情報リスクレベル: ${levelLabel}
      </div>
      ${scan.findings.length > 0 ? `
        <div style="margin-top: 12px;">
          ${scan.findings.map(f => `
            <div class="governance-finding">
              <strong>${f.rule}</strong>（${f.count}件検出）<br>
              <span style="color: var(--gray-600);">${f.detail}</span>
            </div>
          `).join('')}
        </div>
      ` : '<p style="color: var(--success);">機密情報は検出されませんでした。</p>'}
    </div>
  `;
}

function toggleConcern(headerEl) {
  headerEl.nextElementSibling.classList.toggle('open');
}

function switchTab(tabId) {
  document.querySelectorAll('#review-results .tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('#review-results .tab-content').forEach(t => t.classList.remove('active'));
  const tabs = { 'tab-overview': 0, 'tab-concerns': 1, 'tab-extracted': 2, 'tab-governance': 3 };
  document.querySelectorAll('#review-results .tab-btn')[tabs[tabId]].classList.add('active');
  document.getElementById(tabId).classList.add('active');
}

async function writebackMetadata() {
  const btn = document.getElementById('writeback-btn');
  btn.textContent = '書き戻し中...';
  btn.disabled = true;
  await new Promise(r => setTimeout(r, 1000));
  await fetch(`/api/contracts/${currentContractId}/writeback`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }
  });
  document.getElementById('writeback-success').classList.add('show');
  btn.textContent = '✓ 書戻し完了';
}

// ═══════════════════════════════════════
// UC2: 稟議書承認フロー
// ═══════════════════════════════════════

async function loadRingi() {
  const res = await fetch('/api/ringi');
  const list = await res.json();
  const tbody = document.getElementById('ringi-list');
  const statusLabels = {
    pending_classification: ['pending', '● AI分類待ち'],
    classified: ['reviewed', '✓ 分類済'],
    in_review: ['pending', '● 承認中'],
    approved: ['reviewed', '✓ 承認済'],
    rejected: ['high-risk', '× 差戻し']
  };
  tbody.innerHTML = list.map(r => {
    const [cls, label] = statusLabels[r.status] || ['pending', r.status];
    const canClassify = r.status === 'pending_classification';
    return `
      <tr onclick="${canClassify ? `openRingi('${r.id}', '${r.title}')` : ''}">
        <td><strong>${r.id}</strong></td>
        <td>${r.title}</td>
        <td>${r.applicant}</td>
        <td>${r.department}</td>
        <td>${formatYen(r.amount)}</td>
        <td><span class="status-badge ${cls}">${label}</span></td>
        <td>
          ${canClassify
            ? `<button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); openRingi('${r.id}', '${r.title}')">AI分類</button>`
            : `<button class="btn btn-secondary btn-sm" disabled>詳細</button>`
          }
        </td>
      </tr>
    `;
  }).join('');
}

function formatYen(n) {
  if (n >= 100000000) return (n / 100000000).toFixed(1) + '億円';
  if (n >= 10000) return (n / 10000).toLocaleString() + '万円';
  return n.toLocaleString() + '円';
}

function openRingi(ringiId, title) {
  currentRingiId = ringiId;
  document.getElementById('ringi-title').textContent = title;
  document.getElementById('ringi-panel').classList.add('active');
  document.getElementById('ringi-loading').classList.add('hidden');
  document.getElementById('ringi-results').style.display = 'none';
  document.getElementById('start-classify-btn').classList.remove('hidden');
  document.getElementById('start-workflow-btn').classList.add('hidden');
  document.getElementById('workflow-success').classList.remove('show');
}

function closeRingi() {
  document.getElementById('ringi-panel').classList.remove('active');
  currentRingiId = null;
}

async function startClassify() {
  document.getElementById('start-classify-btn').classList.add('hidden');
  document.getElementById('ringi-loading').classList.remove('hidden');
  document.getElementById('ringi-results').style.display = 'none';

  const steps = [
    { text: 'Box AI が稟議書を読み取り中...', delay: 700 },
    { text: 'カテゴリ・金額を自動分類中...', delay: 900 },
    { text: '承認ルートを判定中...', delay: 800 },
    { text: '添付書類の過不足を確認中...', delay: 600 },
    { text: '関連規程を照合中...', delay: 500 }
  ];
  const loadingEl = document.getElementById('ringi-loading');
  const statusEl = loadingEl.querySelector('div:nth-child(2)');
  for (const step of steps) {
    statusEl.textContent = step.text;
    await new Promise(r => setTimeout(r, step.delay));
  }

  try {
    const res = await fetch(`/api/ringi/${currentRingiId}/classify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    renderRingiResults(data);
    document.getElementById('ringi-loading').classList.add('hidden');
    document.getElementById('ringi-results').style.display = 'block';
    document.getElementById('start-workflow-btn').classList.remove('hidden');
  } catch (err) {
    statusEl.textContent = 'エラー: ' + err.message;
  }
}

function renderRingiResults(data) {
  renderRoute(data);
  renderFlags(data);
  renderAttachments(data);
  renderRingiExtracted(data);
}

function renderRoute(data) {
  const el = document.getElementById('rtab-route');
  const steps = data.estimatedApprovalRoute.split(' → ');
  el.innerHTML = `
    <div class="animate-in">
      <div class="risk-overview" style="grid-template-columns: 1fr;">
        <div>
          <div style="margin-bottom: 16px;">
            <span class="concern-detail-label">AI分類カテゴリ</span>
            <div style="font-size: 18px; font-weight: 700; margin-top: 4px;">${data.aiCategory}</div>
          </div>
          <div style="margin-bottom: 16px;">
            <span class="concern-detail-label">優先度</span>
            <span class="status-badge ${data.aiPriority === '高' ? 'high-risk' : 'pending'}" style="margin-left: 8px;">${data.aiPriority}</span>
          </div>
          <div style="margin-bottom: 20px;">
            <span class="concern-detail-label">AI判定理由</span>
            <div style="font-size: 14px; line-height: 1.8; margin-top: 4px; color: var(--gray-700);">${data.reason}</div>
          </div>
          <div>
            <span class="concern-detail-label">承認ルート（自動判定）</span>
            <div class="process-flow" style="padding: 16px 0 0; justify-content: flex-start;">
              ${steps.map((s, i) => `
                ${i > 0 ? '<div class="process-arrow">→</div>' : ''}
                <div class="process-step${i === 0 ? ' active' : ''}" style="min-width:120px;">
                  <div class="step-num">${i + 1}</div>
                  <div class="step-title">${s}</div>
                  <div class="step-desc">${i === 0 ? '次の承認者' : '待機中'}</div>
                </div>
              `).join('')}
            </div>
          </div>
          <div style="margin-top: 16px;">
            <span class="concern-detail-label">関連規程</span>
            <div style="margin-top: 4px;">
              ${data.relatedPolicies.map(p => `<span class="concern-clause" style="margin-right:8px;">${p}</span>`).join('')}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderFlags(data) {
  const el = document.getElementById('rtab-flags');
  if (!data.riskFlags || data.riskFlags.length === 0) {
    el.innerHTML = `
      <div class="animate-in" style="padding: 24px; text-align: center;">
        <div class="governance-badge low">リスクフラグなし</div>
        <p style="color: var(--gray-600); margin-top: 8px;">特記すべきリスク・注意事項は検出されませんでした。</p>
      </div>
    `;
    return;
  }
  el.innerHTML = `
    <div class="animate-in">
      ${data.riskFlags.map(f => {
        const sevClass = f.level === '注意' ? 'high' : 'medium';
        return `
          <div class="concern-card">
            <div class="concern-header">
              <span class="severity-dot ${sevClass}"></span>
              <span class="concern-title">${f.message}</span>
              <span class="concern-severity-label ${sevClass}">${f.level}</span>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderAttachments(data) {
  const el = document.getElementById('rtab-attachments');
  el.innerHTML = `
    <div class="animate-in">
      <p style="font-size: 13px; color: var(--gray-600); margin-bottom: 16px;">
        規程に基づき、この種別の稟議に必要な添付書類を自動チェックしました。
      </p>
      <div style="margin-bottom: 16px;">
        ${data.requiredAttachments.map(a => {
          const isMissing = data.missingAttachments.includes(a);
          return `
            <div style="display: flex; align-items: center; gap: 8px; padding: 8px 12px; margin-bottom: 4px;
                        background: ${isMissing ? 'var(--danger-bg)' : 'var(--success-bg)'}; border-radius: 6px;">
              <span style="font-size: 16px;">${isMissing ? '❌' : '✅'}</span>
              <span style="font-size: 14px; ${isMissing ? 'color: var(--danger); font-weight: 600;' : 'color: var(--success);'}">${a}</span>
              ${isMissing ? '<span style="margin-left: auto; font-size: 12px; color: var(--danger);">未添付 — 申請者に差戻し推奨</span>' : ''}
            </div>
          `;
        }).join('')}
      </div>
      ${data.missingAttachments.length > 0 ? `
        <div class="governance-finding" style="border-left-color: var(--danger);">
          <strong>添付不足が検出されました。</strong> 承認フロー開始前に、申請者へ不足書類の提出を依頼することを推奨します。
          不足書類が揃った状態で承認フローを開始することも可能です。
        </div>
      ` : ''}
    </div>
  `;
}

function renderRingiExtracted(data) {
  const el = document.getElementById('rtab-extracted');
  const labels = {
    vendor: '取引先', contractPeriod: '契約/実施期間',
    paymentTerms: '支払条件', budgetCode: '予算コード'
  };
  el.innerHTML = `
    <div class="animate-in">
      <p style="font-size: 13px; color: var(--gray-600); margin-bottom: 16px;">
        Box AI が稟議書・添付書類から自動抽出した構造化データです。
      </p>
      <div class="extracted-fields">
        ${Object.entries(data.extractedFields).map(([key, val]) => `
          <div class="field-item">
            <div class="field-label">${labels[key] || key}</div>
            <div class="field-value">${val}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function switchRingiTab(tabId) {
  document.querySelectorAll('#ringi-results .tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('#ringi-results .tab-content').forEach(t => t.classList.remove('active'));
  const tabs = { 'rtab-route': 0, 'rtab-flags': 1, 'rtab-attachments': 2, 'rtab-extracted': 3 };
  document.querySelectorAll('#ringi-tab-bar .tab-btn')[tabs[tabId]].classList.add('active');
  document.getElementById(tabId).classList.add('active');
}

async function startWorkflow() {
  const btn = document.getElementById('start-workflow-btn');
  btn.textContent = 'ワークフロー起動中...';
  btn.disabled = true;
  await new Promise(r => setTimeout(r, 1500));
  document.getElementById('workflow-success').classList.add('show');
  btn.textContent = '✓ 承認フロー開始済';
}

// ═══════════════════════════════════════
// UC3: AI問い合わせ（将来構想・軽いデモ）
// ═══════════════════════════════════════

async function sendChat() {
  const input = document.getElementById('chat-input');
  const question = input.value.trim();
  if (!question) return;

  const messages = document.getElementById('chat-messages');
  messages.innerHTML += `
    <div class="chat-message animate-in">
      <div class="chat-avatar user">U</div>
      <div class="chat-bubble">${escapeHtml(question)}</div>
    </div>
  `;
  input.value = '';
  messages.scrollTop = messages.scrollHeight;

  messages.innerHTML += `
    <div class="chat-message animate-in" id="chat-loading">
      <div class="chat-avatar ai">AI</div>
      <div class="chat-bubble ai"><div class="spinner" style="width:20px;height:20px;border-width:2px;margin:0"></div></div>
    </div>
  `;
  messages.scrollTop = messages.scrollHeight;

  try {
    const res = await fetch('/api/ai-ask', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question })
    });
    const data = await res.json();
    document.getElementById('chat-loading').remove();
    const citationsHtml = data.citations ? `
      <div class="chat-citations">
        <strong>出典：</strong>
        ${data.citations.map(c => `<span class="chat-citation-item">${c}</span>`).join('')}
      </div>
    ` : '';
    messages.innerHTML += `
      <div class="chat-message animate-in">
        <div class="chat-avatar ai">AI</div>
        <div class="chat-bubble ai">${escapeHtml(data.answer)}${citationsHtml}</div>
      </div>
    `;
    messages.scrollTop = messages.scrollHeight;
  } catch {
    document.getElementById('chat-loading').remove();
    messages.innerHTML += `
      <div class="chat-message animate-in">
        <div class="chat-avatar ai">AI</div>
        <div class="chat-bubble ai">エラーが発生しました。</div>
      </div>
    `;
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
