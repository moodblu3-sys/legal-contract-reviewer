const messages = document.querySelector("#messages");
const form = document.querySelector("#review-form");
const input = document.querySelector("#message-input");
const sendButton = document.querySelector("#send-button");

function now() {
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function appendMessage({ author, avatar, className, html }) {
  const article = document.createElement("article");
  article.className = `message ${className}`;
  article.innerHTML = `
    <div class="avatar ${className === "bot" ? "bot-avatar" : ""}">${avatar}</div>
    <div class="bubble">
      <div class="meta">${author} <span>${now()}</span></div>
      ${html}
    </div>
  `;
  messages.appendChild(article);
  messages.scrollTop = messages.scrollHeight;
  return article;
}

function classifyBlock(text) {
  if (text.includes("重大度：高") || text.includes("重大度: 高") || text.includes("【重大度: 高】") || text.includes("【重大度：高】")) {
    return "risk-high";
  }
  if (text.includes("重大度：中") || text.includes("重大度: 中") || text.includes("【重大度: 中】") || text.includes("【重大度：中】")) {
    return "risk-mid";
  }
  if (text.includes("重大度：低") || text.includes("重大度: 低") || text.includes("【重大度: 低】") || text.includes("【重大度：低】")) {
    return "risk-low";
  }
  return "";
}

function renderReview(result) {
  const answer = result.answer ?? "";
  const chunks = answer
    .split(/\n(?=(?:- )?該当条項：|###?\s*\d+\)|##\s*【重大度|【重大度)/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  const summary = chunks.shift() ?? answer;
  const blocks = chunks
    .map((chunk) => `<div class="review-block ${classifyBlock(chunk)}">${escapeHtml(chunk)}</div>`)
    .join("");
  const citations = result.citations?.length ?? 0;
  const fileName = result.file?.name ?? result.file?.id ?? "Box file";
  return `
    <div class="review">
      <h2>契約レビュー結果（${escapeHtml(result.standpoint)}）</h2>
      <div class="source">対象: ${escapeHtml(fileName)} / 出典: ${citations}件</div>
      <div class="review-block">${escapeHtml(summary)}</div>
      ${blocks}
    </div>
  `;
}

async function submitReview(message) {
  appendMessage({
    author: "営業担当",
    avatar: "田",
    className: "user",
    html: `<p>${escapeHtml(message)}</p>`,
  });

  const loading = appendMessage({
    author: "契約レビューBot",
    avatar: "契",
    className: "bot",
    html: "<p>Box上の契約書を確認し、Box AIで法務レビューを実行しています。</p>",
  });

  sendButton.disabled = true;
  try {
    const response = await fetch("/api/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error ?? "レビューに失敗しました。");
    }
    loading.querySelector(".bubble").innerHTML = `
      <div class="meta">契約レビューBot <span>${now()}</span></div>
      ${renderReview(data.result)}
    `;
  } catch (error) {
    loading.querySelector(".bubble").innerHTML = `
      <div class="meta">契約レビューBot <span>${now()}</span></div>
      <p>${escapeHtml(error.message)}</p>
    `;
  } finally {
    sendButton.disabled = false;
    messages.scrollTop = messages.scrollHeight;
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const message = input.value.trim();
  if (message) submitReview(message);
});

document.querySelectorAll("[data-prompt]").forEach((button) => {
  button.addEventListener("click", () => {
    input.value = button.dataset.prompt;
    input.focus();
  });
});
