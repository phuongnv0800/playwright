import type { FastifyInstance } from "fastify";

const uiStyles = `
:root {
  color-scheme: dark;
  --bg: #0a0d10;
  --bg-elevated: rgba(16, 22, 27, 0.82);
  --bg-soft: rgba(25, 34, 40, 0.68);
  --line: rgba(137, 171, 183, 0.2);
  --line-strong: rgba(137, 171, 183, 0.34);
  --text: #eff5f7;
  --muted: #8da6b0;
  --accent: #ffbf69;
  --accent-soft: rgba(255, 191, 105, 0.14);
  --signal: #73e2c6;
  --danger: #ff6b6b;
  --shadow: 0 24px 80px rgba(0, 0, 0, 0.42);
  --radius: 24px;
  --radius-sm: 14px;
  --mono: "JetBrains Mono", "SFMono-Regular", ui-monospace, monospace;
  --sans: "IBM Plex Sans", "Segoe UI", sans-serif;
  --display: "Space Grotesk", "IBM Plex Sans", sans-serif;
}

* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; }
body {
  font-family: var(--sans);
  color: var(--text);
  background:
    radial-gradient(circle at top left, rgba(0, 204, 255, 0.14), transparent 28%),
    radial-gradient(circle at 85% 10%, rgba(255, 191, 105, 0.16), transparent 22%),
    linear-gradient(180deg, #090b0d 0%, #0f1418 100%);
}

a { color: inherit; }

.shell {
  min-height: 100vh;
  display: grid;
  grid-template-columns: minmax(320px, 400px) minmax(0, 1fr);
}

.rail {
  border-right: 1px solid var(--line);
  background: linear-gradient(180deg, rgba(7, 10, 12, 0.96), rgba(10, 14, 17, 0.86));
  padding: 28px 24px 32px;
  position: sticky;
  top: 0;
  height: 100vh;
  overflow: auto;
}

.main {
  padding: 28px;
}

.brand {
  display: grid;
  gap: 10px;
  margin-bottom: 28px;
}

.kicker {
  font-size: 12px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--signal);
}

.brand h1 {
  margin: 0;
  font-family: var(--display);
  font-size: clamp(28px, 4vw, 42px);
  line-height: 0.95;
  letter-spacing: -0.04em;
}

.brand p {
  margin: 0;
  color: var(--muted);
  max-width: 30ch;
  line-height: 1.45;
}

.panel {
  background: var(--bg-elevated);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  backdrop-filter: blur(18px);
}

.rail .panel + .panel { margin-top: 18px; }

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 20px 0;
}

.panel-head h2,
.panel-head h3 {
  margin: 0;
  font-size: 14px;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--muted);
}

.panel-body {
  padding: 18px 20px 20px;
}

.field-grid {
  display: grid;
  gap: 12px;
}

.field-row {
  display: grid;
  gap: 8px;
}

.field-row.inline {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

label {
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}

input,
select,
button,
textarea {
  font: inherit;
}

input,
select,
textarea {
  width: 100%;
  border: 1px solid var(--line);
  background: rgba(7, 10, 12, 0.72);
  color: var(--text);
  border-radius: var(--radius-sm);
  padding: 12px 14px;
  transition: border-color 140ms ease, transform 140ms ease, background 140ms ease;
}

input:focus,
select:focus,
textarea:focus {
  outline: none;
  border-color: rgba(255, 191, 105, 0.8);
  background: rgba(9, 13, 15, 0.92);
}

button {
  border: 0;
  cursor: pointer;
  border-radius: 999px;
  padding: 12px 18px;
  font-weight: 600;
  letter-spacing: 0.02em;
  transition: transform 140ms ease, opacity 140ms ease, background 140ms ease;
}

button:hover { transform: translateY(-1px); }
button:disabled { opacity: 0.45; cursor: not-allowed; transform: none; }

.button-primary {
  background: linear-gradient(135deg, #ffc971, #ff9b71);
  color: #15110d;
}

.button-secondary {
  background: rgba(115, 226, 198, 0.12);
  color: var(--signal);
  border: 1px solid rgba(115, 226, 198, 0.2);
}

.button-ghost {
  background: rgba(255, 255, 255, 0.04);
  color: var(--text);
  border: 1px solid var(--line);
}

.button-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.run-list {
  display: grid;
  gap: 10px;
  max-height: 320px;
  overflow: auto;
}

.run-item {
  width: 100%;
  text-align: left;
  padding: 14px 16px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid transparent;
}

.run-item.active {
  background: linear-gradient(180deg, rgba(255, 191, 105, 0.14), rgba(255, 191, 105, 0.06));
  border-color: rgba(255, 191, 105, 0.35);
}

.run-item strong {
  display: block;
  font-size: 13px;
  margin-bottom: 6px;
}

.run-meta {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  color: var(--muted);
  font-size: 12px;
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--line);
  font-size: 12px;
  color: var(--text);
}

.badge[data-tone="success"] { color: var(--signal); border-color: rgba(115, 226, 198, 0.28); }
.badge[data-tone="warning"] { color: var(--accent); border-color: rgba(255, 191, 105, 0.28); }
.badge[data-tone="danger"] { color: var(--danger); border-color: rgba(255, 107, 107, 0.28); }

.hero {
  padding: 26px 28px;
  margin-bottom: 18px;
  display: grid;
  gap: 22px;
  background:
    linear-gradient(180deg, rgba(15, 22, 26, 0.86), rgba(10, 14, 17, 0.88)),
    radial-gradient(circle at top right, rgba(255, 191, 105, 0.18), transparent 32%);
}

.hero-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(340px, 0.85fr);
  gap: 20px;
  align-items: stretch;
}

.hero-copy {
  display: grid;
  gap: 18px;
  align-content: start;
}

.hero h2 {
  margin: 0;
  font-family: var(--display);
  font-size: clamp(28px, 4vw, 66px);
  letter-spacing: -0.05em;
  line-height: 0.96;
  max-width: 8ch;
}

.hero p {
  margin: 0;
  color: var(--muted);
  max-width: 58ch;
}

.hero-stack {
  display: grid;
  gap: 14px;
  align-content: start;
}

.hero-card {
  padding: 18px 18px 20px;
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--line);
  display: grid;
  gap: 12px;
}

.hero-card h3 {
  margin: 0;
  font-size: 12px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--muted);
}

.hero-card strong {
  font-size: 18px;
  line-height: 1.25;
}

.hero-keyvals {
  display: grid;
  gap: 10px;
}

.hero-keyval {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 14px;
}

.hero-keyval span {
  color: var(--muted);
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.hero-keyval strong {
  font-size: 14px;
  text-align: right;
  max-width: 28ch;
}

.hero-note {
  margin: 0;
  color: var(--muted);
  line-height: 1.5;
}

.hero-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.stats {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.activity-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.live-status {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.04);
  color: var(--muted);
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.live-status strong {
  color: var(--text);
  letter-spacing: 0;
  text-transform: none;
  font-size: 13px;
}

.live-dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: var(--muted);
  box-shadow: 0 0 0 0 rgba(141, 166, 176, 0.25);
}

.live-status[data-tone="running"] .live-dot {
  background: var(--signal);
  animation: pulse 1.2s infinite;
}

.live-status[data-tone="waiting"] .live-dot {
  background: var(--accent);
  animation: pulse 1.6s infinite;
}

.live-status[data-tone="error"] .live-dot {
  background: var(--danger);
}

@keyframes pulse {
  0% { box-shadow: 0 0 0 0 rgba(115, 226, 198, 0.28); }
  70% { box-shadow: 0 0 0 12px rgba(115, 226, 198, 0); }
  100% { box-shadow: 0 0 0 0 rgba(115, 226, 198, 0); }
}

.workspace {
  display: grid;
  grid-template-columns: minmax(320px, 420px) minmax(0, 1fr);
  gap: 18px;
}

.status-stack,
.inspector {
  min-height: 420px;
}

.status-grid {
  display: grid;
  gap: 10px;
}

.status-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--line);
}

.status-label {
  color: var(--muted);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
}

.status-value {
  font-weight: 600;
}

.muted {
  color: var(--muted);
}

.review-box {
  padding: 14px 16px;
  border-radius: 18px;
  background: rgba(255, 107, 107, 0.08);
  border: 1px solid rgba(255, 107, 107, 0.16);
  color: #ffd7d7;
  line-height: 1.5;
}

.run-note {
  padding: 14px 16px;
  border-radius: 18px;
  background: rgba(115, 226, 198, 0.08);
  border: 1px solid rgba(115, 226, 198, 0.18);
  color: #dffaf2;
  line-height: 1.5;
}

.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 14px 18px 0;
  border-bottom: 1px solid var(--line);
}

.tab {
  padding: 10px 14px;
  border-radius: 999px;
  background: transparent;
  color: var(--muted);
  border: 1px solid transparent;
}

.tab.active {
  background: var(--accent-soft);
  color: var(--accent);
  border-color: rgba(255, 191, 105, 0.24);
}

.json-shell {
  padding: 18px;
}

.json-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 14px;
}

pre {
  margin: 0;
  padding: 18px;
  border-radius: 18px;
  background: rgba(7, 10, 12, 0.9);
  border: 1px solid var(--line);
  color: #d8f8ff;
  font-family: var(--mono);
  font-size: 12px;
  line-height: 1.6;
  overflow: auto;
  min-height: 440px;
}

.empty {
  color: var(--muted);
  padding: 24px;
}

.toast {
  position: fixed;
  right: 22px;
  bottom: 22px;
  max-width: 340px;
  padding: 14px 16px;
  border-radius: 18px;
  background: rgba(10, 14, 17, 0.94);
  border: 1px solid var(--line-strong);
  box-shadow: var(--shadow);
  transform: translateY(18px);
  opacity: 0;
  pointer-events: none;
  transition: opacity 180ms ease, transform 180ms ease;
}

.toast.show {
  opacity: 1;
  transform: translateY(0);
}

@media (max-width: 1120px) {
  .shell {
    grid-template-columns: 1fr;
  }

  .rail {
    position: static;
    height: auto;
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }

  .workspace {
    grid-template-columns: 1fr;
  }

  .hero-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .main {
    padding: 18px;
  }

  .rail {
    padding: 20px 18px 24px;
  }

  .hero,
  .panel-body {
    padding-left: 16px;
    padding-right: 16px;
  }

  .field-row.inline {
    grid-template-columns: 1fr;
  }
}
`;

