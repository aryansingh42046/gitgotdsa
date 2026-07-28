// Runs in the page's MAIN world so it can observe LeetCode's own network calls.
// When a submission check comes back "Accepted", it notifies the content script.
(function () {
  const CHECK_RE = /\/submissions\/detail\/(\d+)\/check\/?/;

  function report(payload) {
    window.dispatchEvent(
      new CustomEvent("gitgotdsa:accepted", { detail: payload }),
    );
  }

  function handle(url, bodyText) {
    if (!url || !CHECK_RE.test(url)) return;
    let data;
    try {
      data = JSON.parse(bodyText);
    } catch {
      return;
    }
    if (!data || data.state !== "SUCCESS") return;
    if (data.status_msg !== "Accepted") return;
    report({
      submissionId: (url.match(CHECK_RE) || [])[1],
      lang: data.pretty_lang || data.lang,
      langSlug: data.lang,
      code: data.code_output === undefined ? undefined : undefined,
      runtime: data.status_runtime,
      memory: data.status_memory,
      runtimePercentile: data.runtime_percentile,
      memoryPercentile: data.memory_percentile,
      questionId: data.question_id,
      finishedAt: Date.now(),
    });
  }

  // Patch fetch
  const nativeFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await nativeFetch.apply(this, args);
    try {
      const url =
        typeof args[0] === "string" ? args[0] : args[0] && args[0].url;
      if (url && CHECK_RE.test(url)) {
        res
          .clone()
          .text()
          .then((t) => handle(url, t))
          .catch(() => {});
      }
    } catch {
      /* noop */
    }
    return res;
  };

  // Patch XMLHttpRequest
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__ggd_url = url;
    return open.call(this, method, url, ...rest);
  };
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", () => {
      try {
        handle(this.__ggd_url, this.responseText);
      } catch {
        /* noop */
      }
    });
    return send.apply(this, args);
  };
})();
