const $ = (id) => document.getElementById(id);

function setStatus(el, msg, ok) {
  el.textContent = msg;
  el.className = "status " + (ok ? "ok" : "err");
}

function fillRepos(list, selected) {
  $("repo").innerHTML = list
    .map((r) => `<option value="${r}">${r}</option>`)
    .join("");
  if (selected) $("repo").value = selected;
  $("repoCard").hidden = false;
}

async function init() {
  const cfg = await chrome.storage.local.get([
    "token",
    "owner",
    "repo",
    "folderMode",
    "repos",
    "history",
    "solved",
  ]);

  if (cfg.token) {
    if (cfg.repos && cfg.repos.length) {
      fillRepos(cfg.repos, cfg.owner && cfg.repo ? `${cfg.owner}/${cfg.repo}` : null);
    }
    setStatus($("tokenStatus"), "Account linked", true);
  }
  if (cfg.folderMode) $("folderMode").value = cfg.folderMode;

  const history = cfg.history || [];
  $("history").innerHTML = history
    .slice(0, 8)
    .map(
      (h) =>
        `<li><span>${h.title}</span><span class="muted">${h.platform ? h.platform + " · " : ""}${h.language}</span></li>`,
    )
    .join("");
}

$("connect").addEventListener("click", () => {
  setStatus($("tokenStatus"), "Waiting for GitHub authorization…", true);
  chrome.runtime.sendMessage({ type: "CONNECT_GITHUB" }, async (res) => {
    if (!res || !res.ok) {
      return setStatus($("tokenStatus"), (res && res.error) || "Failed", false);
    }
    await chrome.storage.local.set({ token: res.token, repos: res.repos });
    fillRepos(res.repos);
    if (res.verificationUri) {
      chrome.tabs.create({ url: res.verificationUri });
    }
    setStatus(
      $("tokenStatus"),
      `Open ${res.verificationUri || "GitHub"} and enter code ${res.userCode}. Linked as ${res.login}`,
      true,
    );
  });
});

$("create").addEventListener("click", async () => {
  const name = $("newRepo").value.trim();
  const { token } = await chrome.storage.local.get("token");
  if (!name || !token) return setStatus($("saveStatus"), "Connect GitHub first", false);
  setStatus($("saveStatus"), "Creating…", true);
  chrome.runtime.sendMessage({ type: "CREATE_REPO", token, name }, async (res) => {
    if (!res || !res.ok) {
      return setStatus($("saveStatus"), (res && res.error) || "Failed", false);
    }
    const { repos = [] } = await chrome.storage.local.get("repos");
    const next = [res.fullName, ...repos];
    await chrome.storage.local.set({ repos: next });
    fillRepos(next, res.fullName);
    setStatus($("saveStatus"), `Created ${res.fullName}`, true);
  });
});

$("save").addEventListener("click", async () => {
  const full = $("repo").value;
  if (!full) return setStatus($("saveStatus"), "Pick a repository", false);
  const [owner, repo] = full.split("/");
  await chrome.storage.local.set({
    owner,
    repo,
    folderMode: $("folderMode").value,
    pushReadme: true,
  });
  setStatus($("saveStatus"), `Syncing to ${full}`, true);
});

init();
