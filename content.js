// Isolated-world content script: collects problem details and forwards the
// accepted submission to the background service worker.

const EXT = {
  python3: "py",
  python: "py",
  java: "java",
  cpp: "cpp",
  c: "c",
  csharp: "cs",
  javascript: "js",
  typescript: "ts",
  golang: "go",
  ruby: "rb",
  swift: "swift",
  kotlin: "kt",
  rust: "rs",
  scala: "scala",
  php: "php",
  racket: "rkt",
  erlang: "erl",
  elixir: "ex",
  dart: "dart",
  mysql: "sql",
  mssql: "sql",
  oraclesql: "sql",
  postgresql: "sql",
  pythondata: "py",
  bash: "sh",
};

function slugFromUrl() {
  const m = location.pathname.match(/\/problems\/([^/]+)/);
  return m ? m[1] : null;
}

async function gql(query, variables) {
  const res = await fetch("https://leetcode.com/graphql/", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  return json.data;
}

async function fetchQuestion(slug) {
  const data = await gql(
    `query q($titleSlug: String!) {
      question(titleSlug: $titleSlug) {
        questionFrontendId
        title
        titleSlug
        difficulty
        content
        topicTags { name }
      }
    }`,
    { titleSlug: slug },
  );
  return data && data.question;
}

async function fetchSubmission(id) {
  const data = await gql(
    `query s($submissionId: Int!) {
      submissionDetails(submissionId: $submissionId) {
        code
        lang { name verboseName }
        runtimeDisplay
        memoryDisplay
        runtimePercentile
        memoryPercentile
      }
    }`,
    { submissionId: Number(id) },
  );
  return data && data.submissionDetails;
}

function htmlToMarkdown(html) {
  if (!html) return "";
  const el = document.createElement("div");
  el.innerHTML = html;
  el.querySelectorAll("sup").forEach((n) => (n.textContent = "^" + n.textContent));
  el.querySelectorAll("code").forEach((n) => (n.textContent = "`" + n.textContent + "`"));
  el.querySelectorAll("strong,b").forEach(
    (n) => (n.textContent = "**" + n.textContent + "**"),
  );
  el.querySelectorAll("li").forEach((n) => (n.textContent = "- " + n.textContent));
  return el.textContent.replace(/\n{3,}/g, "\n\n").trim();
}

window.addEventListener("gitgotdsa:accepted", async (event) => {
  const detail = event.detail || {};
  const slug = slugFromUrl();
  if (!slug) return;

  try {
    const [question, submission] = await Promise.all([
      fetchQuestion(slug),
      detail.submissionId ? fetchSubmission(detail.submissionId) : null,
    ]);
    if (!question || !submission || !submission.code) return;

    const langSlug = (submission.lang && submission.lang.name) || detail.langSlug;
    const payload = {
      slug,
      frontendId: question.questionFrontendId,
      title: question.title,
      difficulty: question.difficulty,
      tags: (question.topicTags || []).map((t) => t.name),
      description: htmlToMarkdown(question.content),
      url: `https://leetcode.com/problems/${slug}/`,
      code: submission.code,
      language: (submission.lang && submission.lang.verboseName) || detail.lang,
      extension: EXT[langSlug] || "txt",
      runtime: submission.runtimeDisplay || detail.runtime,
      memory: submission.memoryDisplay || detail.memory,
      runtimePercentile: submission.runtimePercentile,
      memoryPercentile: submission.memoryPercentile,
    };

    chrome.runtime.sendMessage({ type: "PUSH_SOLUTION", payload }, (res) => {
      if (chrome.runtime.lastError) return;
      toast(res);
    });
  } catch (err) {
    console.error("[GitGotDSA]", err);
  }
});

function toast(res) {
  const ok = res && res.ok;
  const node = document.createElement("div");
  node.textContent = ok
    ? `GitGotDSA: pushed to ${res.repo}`
    : `GitGotDSA: ${(res && res.error) || "not configured"}`;
  Object.assign(node.style, {
    position: "fixed",
    zIndex: "2147483647",
    bottom: "24px",
    right: "24px",
    padding: "12px 16px",
    borderRadius: "10px",
    font: "600 13px/1.3 ui-sans-serif, system-ui, sans-serif",
    color: "#0b1020",
    background: ok ? "#7cf0a5" : "#ffb4a2",
    boxShadow: "0 10px 30px rgba(0,0,0,.35)",
  });
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 5000);
}
