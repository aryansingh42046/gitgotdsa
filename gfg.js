// MAIN world hook for GeeksforGeeks practice problems.
// Captures the submitted code and waits for a "Correct" verdict.
(function () {
  let lastSubmission = null;

  function stash(bodyText) {
    if (!bodyText) return;
    try {
      const body =
        typeof bodyText === "string" ? JSON.parse(bodyText) : bodyText;
      if (body && (body.code || body.source)) {
        lastSubmission = {
          code: body.code || body.source,
          language: body.language || body.lang || "cpp",
        };
      }
    } catch {
      /* form encoded or unknown */
      if (typeof bodyText === "string" && bodyText.includes("code=")) {
        const params = new URLSearchParams(bodyText);
        if (params.get("code")) {
          lastSubmission = {
            code: params.get("code"),
            language: params.get("language") || "cpp",
          };
        }
      }
    }
  }

  function isResult(text) {
    if (!text || text.length > 200000) return false;
    try {
      const data = JSON.parse(text);
      const status = String(
        data.status || data.result || data.verdict || "",
      ).toLowerCase();
      const solved =
        status.includes("correct") ||
        status.includes("accept") ||
        data.correct === true;
      if (!solved) return false;
      return {
        runtime: data.time || data.executionTime,
        memory: data.memory || data.memoryUsed,
      };
    } catch {
      return false;
    }
  }

  function report(extra) {
    if (!lastSubmission) return;
    window.dispatchEvent(
      new CustomEvent("gitgotdsa:gfg-accepted", {
        detail: { ...lastSubmission, ...(extra || {}) },
      }),
    );
    lastSubmission = null;
  }

  const nativeFetch = window.fetch;
  window.fetch = async function (...args) {
    try {
      const init = args[1] || {};
      if (init.body) stash(init.body);
    } catch {
      /* noop */
    }
    const res = await nativeFetch.apply(this, args);
    try {
      res
        .clone()
        .text()
        .then((t) => {
          const hit = isResult(t);
          if (hit) report(hit);
        })
        .catch(() => {});
    } catch {
      /* noop */
    }
    return res;
  };

  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (body) {
    if (body) stash(body);
    this.addEventListener("load", () => {
      try {
        const hit = isResult(this.responseText);
        if (hit) report(hit);
      } catch {
        /* noop */
      }
    });
    return send.apply(this, arguments);
  };
})();
