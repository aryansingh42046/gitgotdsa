const $ = (id) => document.getElementById(id);

const API = "https://api.github.com";
const GITHUB = "https://github.com";
const GITHUB_CLIENT_ID = "Ov23liKs63XCAoeIZsjI";

function setStatus(el, msg, ok) {
  el.textContent = msg;
  el.className = "status " + (ok ? "ok" : "err");
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function requestGithubDeviceCode() {
  const deviceRes = await fetch(`${GITHUB}/login/device/code`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ client_id: GITHUB_CLIENT_ID, scope: "repo" }).toString(),
  });
  const device = await deviceRes.json();
  if (!deviceRes.ok) {
    throw new Error(device.error_description || device.error || "GitHub login failed");
  }
  return device;
}

async function pollGithubAccessToken(device) {
  const interval = Math.max(1, Number(device.interval) || 5) * 1000;
  const startedAt = Date.now();
  const expiresIn = Math.max(60, Number(device.expires_in) || 900) * 1000;

  while (Date.now() - startedAt < expiresIn) {
    await sleep(interval);

    const tokenRes = await fetch(`${GITHUB}/login/oauth/access_token`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: GITHUB_CLIENT_ID,
        device_code: device.device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }).toString(),
    });
    const tokenBody = await tokenRes.json();

    if (tokenBody.access_token) {
      return tokenBody.access_token;
    }

    if (tokenBody.error === "authorization_pending") continue;
    if (tokenBody.error === "slow_down") continue;
    if (tokenBody.error === "expired_token") {
      throw new Error("GitHub login expired. Try again.");
    }
    if (tokenBody.error) {
      throw new Error(tokenBody.error_description || tokenBody.error);
    }
  }

  throw new Error("GitHub login timed out. Try again.");
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
    "pendingAuth",
  ]);

  if (cfg.token) {
    if (cfg.repos && cfg.repos.length) {
      fillRepos(cfg.repos, cfg.owner && cfg.repo ? `${cfg.owner}/${cfg.repo}` : null);
    }
    setStatus($("tokenStatus"), "Account linked", true);
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

$("connect").addEventListener("click", async () => {
  const button = $("connect");
  button.disabled = true;
  setStatus($("tokenStatus"), "Starting GitHub authorization...", true);

  try {
    const device = await requestGithubDeviceCode();
    const verificationUri = device.verification_uri_complete || device.verification_uri;
    await chrome.storage.local.set({
      pendingAuth: {
        user_code: device.user_code,
        verification_uri: device.verification_uri,
        verification_uri_complete: verificationUri,
      },
    });
    showAuthCode(device);

    if (verificationUri) {
      chrome.tabs.create({ url: verificationUri });
    }

    setStatus(
      $("tokenStatus"),
      `Open GitHub and enter code ${device.user_code}. Waiting for authorization...`,
      true,
    );

    const token = await pollGithubAccessToken(device);
    const [user, repos] = await Promise.all([
      gh("/user", token),
      gh("/user/repos?per_page=100&sort=updated&affiliation=owner", token),
    ]);

    const repoNames = repos.map((repo) => repo.full_name);
    await chrome.storage.local.set({ token, repos: repoNames, pendingAuth: null });
    fillRepos(repoNames);
    showAuthCode(null);
    setStatus($("tokenStatus"), `Linked as ${user.login}`, true);
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
