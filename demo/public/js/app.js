let currentContractId = null;
let currentReviewData = null;

document.addEventListener('DOMContentLoaded', () => {
  loadContracts();
  document.getElementById('chat-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChat();
  });
});

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

function showView(viewId) {
  document.querySelectorAll('.main, .header-nav button').forEach(el => {
    el.classList.add('hidden');
    el.classList.remove('active');
  });
  const view = document.getElementById(`view-${viewId}`);
  view.classList.remove('hidden');
  const buttons = document.querySelectorAll('.header-nav button');
  const idx = { dashboard: 0, architecture: 1, 'ai-chat': 2 }[viewId];
  if (buttons[idx]) buttons[idx].classList.add('active');
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
    counterparty: '相手方',
    contractTerm: '契約期間',
    autoRenewal: '自動更新',
    terminationNotice: '解約予告期間',
    amount: '契約金額',
    governingLaw: '準拠法',
    jurisdiction: '管轄裁判所',
    effectiveDate: '契約開始日'
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
  const body = headerEl.nextElementSibling;
  body.classList.toggle('open');
}

function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));

  const tabs = { 'tab-overview': 0, 'tab-concerns': 1, 'tab-extracted': 2, 'tab-governance': 3 };
  document.querySelectorAll('.tab-btn')[tabs[tabId]].classList.add('active');
  document.getElementById(tabId).classList.add('active');
}

async function writebackMetadata() {
  const btn = document.getElementById('writeback-btn');
  btn.textContent = '書き戻し中...';
  btn.disabled = true;

  await new Promise(r => setTimeout(r, 1000));

  try {
    await fetch(`/api/contracts/${currentContractId}/writeback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    document.getElementById('writeback-success').classList.add('show');
    btn.textContent = '✓ 書戻し完了';
  } catch (err) {
    btn.textContent = 'エラー';
  }
}

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
      <div class="chat-bubble ai">
        <div class="spinner" style="width:20px;height:20px;border-width:2px;margin:0"></div>
      </div>
    </div>
  `;
  messages.scrollTop = messages.scrollHeight;

  try {
    const res = await fetch('/api/ai-ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
        <div class="chat-bubble ai">
          ${escapeHtml(data.answer)}
          ${citationsHtml}
        </div>
      </div>
    `;
    messages.scrollTop = messages.scrollHeight;
  } catch (err) {
    document.getElementById('chat-loading').remove();
    messages.innerHTML += `
      <div class="chat-message animate-in">
        <div class="chat-avatar ai">AI</div>
        <div class="chat-bubble ai">申し訳ありません。エラーが発生しました。</div>
      </div>
    `;
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
