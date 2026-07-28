// Codeforces: watches your submissions list for new Accepted verdicts,
// grabs the source, and pushes it.

const CF_EXT = [
  [/g\+\+|gnu c\+\+|clang\+\+|ms c\+\+/i, "cpp"],
  [/gnu c\b|\bc11\b/i, "c"],
  [/python|pypy/i, "py"],
  [/java\b/i, "java"],
  [/kotlin/i, "kt"],
  [/c#|mono|\.net/i, "cs"],
  [/rust/i, "rs"],
  [/go\b/i, "go"],
  [/javascript|node/i, "js"],
  [/ruby/i, "rb"],
  [/php/i, "php"],
  [/haskell/i, "hs"],
  [/pascal/i, "pas"],
  [/scala/i, "scala"],
];

function cfExtension(lang) {
  const hit = CF_EXT.find(([re]) => re.test(lang || ""));
  return hit ? hit[1] : "txt";
}

function csrf() {
  const input = document.querySelector('input[name="csrf_token"]');
  if (input) return input.value;
  const meta = document.querySelector('meta[name="X-Csrf-Token"]');
  return meta ? meta.content : null;
}

async function cfSource(submissionId) {
  const token = csrf();
  if (!token) return null;
  const res = await fetch("/data/submitSource", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ submissionId, csrf_token: token }).toString(),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data && data.source ? data : null;
}

async function cfProblem(href) {
  try {
    const res = await fetch(href, { credentials: "include" });
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const body = doc.querySelector(".problem-statement");
    const tags = Array.from(doc.querySelectorAll(".tag-box")).map((t) =>
      t.textContent.trim(),
    );
    const rating = tags.find((t) => /^\*\d+$/.test(t));
    return {
      description: body ? body.innerText.replace(/\n{3,}/g, "\n\n").trim() : "",
      tags: tags.filter((t) => !/^\*\d+$/.test(t)).slice(0, 8),
      difficulty: rating ? `Rating ${rating.slice(1)}` : "Unrated",
    };
  } catch {
    return { description: "", tags: [], difficulty: "Unrated" };
  }
}

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function scanCodeforces() {
  const rows = Array.from(
    document.querySelectorAll("tr[data-submission-id]"),
  ).slice(0, 10);
  const { solved = {} } = await chrome.storage.local.get("solved");

  for (const row of rows) {
    const id = row.getAttribute("data-submission-id");
    const verdict = row.querySelector(".verdict-accepted");
    if (!verdict) continue;

    const link = row.querySelector('td a[href*="/problem/"]');
    if (!link) continue;
    const problemName = link.textContent.trim().replace(/\s+/g, " ");
    const [index, ...rest] = problemName.split(" - ");
    const title = rest.join(" - ") || problemName;
    const cells = row.querySelectorAll("td");
    const language = cells[4] ? cells[4].textContent.trim() : "";
    const runtime = cells[5] ? cells[5].textContent.trim() : "";
    const memory = cells[6] ? cells[6].textContent.trim() : "";

    const slug = `${slugify(index)}-${slugify(title)}`;
    const key = `cf:${slug}`;
    if (solved[key]) continue;

    const source = await cfSource(id);
    if (!source) continue;
    const meta = await cfProblem(link.href);

    const payload = {
      platform: "codeforces",
      slug,
      solvedKey: key,
      frontendId: index,
      title,
      difficulty: meta.difficulty,
      tags: meta.tags,
      description: meta.description,
      url: link.href,
      code: source.source,
      language: language || "Unknown",
      extension: cfExtension(language),
      runtime,
      memory,
    };

    await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "PUSH_SOLUTION", payload }, (res) => {
        if (!chrome.runtime.lastError) cfToast(res);
        resolve();
      });
    });
  }
}

function cfToast(res) {
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

scanCodeforces();
// Codeforces refreshes verdicts in place while judging.
const cfObserver = new MutationObserver(() => {
  clearTimeout(window.__ggdCfTimer);
  window.__ggdCfTimer = setTimeout(scanCodeforces, 1500);
});
const cfTable = document.querySelector("table.status-frame-datatable");
if (cfTable) cfObserver.observe(cfTable, { subtree: true, childList: true });
