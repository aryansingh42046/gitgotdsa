// Service worker: talks to the GitHub REST API and keeps local stats.

const API = "https://api.github.com";
const GITHUB = "https://github.com";
const GITHUB_CLIENT_ID = "Ov23liKs63XCAoeIZsjI";

async function getConfig() {
  return chrome.storage.local.get([
    "token",
    "owner",
    "repo",
    "folderMode",
    "pushReadme",
  ]);
}

async function gh(path, token, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
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
    const message = (body && body.message) || `GitHub error ${res.status}`;
    throw new Error(message);
  }
  return body;
}

function b64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

async function upsertFile({ token, owner, repo, path, content, message }) {
  let sha;
  try {
    const existing = await gh(
      `/repos/${owner}/${repo}/contents/${encodeURI(path)}`,
      token,
    );
    sha = existing && existing.sha;
  } catch {
    sha = undefined;
  }
  return gh(`/repos/${owner}/${repo}/contents/${encodeURI(path)}`, token, {
    method: "PUT",
    body: JSON.stringify({ message, content: b64(content), sha }),
  });
}

async function githubDeviceLogin() {
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

  await chrome.storage.local.set({
    pendingAuth: {
      user_code: device.user_code,
      verification_uri: device.verification_uri,
      verification_uri_complete: device.verification_uri_complete,
    },
  });

  await chrome.tabs.create({
    url: device.verification_uri_complete || device.verification_uri,
  });

  const interval = Math.max(1, Number(device.interval) || 5) * 1000;
  const startedAt = Date.now();
  const expiresIn = Math.max(60, Number(device.expires_in) || 900) * 1000;

  while (Date.now() - startedAt < expiresIn) {
    await new Promise((resolve) => setTimeout(resolve, interval));

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
      const user = await gh("/user", tokenBody.access_token);
      return {
        ok: true,
        token: tokenBody.access_token,
        login: user.login,
        avatar: user.avatar_url,
        userCode: device.user_code,
        verificationUri: device.verification_uri_complete || device.verification_uri,
      };
    }

    if (tokenBody.error === "authorization_pending") continue;
    if (tokenBody.error === "slow_down") {
      continue;
    }
    if (tokenBody.error === "expired_token") {
      throw new Error("GitHub login expired. Try again.");
    }
    if (tokenBody.error) {
      throw new Error(tokenBody.error_description || tokenBody.error);
    }
  }

  throw new Error("GitHub login timed out. Try again.");
}

function pad(id) {
  return String(id).padStart(4, "0");
}

const PLATFORM_LABEL = {
  leetcode: "LeetCode",
  geeksforgeeks: "GeeksforGeeks",
  codeforces: "Codeforces",
};

function buildReadme(p) {
  const label = PLATFORM_LABEL[p.platform || "leetcode"];
  return [
    `# ${p.frontendId ? `${p.frontendId}. ` : ""}${p.title}`,
    "",
    `**Platform:** ${label}`,
    `**Difficulty:** ${p.difficulty}`,
    p.tags && p.tags.length ? `**Topics:** ${p.tags.join(", ")}` : null,
    `**Link:** ${p.url}`,
    "",
    "## Problem",
    "",
    p.description,
    "",
    "## Result",
    "",
    `- Language: ${p.language}`,
    p.runtime ? `- Runtime: ${p.runtime}` : null,
    p.memory ? `- Memory: ${p.memory}` : null,
    "",
    "> Synced automatically by GitGotDSA",
  ]
    .filter(Boolean)
    .join("\n");
}


async function pushSolution(payload) {
  const cfg = await getConfig();
  if (!cfg.token || !cfg.owner || !cfg.repo) {
    throw new Error("Link a GitHub repo in the extension popup first");
  }

  const platform = payload.platform || "leetcode";
  const label = PLATFORM_LABEL[platform] || platform;
  const idPart = payload.frontendId ? `${pad(payload.frontendId)}-` : "";
  const folder = `${idPart}${payload.slug}`;
  const dir =
    cfg.folderMode === "difficulty"
      ? `${label}/${payload.difficulty}/${folder}`
      : `${label}/${folder}`;

  const stamp = `${payload.runtime || ""} ${payload.memory || ""}`.trim();
  const message = `[${label}] ${payload.frontendId ? `${payload.frontendId}. ` : ""}${
    payload.title
  } — ${payload.language}${stamp ? ` (${stamp})` : ""}`;

  await upsertFile({
    token: cfg.token,
    owner: cfg.owner,
    repo: cfg.repo,
    path: `${dir}/${payload.slug}.${payload.extension}`,
    content: payload.code.endsWith("\n") ? payload.code : payload.code + "\n",
    message,
  });

  if (cfg.pushReadme !== false) {
    await upsertFile({
      token: cfg.token,
      owner: cfg.owner,
      repo: cfg.repo,
      path: `${dir}/README.md`,
      content: buildReadme(payload),
      message: `${message} — problem statement`,
    });
  }

  const { solved = {}, history = [] } = await chrome.storage.local.get([
    "solved",
    "history",
  ]);
  const key = payload.solvedKey || `${platform}:${payload.slug}`;
  const entry = {
    title: payload.title,
    platform: label,
    difficulty: payload.difficulty,
    language: payload.language,
    at: Date.now(),
  };
  solved[key] = entry;
  history.unshift({ slug: payload.slug, ...entry });

  await chrome.storage.local.set({ solved, history: history.slice(0, 50) });

  return { ok: true, repo: `${cfg.owner}/${cfg.repo}` };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "PUSH_SOLUTION") {
    pushSolution(msg.payload)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg && msg.type === "VERIFY_TOKEN") {
    (async () => {
      try {
        const user = await gh("/user", msg.token);
        const repos = await gh(
          "/user/repos?per_page=100&sort=updated&affiliation=owner",
          msg.token,
        );
        sendResponse({
          ok: true,
          login: user.login,
          avatar: user.avatar_url,
          repos: repos.map((r) => r.full_name),
        });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  if (msg && msg.type === "CONNECT_GITHUB") {
    (async () => {
      try {
        const res = await githubDeviceLogin();
        await chrome.storage.local.set({
          token: res.token,
          login: res.login,
          avatar: res.avatar,
          repos: res.repos,
          pendingAuth: null,
        });
        sendResponse({
          ok: true,
          login: res.login,
          avatar: res.avatar,
          repos: res.repos,
          token: res.token,
        });
      } catch (err) {
        await chrome.storage.local.set({ pendingAuth: null });
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  if (msg && msg.type === "CREATE_REPO") {
    (async () => {
      try {
        const repo = await gh("/user/repos", msg.token, {
          method: "POST",
          body: JSON.stringify({
            name: msg.name,
            description: "My LeetCode solutions, synced by GitGotDSA",
            private: !!msg.private,
            auto_init: true,
          }),
        });
        sendResponse({ ok: true, fullName: repo.full_name });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  return false;
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("options.html") });
  }
});
