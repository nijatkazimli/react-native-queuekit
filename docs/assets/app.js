(() => {
  const PAGES = [
    { group: "Start", href: "index.html", title: "Overview" },
    { group: "Start", href: "getting-started.html", title: "Getting started" },
    { group: "Guide", href: "jobs.html", title: "Jobs and handlers" },
    { group: "Guide", href: "reliability.html", title: "Reliability and scheduling" },
    { group: "Guide", href: "control.html", title: "Control and observe" },
    { group: "Guide", href: "react.html", title: "React hooks" },
    { group: "Guide", href: "background.html", title: "Background and native tasks" },
    { group: "Guide", href: "storage.html", title: "Storage, network and testing" },
    { group: "Cookbook", href: "recipes-app.html", title: "App flows" },
    { group: "Cookbook", href: "recipes-network.html", title: "APIs and networking" },
    { group: "Cookbook", href: "recipes-media.html", title: "Media and files" },
    { group: "Reference", href: "reference.html", title: "API reference" },
    { group: "Reference", href: "faq.html", title: "FAQ and gotchas" },
  ];

  const current = location.pathname.split("/").pop() || "index.html";
  const page = PAGES.find((p) => p.href === current) ?? PAGES[0];

  const el = (tag, props = {}, html = "") => {
    const node = document.createElement(tag);
    Object.assign(node, props);
    if (html) node.innerHTML = html;
    return node;
  };
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const slug = (s) =>
    s
      .toLowerCase()
      .replace(/<[^>]+>/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

  /* ---------- Syntax highlighting ---------- */
  const KW =
    "import|export|from|const|let|var|function|return|if|else|for|of|in|while|await|async|new|class|extends|static|type|interface|throw|try|catch|finally|default|as|typeof|instanceof|void|null|undefined|true|false|this|yield|readonly|implements|declare|enum|break|continue|switch|case|satisfies|keyof";
  const STRING = /("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)/;
  const join = (parts) => new RegExp(parts.map((p) => p.source).join("|"), "g");
  const LANGS = {
    ts: {
      re: join([
        /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)/,
        STRING,
        /(@[A-Za-z_$][\w.$]*)/,
        /\b(\d[\d_]*(?:\.\d+)?)\b/,
        new RegExp(`\\b(${KW})\\b`),
        /\b([A-Z][A-Za-z0-9_]*)\b/,
        /\b([a-z_$][\w$]*)(?=\()/,
      ]),
      cls: ["c", "s", "d", "n", "k", "t", "f"],
    },
    sh: {
      re: join([/(#[^\n]*)/, STRING, /\B(--?[A-Za-z][\w-]*)/]),
      cls: ["c", "s", "g"],
    },
    json: {
      re: join([STRING, /\b(-?\d+(?:\.\d+)?)\b/, /\b(true|false|null)\b/]),
      cls: ["s", "n", "k"],
    },
    yaml: {
      re: join([/(#[^\n]*)/, STRING, /\b([\w-]+)(?=:(?:\s|$))/, /\b(true|false|null)\b/]),
      cls: ["c", "s", "t", "k"],
    },
  };
  LANGS.tsx = LANGS.js = LANGS.jsx = LANGS.ts;
  LANGS.bash = LANGS.shell = LANGS.sh;
  LANGS.yml = LANGS.yaml;

  function highlight(code, lang) {
    const spec = LANGS[lang];
    if (!spec) return esc(code);
    let out = "";
    let last = 0;
    let m;
    spec.re.lastIndex = 0;
    while ((m = spec.re.exec(code))) {
      out += esc(code.slice(last, m.index));
      const group = m.slice(1).findIndex((g) => g !== undefined);
      out += `<span class="tok-${spec.cls[group]}">${esc(m[0])}</span>`;
      last = m.index + m[0].length;
      if (m[0].length === 0) spec.re.lastIndex++;
    }
    return out + esc(code.slice(last));
  }

  function enhanceCode() {
    // Raw <script type="text/x-code"> blocks avoid HTML-escaping generics and JSX.
    for (const source of document.querySelectorAll('script[type="text/x-code"]')) {
      const pre = el("pre");
      if (source.dataset.title) pre.dataset.title = source.dataset.title;
      const code = el("code", { className: `language-${source.dataset.lang || "ts"}` });
      code.textContent = source.textContent;
      pre.append(code);
      source.replaceWith(pre);
    }
    for (const code of document.querySelectorAll("pre > code")) {
      const lang = (code.className.match(/language-(\w+)/) || [])[1];
      const raw = code.textContent.replace(/^\n/, "").replace(/\s+$/, "");
      code.innerHTML = highlight(raw, lang);
      const pre = code.parentElement;
      const button = el("button", { className: "copy", type: "button", textContent: "Copy" });
      button.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(raw);
          button.textContent = "Copied";
        } catch {
          button.textContent = "Press Ctrl+C";
        }
        setTimeout(() => {
          button.textContent = "Copy";
        }, 1400);
      });
      pre.append(button);
    }
  }

  /* ---------- Chrome: header, sidebar, toc ---------- */
  function buildChrome() {
    const article = document.querySelector("article");
    const theme = () => document.documentElement.dataset.theme;

    const header = el(
      "header",
      { className: "topbar" },
      `<button class="icon-btn menu-btn" aria-label="Menu" data-act="menu">&#9776;</button>
       <a class="brand" href="index.html"><img class="brand-logo" src="assets/favicon.svg" alt="" width="28" height="28" />QueueKit<small id="qk-version" hidden></small></a>
       <span class="spacer"></span>
       <button class="search-btn" data-act="search"><span>Search docs</span><kbd>/</kbd></button>
       <button class="icon-btn" data-act="theme" aria-label="Toggle theme">${theme() === "dark" ? "Light" : "Dark"}</button>`,
    );
    document.body.prepend(header);
    // Written by scripts/sync-docs-version.mjs on every release; hidden when missing (for example in a local preview).
    fetch("assets/version.json")
      .then((r) => r.json())
      .then(({ version }) => {
        const badge = document.getElementById("qk-version");
        badge.textContent = `v${version}`;
        badge.hidden = false;
      })
      .catch(() => {});

    const sidebar = el("nav", { className: "sidebar", ariaLabel: "Documentation" });
    let group = "";
    for (const p of PAGES) {
      if (p.group !== group) {
        group = p.group;
        sidebar.append(el("h4", { textContent: group }));
      }
      sidebar.append(
        el("a", { href: p.href, textContent: p.title, className: p === page ? "active" : "" }),
      );
    }

    const headings = [...article.querySelectorAll("h2, h3")];
    const used = new Set();
    const labels = new Map();
    for (const h of headings) {
      const label = h.textContent.trim();
      labels.set(h, label);
      let id = h.id || slug(label);
      while (used.has(id)) id += "-2";
      used.add(id);
      h.id = id;
      h.append(el("a", { className: "anchor", href: `#${id}`, textContent: "#" }));
    }
    const toc = el("aside", { className: "toc" }, "<h4>On this page</h4>");
    for (const h of headings) {
      toc.append(
        el("a", {
          href: `#${h.id}`,
          className: h.tagName.toLowerCase(),
          textContent: labels.get(h),
        }),
      );
    }

    const layout = el("div", { className: "layout" });
    article.replaceWith(layout);
    layout.append(sidebar, article, toc);

    const i = PAGES.indexOf(page);
    const pager = el("div", { className: "pager" });
    if (PAGES[i - 1]) {
      pager.append(
        el(
          "a",
          { href: PAGES[i - 1].href, className: "prev" },
          `<small>Previous</small>${PAGES[i - 1].title}`,
        ),
      );
    }
    if (PAGES[i + 1]) {
      pager.append(
        el(
          "a",
          { href: PAGES[i + 1].href, className: "next" },
          `<small>Next</small>${PAGES[i + 1].title}`,
        ),
      );
    }
    article.append(pager);

    header.addEventListener("click", (event) => {
      const act = event.target.closest("[data-act]")?.dataset.act;
      if (act === "menu") sidebar.classList.toggle("open");
      if (act === "search") openSearch();
      if (act === "theme") {
        const next = theme() === "dark" ? "light" : "dark";
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem("qk-theme", next);
        } catch {}
        event.target.closest("[data-act]").textContent = next === "dark" ? "Light" : "Dark";
      }
    });
    sidebar.addEventListener("click", (event) => {
      if (event.target.closest("a")) sidebar.classList.remove("open");
    });

    const links = [...toc.querySelectorAll("a")];
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          for (const link of links) {
            link.classList.toggle("active", link.getAttribute("href") === `#${entry.target.id}`);
          }
        }
      },
      { rootMargin: "-80px 0px -70% 0px" },
    );
    for (const h of headings) observer.observe(h);
  }

  /* ---------- Tabs ---------- */
  function initTabs() {
    for (const tabs of document.querySelectorAll(".tabs")) {
      const buttons = [...tabs.querySelectorAll(".tab-list button")];
      const panels = [...tabs.querySelectorAll(".panel")];
      const select = (n) => {
        buttons.forEach((b, i) => b.classList.toggle("active", i === n));
        panels.forEach((p, i) => p.classList.toggle("active", i === n));
      };
      buttons.forEach((b, i) => b.addEventListener("click", () => select(i)));
      select(0);
    }
  }

  /* ---------- Backoff calculator ---------- */
  function fmt(ms) {
    if (ms < 1000) return `${Math.round(ms)} ms`;
    const s = ms / 1000;
    if (s < 60) return `${+s.toFixed(1)} s`;
    const m = Math.floor(s / 60);
    return `${m} min ${Math.round(s - m * 60)} s`;
  }
  function initBackoff() {
    const root = document.querySelector("[data-backoff]");
    if (!root) return;
    root.className = "calc";
    root.innerHTML = `
      <div class="calc-controls">
        <label>baseDelayMs<input type="number" data-k="base" value="1000" min="1" /></label>
        <label>maxDelayMs<input type="number" data-k="max" value="60000" min="1" /></label>
        <label>maxAttempts<input type="number" data-k="attempts" value="8" min="1" max="30" /></label>
        <label class="check"><input type="checkbox" data-k="jitter" checked /> jitter</label>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>After failure</th><th>Waits before next attempt</th><th>Total waited so far</th></tr></thead>
        <tbody></tbody>
      </table></div>`;
    const body = root.querySelector("tbody");
    const read = (k) => root.querySelector(`[data-k=${k}]`);
    const render = () => {
      const base = +read("base").value || 1;
      const max = +read("max").value || 1;
      const attempts = Math.min(30, Math.max(1, +read("attempts").value || 1));
      const jitter = read("jitter").checked;
      let lo = 0;
      let hi = 0;
      const rows = [];
      for (let n = 1; n < attempts; n++) {
        const exp = Math.min(max, base * 2 ** (n - 1));
        const a = jitter ? exp / 2 : exp;
        lo += a;
        hi += exp;
        rows.push(
          `<tr><td>#${n}</td><td>${jitter ? `${fmt(a)} to ${fmt(exp)}` : fmt(exp)}</td><td>${
            jitter ? `${fmt(lo)} to ${fmt(hi)}` : fmt(hi)
          }</td></tr>`,
        );
      }
      rows.push(`<tr><td>#${attempts}</td><td colspan="2">Job becomes <code>failed</code></td></tr>`);
      body.innerHTML = rows.join("");
    };
    root.addEventListener("input", render);
    render();
  }

  /* ---------- Search ---------- */
  let modal;
  let index = null;
  let selected = 0;

  function addDoc(p, article) {
    if (!article) return;
    let heading = { text: p.title, id: "" };
    let buffer = [];
    const flush = () => {
      if (buffer.length) index.push({ page: p, heading: heading.text, id: heading.id, text: buffer.join(" ") });
      buffer = [];
    };
    for (const node of article.children) {
      if (/^H[1-3]$/.test(node.tagName)) {
        flush();
        const text = node.textContent.replace(/#$/, "").trim();
        heading = { text, id: node.id || slug(text) };
      } else if (!node.classList.contains("pager")) {
        buffer.push(node.textContent.replace(/\s+/g, " "));
      }
    }
    flush();
  }

  async function buildIndex() {
    if (index) return;
    index = [];
    await Promise.all(
      PAGES.map(async (p) => {
        try {
          const html = await (await fetch(p.href)).text();
          addDoc(p, new DOMParser().parseFromString(html, "text/html").querySelector("article"));
        } catch {
          if (p === page) addDoc(p, document.querySelector("article"));
        }
      }),
    );
    if (!index.length) {
      index = PAGES.map((p) => ({ page: p, heading: p.title, id: "", text: p.group }));
    }
  }

  function runSearch(query) {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const scored = [];
    for (const entry of index) {
      const h = entry.heading.toLowerCase();
      const t = entry.text.toLowerCase();
      const pt = entry.page.title.toLowerCase();
      let score = 0;
      let ok = true;
      for (const w of terms) {
        const inHeading = h.includes(w);
        const inText = t.includes(w);
        if (!inHeading && !inText && !pt.includes(w)) {
          ok = false;
          break;
        }
        score += (inHeading ? 5 : 0) + (inText ? 1 : 0) + (pt.includes(w) ? 2 : 0);
      }
      if (ok) scored.push({ entry, score });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, 12);
  }

  function snippet(text, terms) {
    const lower = text.toLowerCase();
    const at = Math.max(0, Math.min(...terms.map((w) => lower.indexOf(w)).filter((n) => n >= 0)));
    let out = esc(text.slice(Math.max(0, at - 50), at + 110));
    for (const w of terms) {
      out = out.replace(new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig"), "<mark>$1</mark>");
    }
    return out;
  }

  function renderResults() {
    const input = modal.querySelector("input");
    const box = modal.querySelector(".results");
    const terms = input.value.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = runSearch(input.value);
    selected = 0;
    if (!terms.length) {
      box.innerHTML = '<div class="empty">Type to search every page.</div>';
      return;
    }
    if (!hits.length) {
      box.innerHTML = '<div class="empty">No results.</div>';
      return;
    }
    box.innerHTML = hits
      .map(
        ({ entry }, i) =>
          `<a class="${i === 0 ? "sel" : ""}" href="${entry.page.href}${entry.id ? `#${entry.id}` : ""}">
            ${esc(entry.heading)}<small>${esc(entry.page.title)} &middot; ${snippet(entry.text, terms)}</small></a>`,
      )
      .join("");
  }

  function openSearch() {
    if (!modal) {
      modal = el(
        "div",
        { className: "search-modal" },
        `<div class="search-box"><input type="search" placeholder="Search the docs..." aria-label="Search" /><div class="results"></div></div>`,
      );
      document.body.append(modal);
      modal.addEventListener("mousedown", (event) => {
        if (event.target === modal) closeSearch();
      });
      const input = modal.querySelector("input");
      input.addEventListener("input", renderResults);
      input.addEventListener("keydown", (event) => {
        const items = [...modal.querySelectorAll(".results a")];
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          if (!items.length) return;
          selected = (selected + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
          items.forEach((a, i) => a.classList.toggle("sel", i === selected));
          items[selected].scrollIntoView({ block: "nearest" });
        }
        if (event.key === "Enter" && items[selected]) items[selected].click();
      });
      modal.addEventListener("click", (event) => {
        if (event.target.closest("a")) closeSearch();
      });
    }
    modal.classList.add("open");
    const input = modal.querySelector("input");
    input.value = "";
    input.focus();
    modal.querySelector(".results").innerHTML = '<div class="empty">Loading...</div>';
    buildIndex().then(renderResults);
  }
  function closeSearch() {
    modal?.classList.remove("open");
  }

  document.addEventListener("keydown", (event) => {
    const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName ?? "");
    if (event.key === "Escape") closeSearch();
    if ((event.key === "/" && !typing) || (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey))) {
      event.preventDefault();
      openSearch();
    }
  });

  document.title = `${page.title} - QueueKit`;
  enhanceCode();
  initTabs();
  initBackoff();
  buildChrome();
})();