const uiScript = `
const state = {
  runs: [],
  selectedRunId: null,
  selectedRun: null,
  selectedTab: "overview",
  timer: null,
  pendingRequests: 0,
  lastLoadedAt: null,
};

const els = {
  form: document.querySelector("#crawl-form"),
  authMode: document.querySelector("#auth-mode"),
  recentRuns: document.querySelector("#recent-runs"),
  selectedTitle: document.querySelector("#selected-title"),
  selectedUrl: document.querySelector("#selected-url"),
  runStatus: document.querySelector("#run-status"),
  discoveryStatus: document.querySelector("#discovery-status"),
  authStatus: document.querySelector("#auth-status"),
  crawlStatus: document.querySelector("#crawl-status"),
  deliveryStatus: document.querySelector("#delivery-status"),
  reviewReason: document.querySelector("#review-reason"),
  jsonView: document.querySelector("#json-view"),
  jsonMeta: document.querySelector("#json-meta"),
  tabRow: document.querySelector("#tab-row"),
  otpForm: document.querySelector("#otp-form"),
  otpCode: document.querySelector("#otp-code"),
  approveButton: document.querySelector("#approve-run"),
  retryAuthButton: document.querySelector("#retry-auth"),
  refreshButton: document.querySelector("#refresh-run"),
  openJsonLink: document.querySelector("#open-json-link"),
  totalRuns: document.querySelector("#stat-runs"),
  activeRuns: document.querySelector("#stat-active"),
  selectedRunStat: document.querySelector("#stat-selected"),
  liveStatus: document.querySelector("#live-status"),
  lastSync: document.querySelector("#last-sync"),
  runNote: document.querySelector("#run-note"),
  heroRunId: document.querySelector("#hero-run-id"),
  heroSeed: document.querySelector("#hero-seed"),
  heroChallenge: document.querySelector("#hero-challenge"),
  heroAction: document.querySelector("#hero-action"),
  heroReview: document.querySelector("#hero-review"),
  heroCounts: document.querySelector("#hero-counts"),
  toast: document.querySelector("#toast"),
};

function showToast(message, isError = false) {
  els.toast.textContent = message;
  els.toast.style.borderColor = isError ? "rgba(255, 107, 107, 0.4)" : "rgba(115, 226, 198, 0.28)";
  els.toast.classList.add("show");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => els.toast.classList.remove("show"), 2600);
}

async function api(path, options = {}) {
  state.pendingRequests += 1;
  refreshLiveState();
  try {
    const headers = {
      ...(options.headers || {}),
    };
    if (options.body !== undefined && !headers["content-type"]) {
      headers["content-type"] = "application/json";
    }
    const response = await fetch(path, {
      headers,
      ...options,
    });

    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const message = payload?.message || payload?.reviewReason || payload?.error || response.statusText;
      throw new Error(message);
    }
    return payload;
  } finally {
    state.pendingRequests -= 1;
    refreshLiveState();
  }
}

function toneForStatus(status) {
  if (status === "succeeded" || status === "approved" || status === "skipped") return "success";
  if (status === "failed") return "danger";
  if (status === "needs_review" || status === "partial_success" || status === "running") return "warning";
  return "neutral";
}

function badge(label, value) {
  return '<span class="badge" data-tone="' + toneForStatus(value) + '">' + label + ': ' + value + "</span>";
}

function neutralBadge(label, value) {
  return '<span class="badge">' + label + ': <strong>' + value + "</strong></span>";
}

function formatJson(value) {
  return JSON.stringify(value, null, 2);
}

function describeRunState(run) {
  if (!run) {
    return {
      tone: "idle",
      label: "Idle",
      detail: "Chọn một crawl run hoặc tạo run mới để bắt đầu.",
    };
  }

  if (state.pendingRequests > 0) {
    return {
      tone: "running",
      label: "Syncing",
      detail: "Dashboard đang gọi API và refresh trạng thái mới nhất.",
    };
  }

  if (run.status === "failed") {
    return {
      tone: "error",
      label: "Stopped",
      detail: "Run đã dừng do lỗi. Xem review reason hoặc JSON view để biết chi tiết.",
    };
  }

  if (run.status === "needs_review") {
    if (run.authStatus === "needs_review" && /otp/i.test(run.reviewReason || "")) {
      return {
        tone: "waiting",
        label: "Waiting for OTP",
        detail: "Run đã pause ở bước OTP. Worker không tự chạy tiếp cho đến khi bạn bấm Submit OTP.",
      };
    }

    if (run.authStatus === "needs_review") {
      return {
        tone: "waiting",
        label: "Auth paused",
        detail: "Run đang dừng ở bước xác thực. Tool không chạy tiếp ở background cho đến khi bạn sửa input hoặc bấm Retry Auth.",
      };
    }

    if (run.discoveryStatus === "needs_review") {
      return {
        tone: "waiting",
        label: "Discovery paused",
        detail: "AI discovery đã pause để chờ review. Worker hiện không còn chạy tiếp.",
      };
    }

    return {
      tone: "waiting",
      label: "Needs review",
      detail: "Run đang pause để chờ thao tác tay, không phải đang retry vô hạn ở background.",
    };
  }

  if (run.status === "running" || run.discoveryStatus === "running" || run.authStatus === "running" || run.crawlStatus === "running") {
    return {
      tone: "running",
      label: "Worker running",
      detail: "Tool đang chạy thật ở background. Dashboard tự refresh mỗi 5 giây.",
    };
  }

  if (run.status === "queued" || run.discoveryStatus === "queued" || run.authStatus === "queued") {
    return {
      tone: "waiting",
      label: "Queued",
      detail: "Run đang chờ worker lấy job và tiếp tục xử lý.",
    };
  }

  return {
    tone: "idle",
    label: "Idle",
    detail: "Run đã hoàn tất hoặc hiện không có tiến trình nào đang chạy.",
  };
}

function refreshLiveState() {
  const info = describeRunState(state.selectedRun);
  els.liveStatus.dataset.tone = info.tone;
  els.liveStatus.innerHTML = '<span class="live-dot"></span><span>Session</span><strong>' + info.label + "</strong>";
  els.runNote.textContent = info.detail;
  els.lastSync.textContent = state.lastLoadedAt ? new Date(state.lastLoadedAt).toLocaleTimeString() : "--:--:--";
}

function isOtpAwaiting(run, latestChallenge, challenges = []) {
  if (!run || run.authStatus !== "needs_review") {
    return false;
  }

  if (latestChallenge?.challengeType === "otp") {
    return true;
  }

  if (run.authConfig?.otp?.mode === "manual") {
    return true;
  }

  return Array.isArray(challenges) && challenges.some((challenge) => challenge.challengeType === "otp");
}

function describeNextAction(run, latestChallenge, challenges) {
  if (!run) {
    return "Chọn một run để xem bước kế tiếp.";
  }

  if (isOtpAwaiting(run, latestChallenge, challenges)) {
    return "Nhập OTP ở panel trái rồi bấm Submit OTP. Worker hiện đang pause, không retry nền.";
  }

  if (run.authStatus === "needs_review") {
    return "Kiểm tra lại login flow hoặc credential, sau đó bấm Retry Auth.";
  }

  if (run.discoveryStatus === "needs_review") {
    return "Run đã dừng ở discovery. Review output và approve nếu muốn tiếp tục.";
  }

  if (run.status === "running") {
    return "Chờ worker hoàn tất. Dashboard sẽ tự refresh và cập nhật JSON khi có output.";
  }

  if (run.status === "succeeded" || run.status === "partial_success") {
    return "Mở tab Summary hoặc Records để kiểm tra dữ liệu crawl và artifact index.";
  }

  return "Dùng Refresh để đồng bộ trạng thái mới nhất hoặc chọn run khác.";
}

function renderHeroSummary(view) {
  const run = view.crawlRun;
  const latestChallenge = Array.isArray(view.challenges) && view.challenges.length > 0 ? view.challenges[0] : null;
  els.heroRunId.textContent = run.id;
  els.heroSeed.textContent = run.seedUrl;
  els.heroChallenge.textContent = latestChallenge
    ? [latestChallenge.challengeType, latestChallenge.status, latestChallenge.detail?.mode || "unknown"].join(" • ")
    : "No challenge recorded";
  els.heroAction.textContent = describeNextAction(run, latestChallenge, view.challenges);
  els.heroReview.textContent = run.reviewReason || "No review reason";
  els.heroCounts.innerHTML = [
    neutralBadge("Pages", String(view.pages?.length ?? 0)),
    neutralBadge("Entities", String(view.entities?.length ?? 0)),
    neutralBadge("Challenges", String(view.challenges?.length ?? 0)),
    neutralBadge("Exports", String(view.exports?.length ?? 0)),
  ].join("");
}

function setSelectedRun(runId) {
  state.selectedRunId = runId;
  state.selectedTab = "overview";
  renderRuns();
  loadSelectedRun();
  startPolling();
}

function renderRuns() {
  els.recentRuns.innerHTML = "";
  els.totalRuns.textContent = String(state.runs.length);
  els.activeRuns.textContent = String(state.runs.filter((run) => ["queued", "running", "needs_review"].includes(run.status)).length);
  els.selectedRunStat.textContent = state.selectedRunId ? state.selectedRunId.replace("crawl_", "") : "none";

  if (state.runs.length === 0) {
    els.recentRuns.innerHTML = '<div class="empty">Chưa có crawl run nào.</div>';
    return;
  }

  for (const run of state.runs) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "run-item" + (run.id === state.selectedRunId ? " active" : "");
    button.innerHTML = \`
      <strong>\${run.seedUrl}</strong>
      <div class="run-meta">
        <span>\${run.id}</span>
        <span>\${run.status}</span>
        <span>\${new Date(run.createdAt).toLocaleString()}</span>
      </div>
    \`;
    button.addEventListener("click", () => setSelectedRun(run.id));
    els.recentRuns.appendChild(button);
  }
}

function renderTabs(view) {
  const tabs = [
    ["overview", "Overview"],
    ["summary.json", "Summary"],
    ["records.json", "Records"],
    ["artifact-index.json", "Artifacts"],
    ["pages", "Pages"],
    ["entities", "Entities"],
    ["challenges", "Challenges"],
  ];

  els.tabRow.innerHTML = "";
  for (const [key, label] of tabs) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tab" + (state.selectedTab === key ? " active" : "");
    button.textContent = label;
    button.addEventListener("click", () => {
      state.selectedTab = key;
      renderJsonPanel(view);
      renderTabs(view);
    });
    els.tabRow.appendChild(button);
  }
}

function currentPayload(view) {
  const files = view.files || {};
  if (state.selectedTab === "summary.json") return files["summary.json"] || { message: "summary.json chưa có" };
  if (state.selectedTab === "records.json") return files["records.json"] || { message: "records.json chưa có" };
  if (state.selectedTab === "artifact-index.json") return files["artifact-index.json"] || { message: "artifact-index.json chưa có" };
  if (state.selectedTab === "pages") return view.pages || [];
  if (state.selectedTab === "entities") return view.entities || [];
  if (state.selectedTab === "challenges") return view.challenges || [];
  return view;
}

function renderJsonPanel(view) {
  const payload = currentPayload(view);
  els.jsonMeta.innerHTML = [
    badge("Run", view.crawlRun.status),
    badge("Discovery", view.crawlRun.discoveryStatus),
    badge("Auth", view.crawlRun.authStatus),
    badge("Crawl", view.crawlRun.crawlStatus),
    badge("Delivery", view.crawlRun.deliveryStatus),
  ].join("");
  els.jsonView.textContent = formatJson(payload);
}

function renderSelected(view) {
  const run = view.crawlRun;
  const latestChallenge = Array.isArray(view.challenges) && view.challenges.length > 0 ? view.challenges[0] : null;
  state.selectedRun = run;
  els.selectedTitle.textContent = run.id;
  els.selectedUrl.textContent = run.seedUrl;
  els.runStatus.innerHTML = badge("Run", run.status);
  els.discoveryStatus.innerHTML = badge("Discovery", run.discoveryStatus);
  els.authStatus.innerHTML = badge("Auth", run.authStatus);
  els.crawlStatus.innerHTML = badge("Crawl", run.crawlStatus);
  els.deliveryStatus.innerHTML = badge("Delivery", run.deliveryStatus);
  els.reviewReason.textContent = run.reviewReason || "Không có review reason";
  els.openJsonLink.href = "/crawl-runs/" + run.id + "/json-view";
  const otpRequired = isOtpAwaiting(run, latestChallenge, view.challenges);
  els.otpCode.disabled = !otpRequired;
  els.otpForm.querySelector("button").disabled = !otpRequired;
  els.otpCode.placeholder = otpRequired ? "Enter one-time code" : "OTP input chỉ mở khi run đang chờ OTP";
  renderHeroSummary(view);
  renderTabs(view);
  renderJsonPanel(view);
  refreshLiveState();
}

async function loadRuns() {
  state.runs = await api("/crawl-runs?limit=24");
  state.lastLoadedAt = Date.now();
  renderRuns();
  if (!state.selectedRunId && state.runs[0]) {
    state.selectedRunId = state.runs[0].id;
    renderRuns();
    await loadSelectedRun();
    startPolling();
  }
}

async function loadSelectedRun() {
  if (!state.selectedRunId) {
    return;
  }
  const view = await api("/crawl-runs/" + state.selectedRunId + "/json-view");
  state.lastLoadedAt = Date.now();
  renderSelected(view);
}

function startPolling() {
  if (state.timer) clearInterval(state.timer);
  state.timer = setInterval(() => {
    if (state.selectedRunId) {
      Promise.all([loadRuns(), loadSelectedRun()]).catch((error) => showToast(error.message, true));
    }
  }, 5000);
}

async function handleCreate(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const authMode = form.get("authMode");
  const username = String(form.get("username") || "").trim();
  const password = String(form.get("password") || "").trim();
  const payload = {
    url: String(form.get("url") || "").trim(),
    auth: {
      mode: authMode,
      credentials: username || password ? { username, password } : {},
    },
    crawl: {
      maxDepth: Number(form.get("maxDepth") || 1),
      maxPages: Number(form.get("maxPages") || 20),
      maxRecords: Number(form.get("maxRecords") || 50),
      sameOriginOnly: true,
    },
  };

  const run = await api("/crawl-from-url", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  showToast("Đã tạo crawl run " + run.id);
  await loadRuns();
  setSelectedRun(run.id);
}

async function submitOtp(event) {
  event.preventDefault();
  if (!state.selectedRunId) return;
  const code = els.otpCode.value.trim();
  if (!code) return;
  await api("/crawl-runs/" + state.selectedRunId + "/submit-otp", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
  els.otpCode.value = "";
  showToast("Đã gửi OTP và requeue auth");
  await loadRuns();
  await loadSelectedRun();
}

async function approveRun() {
  if (!state.selectedRunId) return;
  await api("/crawl-runs/" + state.selectedRunId + "/approve", { method: "POST" });
  showToast("Đã approve crawl run");
  await loadRuns();
  await loadSelectedRun();
}

async function retryAuth() {
  if (!state.selectedRunId) return;
  await api("/crawl-runs/" + state.selectedRunId + "/retry-auth", { method: "POST" });
  showToast("Đã requeue auth");
  await loadRuns();
  await loadSelectedRun();
}

els.form.addEventListener("submit", (event) => {
  handleCreate(event).catch((error) => showToast(error.message, true));
});
els.otpForm.addEventListener("submit", (event) => {
  submitOtp(event).catch((error) => showToast(error.message, true));
});
els.approveButton.addEventListener("click", () => {
  approveRun().catch((error) => showToast(error.message, true));
});
els.retryAuthButton.addEventListener("click", () => {
  retryAuth().catch((error) => showToast(error.message, true));
});
els.refreshButton.addEventListener("click", () => {
  Promise.all([loadRuns(), loadSelectedRun()]).catch((error) => showToast(error.message, true));
});

loadRuns().catch((error) => showToast(error.message, true));
`;

