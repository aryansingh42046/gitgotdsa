// Isolated world: builds the payload for GeeksforGeeks and pushes it.

const GFG_EXT = {
  cpp: "cpp",
  "c++": "cpp",
  c: "c",
  java: "java",
  python: "py",
  python3: "py",
  javascript: "js",
  csharp: "cs",
  php: "php",
  scala: "scala",
  ruby: "rb",
  kotlin: "kt",
  go: "go",
};

function gfgSlug() {
  const m = location.pathname.match(/\/problems\/([^/]+)/);
  return m ? m[1].replace(/\d+$/, "").replace(/-+$/, "") : null;
}

function gfgText(selectors) {
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.textContent.trim()) return el.textContent.trim();
  }
  return null;
}

function gfgDifficulty() {
  const raw =
    gfgText(['[class*="problemDifficulty"]', '[class*="difficulty"]']) || "";
  const found = ["School", "Basic", "Easy", "Medium", "Hard"].find((d) =>
    raw.toLowerCase().includes(d.toLowerCase()),
  );
  return found || "Unrated";
}

function gfgStatement() {
  const el = document.querySelector(
    '[class*="problems_problem_content"], [class*="problem-statement"], .problems_problem_content__Xm_eO',
  );
  if (!el) return "";
  return el.innerText.replace(/\n{3,}/g, "\n\n").trim();
}

function gfgTags() {
  return Array.from(
    document.querySelectorAll('[class*="problem_tags"] a, [class*="tags"] a'),
  )
    .map((a) => a.textContent.trim())
    .filter(Boolean)
    .slice(0, 8);
}

window.addEventListener("gitgotdsa:gfg-accepted", (event) => {
  const detail = event.detail || {};
  const slug = gfgSlug();
  if (!slug || !detail.code) return;

  const lang = String(detail.language || "cpp").toLowerCase();
  const title =
    gfgText(["h3.problemTitle", '[class*="problemTitle"]', "h1", "h3"]) ||
    slug.replace(/-/g, " ");

  const payload = {
    platform: "geeksforgeeks",
    slug,
    title,
    difficulty: gfgDifficulty(),
    tags: gfgTags(),
    description: gfgStatement(),
    url: location.origin + location.pathname,
    code: detail.code,
    language: detail.language || "C++",
    extension: GFG_EXT[lang] || "txt",
    runtime: detail.runtime ? `${detail.runtime}` : null,
    memory: detail.memory ? `${detail.memory}` : null,
  };

  chrome.runtime.sendMessage({ type: "PUSH_SOLUTION", payload }, (res) => {
    if (chrome.runtime.lastError) return;
    gfgToast(res);
  });
});

function gfgToast(res) {
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
