const $ = (id) => document.getElementById(id);

const API = "https://api.github.com";
const GITHUB = "https://github.com";

function setStatus(el, msg, ok) {
  el.textContent = msg;
  el.className = "status " + (ok ? "ok" : "err");
}

function setConnectedUi(login) {
  const button = $("connect");
  button.textContent = "Reconnect GitHub";
  button.disabled = false;
  setStatus(
    $("tokenStatus"),
    login ? `Connected as ${login}` : "Account linked",
    true,
  );
}

function showAuthCode(device) {
  if (!device || !device.user_code) {
    $("authCard").hidden = true;
    return;
  }

  $("authCode").textContent = device.user_code;
  $("authLink").textContent = device.verification_uri_complete || device.verification_uri || "";
  $("authCard").hidden = false;
}

async function gh(path, token) {
  const res = await fetch(`${API}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    throw new Error((body && body.message) || `GitHub error ${res.status}`);
  }
  return body;
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
    "login",
    "avatar",
    "owner",
    "repo",
    "folderMode",
    "repos",
    "history",
    "solved",
    "pendingAuth",
  ]);

  if (cfg.token) {
    let login = cfg.login;
    if (!login) {
      try {
        const user = await gh("/user", cfg.token);
        login = user.login;
        await chrome.storage.local.set({ login, avatar: user.avatar_url });
      } catch {
        login = null;
      }
    }

    if (cfg.repos && cfg.repos.length) {
      fillRepos(cfg.repos, cfg.owner && cfg.repo ? `${cfg.owner}/${cfg.repo}` : null);
    }
    setConnectedUi(login);
  }
  if (cfg.folderMode) $("folderMode").value = cfg.folderMode;

  if (cfg.pendingAuth && !cfg.token) {
    showAuthCode(cfg.pendingAuth);
    setStatus($("tokenStatus"), "Waiting for GitHub authorization...", true);
  } else {
    showAuthCode(null);
  }

  const history = cfg.history || [];
  $("history").innerHTML = history
    .slice(0, 8)
    .map(
      (h) =>
        `<li><span>${h.title}</span><span class="muted">${h.platform ? h.platform + " · " : ""}${h.language}</span></li>`,
    )
    .join("");
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;

  if (changes.pendingAuth) {
    const pending = changes.pendingAuth.newValue;
    if (pending) {
      showAuthCode(pending);
      setStatus($("tokenStatus"), "Waiting for GitHub authorization...", true);
    } else {
      showAuthCode(null);
    }
  }

  if (changes.token || changes.login) {
    const nextLogin = changes.login && changes.login.newValue ? changes.login.newValue : null;
    if (changes.token && changes.token.newValue) {
      setConnectedUi(nextLogin || null);
      $("connect").disabled = false;
    }
  }

  if (changes.repos && Array.isArray(changes.repos.newValue)) {
    fillRepos(changes.repos.newValue);
  }
});

$("connect").addEventListener("click", async () => {
  const button = $("connect");
  button.disabled = true;
  setStatus($("tokenStatus"), "Starting GitHub authorization...", true);

  try {
    chrome.runtime.sendMessage({ type: "CONNECT_GITHUB" }, async (res) => {
      if (chrome.runtime.lastError) {
        button.disabled = false;
        return setStatus($("tokenStatus"), chrome.runtime.lastError.message, false);
      }

      if (!res || !res.ok) {
        button.disabled = false;
        return setStatus($("tokenStatus"), (res && res.error) || "Failed", false);
      }

      await chrome.storage.local.set({
        token: res.token,
        login: res.login,
        avatar: res.avatar,
        pendingAuth: null,
      });
      showAuthCode(null);
      setConnectedUi(res.login);
      gh("/user/repos?per_page=100&sort=updated&affiliation=owner", res.token)
        .then(async (repos) => {
          const repoNames = repos.map((repo) => repo.full_name);
          await chrome.storage.local.set({ repos: repoNames });
          fillRepos(repoNames);
        })
        .catch(() => {
          // Repository loading is best effort; connection state is already saved.
        });
      button.disabled = false;
    });
  } catch (err) {
    setStatus($("tokenStatus"), err.message || "Failed", false);
  } finally {
    button.disabled = false;
  }
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