const uiHtml = `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Browser Crawl Control Room</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&family=Space+Grotesk:wght@500;700&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="/ui/styles.css" />
  </head>
  <body>
    <div class="shell">
      <aside class="rail">
        <div class="brand">
          <span class="kicker">Browser Automation Platform</span>
          <h1>Control the crawl. Inspect the JSON.</h1>
          <p>Launch a protected-site crawl, inject OTP when auth pauses, and inspect records, pages, and artifact indexes without leaving the browser.</p>
        </div>

        <section class="panel">
          <div class="panel-head"><h2>New Crawl Run</h2></div>
          <div class="panel-body">
            <form id="crawl-form" class="field-grid">
              <div class="field-row">
                <label for="url">Seed URL</label>
                <input id="url" name="url" type="url" required value="https://eoffice.vnpt.vn/qlvbdh/main" />
              </div>
              <div class="field-row">
                <label for="auth-mode">Auth Mode</label>
                <select id="auth-mode" name="authMode">
                  <option value="form">Form</option>
                  <option value="auto">Auto</option>
                  <option value="oauth">OAuth</option>
                  <option value="none">None</option>
                </select>
              </div>
              <div class="field-row">
                <label for="username">Username</label>
                <input id="username" name="username" type="text" autocomplete="username" />
              </div>
              <div class="field-row">
                <label for="password">Password</label>
                <input id="password" name="password" type="password" autocomplete="current-password" />
              </div>
              <div class="field-row inline">
                <div>
                  <label for="maxDepth">Max Depth</label>
                  <input id="maxDepth" name="maxDepth" type="number" min="1" value="1" />
                </div>
                <div>
                  <label for="maxPages">Max Pages</label>
                  <input id="maxPages" name="maxPages" type="number" min="1" value="20" />
                </div>
                <div>
                  <label for="maxRecords">Max Records</label>
                  <input id="maxRecords" name="maxRecords" type="number" min="1" value="50" />
                </div>
              </div>
              <button class="button-primary" type="submit">Start Crawl</button>
            </form>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head"><h2>Recent Runs</h2><span class="badge">latest 24</span></div>
          <div class="panel-body">
            <div id="recent-runs" class="run-list"></div>
          </div>
        </section>
      </aside>

      <main class="main">
        <section class="panel hero">
          <div class="hero-grid">
            <div class="hero-copy">
              <div>
                <span class="kicker">Operations Surface</span>
                <h2>Live crawl state with JSON-first inspection.</h2>
              </div>
              <p>The selected run streams back state, review reasons, challenge history, and parsed export files. Use this surface for VNPT eOffice or any protected site routed through the generic crawl flow.</p>
              <div class="stats">
                <span class="badge">Runs: <strong id="stat-runs">0</strong></span>
                <span class="badge">Queued/Running: <strong id="stat-active">0</strong></span>
                <span class="badge">Selected: <strong id="stat-selected">none</strong></span>
              </div>
              <div class="activity-strip">
                <div id="live-status" class="live-status" data-tone="idle"><span class="live-dot"></span><span>Session</span><strong>Idle</strong></div>
                <span class="badge">Auto refresh: 5s</span>
                <span class="badge">Last sync: <strong id="last-sync">--:--:--</strong></span>
              </div>
            </div>

            <div class="hero-stack">
              <div class="hero-card">
                <h3>Current Run</h3>
                <strong id="hero-run-id">No run selected</strong>
                <p class="hero-note" id="hero-seed">Select a run to see the live summary.</p>
                <div class="hero-pills" id="hero-counts"></div>
              </div>

              <div class="hero-card">
                <h3>Next Action</h3>
                <p class="hero-note" id="hero-action">Chọn một run để xem bước kế tiếp.</p>
                <div class="hero-keyvals">
                  <div class="hero-keyval">
                    <span>Latest Challenge</span>
                    <strong id="hero-challenge">No challenge recorded</strong>
                  </div>
                  <div class="hero-keyval">
                    <span>Review Reason</span>
                    <strong id="hero-review">No review reason</strong>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class="workspace">
          <section class="panel status-stack">
            <div class="panel-head">
              <div>
                <h3 id="selected-title">No run selected</h3>
                <div id="selected-url" class="muted"></div>
              </div>
              <div class="button-row">
                <button id="refresh-run" class="button-ghost" type="button">Refresh</button>
                <a id="open-json-link" class="badge" href="#" target="_blank" rel="noreferrer">Open JSON API</a>
              </div>
            </div>
            <div class="panel-body">
              <div class="status-grid">
                <div class="status-row"><span class="status-label">Run</span><span class="status-value" id="run-status"></span></div>
                <div class="status-row"><span class="status-label">Discovery</span><span class="status-value" id="discovery-status"></span></div>
                <div class="status-row"><span class="status-label">Auth</span><span class="status-value" id="auth-status"></span></div>
                <div class="status-row"><span class="status-label">Crawl</span><span class="status-value" id="crawl-status"></span></div>
                <div class="status-row"><span class="status-label">Delivery</span><span class="status-value" id="delivery-status"></span></div>
              </div>

              <div style="height:14px"></div>
              <div class="run-note" id="run-note">Chọn một crawl run hoặc tạo run mới để bắt đầu.</div>

              <div style="height:14px"></div>
              <div class="review-box" id="review-reason">Không có review reason</div>

              <div style="height:18px"></div>
              <div class="button-row">
                <button id="approve-run" class="button-secondary" type="button">Approve Run</button>
                <button id="retry-auth" class="button-ghost" type="button">Retry Auth</button>
              </div>

              <div style="height:18px"></div>
              <form id="otp-form" class="field-grid">
                <div class="field-row">
                  <label for="otp-code">Manual OTP</label>
                  <input id="otp-code" type="text" inputmode="numeric" placeholder="Enter one-time code" />
                </div>
                <button class="button-primary" type="submit">Submit OTP</button>
              </form>
            </div>
          </section>

          <section class="panel inspector">
            <div class="tabs" id="tab-row"></div>
            <div class="json-shell">
              <div class="json-meta" id="json-meta"></div>
              <pre id="json-view">{}</pre>
            </div>
          </section>
        </section>
      </main>
    </div>

    <div id="toast" class="toast"></div>
    <script type="module" src="/ui/app.js"></script>
  </body>
</html>
`;

export async function registerUiRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async (_request, reply) => {
    reply.type("text/html; charset=utf-8");
    return uiHtml;
  });

  app.get("/ui/styles.css", async (_request, reply) => {
    reply.type("text/css; charset=utf-8");
    return uiStyles;
  });

  app.get("/ui/app.js", async (_request, reply) => {
    reply.type("text/javascript; charset=utf-8");
    return uiScript;
  });
}
