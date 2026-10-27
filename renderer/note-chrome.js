"use strict";

(function () {
  function svg(path) {
    return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
  }

  const icons = {
    collapse: svg('<rect x="4" y="4.5" width="16" height="15" rx="2"></rect><path d="M9 4.5v15"></path>'),
    newer: svg('<path d="M12 20h8"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5z"></path>'),
    search: svg('<circle cx="11" cy="11" r="6.25"></circle><path d="M16 16.5 20 20.5"></path>'),
    bullet: svg('<path d="M9 7h11M9 12h11M9 17h11"></path><circle cx="4.5" cy="7" r="1" fill="currentColor" stroke="none"></circle><circle cx="4.5" cy="12" r="1" fill="currentColor" stroke="none"></circle><circle cx="4.5" cy="17" r="1" fill="currentColor" stroke="none"></circle>'),
    number: svg('<path d="M10 7h10M10 12h10M10 17h10"></path><path d="M4 8.2V5.2l-1.2.6M3 12h2.2M3.1 16.2c.3 1.2 1.6 1.6 2.4.6"></path>'),
    check: svg('<path d="M10 7h10M10 12h10M10 17h10"></path><rect x="3" y="5.2" width="3.2" height="3.2" rx="0.6"></rect><path d="M3.6 11.2 4.7 12.4 6.6 10.2"></path><rect x="3" y="15.2" width="3.2" height="3.2" rx="0.6"></rect>'),
    quote: svg('<path d="M8 7.5c-2.4.6-4 2.4-4 4.8V18h5.2v-5.2H6.2"></path><path d="M18 7.5c-2.4.6-4 2.4-4 4.8V18H19.2v-5.2H16.2"></path>'),
    link: svg('<path d="M10 13a4 4 0 0 0 6 .4l2.2-2.2a4 4 0 0 0-5.6-5.6L11.2 7"></path><path d="M14 11a4 4 0 0 0-6-.4l-2.2 2.2a4 4 0 0 0 5.6 5.6L12.8 17"></path>'),
    image: svg('<rect x="4" y="5" width="16" height="14" rx="2"></rect><circle cx="9" cy="10" r="1.3"></circle><path d="M7 16.5 11 12l3 3 2-2 3 3.5"></path>'),
  };

  function keysFor(shortcut) {
    if (shortcut === "ctrl+space") return ["Ctrl", "Space"];
    if (shortcut === "ctrl+alt") return ["Ctrl", "Alt"];
    if (shortcut === "ctrl+shift") return ["Ctrl", "Shift"];
    return ["Ctrl", "Win"];
  }

  function hintHtml(shortcut) {
    const keys = keysFor(shortcut);
    return `<div class="note-dictate-hint" aria-hidden="true"><span class="note-kbd-row"><kbd class="note-kbd">${keys[0]}</kbd><span class="note-kbd-plus">+</span><kbd class="note-kbd">${keys[1]}</kbd></span><span class="note-dictate-phrase">Dictate or write something</span><span class="note-listening">Listening...</span></div>`;
  }

  function railHtml() {
    return `<div class="note-rail-top"><button type="button" class="note-rail-btn" data-note-collapse aria-pressed="false" aria-label="Expand sidebar" title="Expand sidebar">${icons.collapse}<span class="note-rail-label">Collapse Notes</span></button><button type="button" class="note-rail-btn" data-note-new aria-label="New note" title="New note">${icons.newer}<span class="note-rail-label">New note</span></button><button type="button" class="note-rail-btn note-rail-search-btn" data-note-search aria-label="Search notes" title="Search notes">${icons.search}</button><label class="note-search">${icons.search}<input type="search" data-note-search-input placeholder="Search notes..." aria-label="Search notes" autocomplete="off" spellcheck="false"></label></div><div class="note-rail-list" data-note-list></div><div class="note-rail-bottom"><div class="sparkle-host"></div><button type="button" class="note-format-btn" data-format-toggle aria-expanded="false" aria-label="Formatting" title="Formatting"><span class="note-format-mark"><span>A</span><span>a</span></span><span class="note-rail-label">Formatting</span></button></div>`;
  }

  function formatDockHtml() {
    return `<div class="format-dock" data-format-dock inert><div class="format-bar" role="toolbar" aria-label="Formatting"><button type="button" data-format="bold" aria-label="Bold"><span class="fmt-b">B</span></button><button type="button" data-format="italic" aria-label="Italic"><span class="fmt-i">I</span></button><button type="button" data-format="underline" aria-label="Underline"><span class="fmt-u">U</span></button></div></div>`;
  }

  function toggleWrap(text, before, after) {
    const end = after == null ? before : after;
    if (text.startsWith(before) && text.endsWith(end) && text.length >= before.length + end.length) {
      return text.slice(before.length, text.length - end.length);
    }
    return before + text + end;
  }

  function lineBounds(value, start, end) {
    const from = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    let to = value.indexOf("\n", Math.max(start, end));
    if (to < 0) to = value.length;
    return { from, to };
  }

  function prefixLines(text, kind) {
    const lines = text.split("\n");
    const patterns = {
      bullet: /^[-*]\s+/,
      number: /^\d+\.\s+/,
      check: /^[-*]\s+\[(?: |x|X)\]\s+/,
      quote: /^>\s?/,
    };
    const pattern = patterns[kind];
    const allOn = lines.every((line) => !line.trim() || pattern.test(line));
    return lines.map((line, index) => {
      if (!line.trim()) return line;
      if (allOn) return line.replace(pattern, "");
      if (pattern.test(line)) return line;
      if (kind === "bullet") return `- ${line}`;
      if (kind === "number") return `${index + 1}. ${line}`;
      if (kind === "check") return `- [ ] ${line}`;
      return `> ${line}`;
    }).join("\n");
  }

  function applyFormat(textarea, kind) {
    if (!textarea) return;
    const value = String(textarea.value || "");
    let start = textarea.selectionStart || 0;
    let end = textarea.selectionEnd || 0;
    if (end < start) {
      const swap = start;
      start = end;
      end = swap;
    }
    const selected = value.slice(start, end);
    let insert = selected;
    let cursor = null;
    if (kind === "bold") insert = toggleWrap(selected, "**");
    else if (kind === "italic") insert = toggleWrap(selected, "*");
    else if (kind === "underline") insert = toggleWrap(selected, "<u>", "</u>");
    else if (kind === "code") insert = toggleWrap(selected, "`");
    else if (kind === "link") {
      const label = selected || "text";
      insert = `[${label}](https://)`;
      cursor = start + insert.length - 1;
    } else if (kind === "image") {
      insert = `![${selected}](https://)`;
      cursor = start + insert.length - 1;
    } else if (kind === "bullet" || kind === "number" || kind === "check" || kind === "quote") {
      const bounds = lineBounds(value, start, end);
      const block = prefixLines(value.slice(bounds.from, bounds.to), kind);
      const next = value.slice(0, bounds.from) + block + value.slice(bounds.to);
      textarea.value = next;
      const caret = bounds.from + block.length;
      textarea.selectionStart = textarea.selectionEnd = caret;
      textarea.focus();
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    const next = value.slice(0, start) + insert + value.slice(end);
    textarea.value = next;
    const caret = cursor == null ? start + insert.length : cursor;
    textarea.selectionStart = textarea.selectionEnd = caret;
    textarea.focus();
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function listHtml(pads, query, currentId) {
    const needle = String(query || "").trim().toLowerCase();
    const rows = (pads || []).filter((pad) => {
      if (!needle) return true;
      const title = String(pad.title || "Note").toLowerCase();
      const content = String(pad.content || "").toLowerCase();
      return title.includes(needle) || content.includes(needle);
    });
    if (!rows.length) {
      return `<p class="note-rail-empty">${needle ? "No matching notes" : "No notes yet"}</p>`;
    }
    return rows.map((pad) => {
      const title = String(pad.title || "Note").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
      const current = pad.id && pad.id === currentId ? " is-current" : "";
      return `<button type="button" class="note-rail-note${current}" data-note-open="${pad.id || ""}">${title}</button>`;
    }).join("");
  }

  function bind(options) {
    const shell = options && options.shell;
    if (!shell) return { setShortcut() {}, setListening() {}, refresh() {}, destroy() {} };
    if (shell.dataset.chrome === "1" && shell._chromeApi) return shell._chromeApi;
    shell.dataset.chrome = "1";
    const rail = shell.querySelector(".note-rail");
    if (rail && !rail.querySelector("[data-note-collapse]")) rail.innerHTML = railHtml();
    const write = shell.querySelector(".note-write");
    if (write && !write.querySelector(".note-dictate-hint")) {
      write.insertAdjacentHTML("beforeend", hintHtml(options.shortcut || ""));
    }
    const main = shell.querySelector(".note-main");
    if (main && !main.querySelector("[data-format-dock]")) {
      main.insertAdjacentHTML("beforeend", formatDockHtml());
    }
    const textarea = options.textarea || shell.querySelector("textarea");
    if (textarea) {
      textarea.spellcheck = false;
      textarea.setAttribute("spellcheck", "false");
      textarea.setAttribute("autocorrect", "off");
      textarea.setAttribute("autocapitalize", "off");
      textarea.addEventListener("focus", () => {
        if (textarea.parentElement) textarea.parentElement.classList.add("is-armed");
      });
    }
    let formatOpen = false;

    function setFormat(open) {
      const next = Boolean(open);
      formatOpen = next;
      const dock = shell.querySelector("[data-format-dock]");
      const button = shell.querySelector("[data-format-toggle]");
      if (dock) {
        dock.classList.toggle("is-open", next);
        if (next) dock.removeAttribute("inert");
        else dock.setAttribute("inert", "");
      }
      if (button) button.setAttribute("aria-expanded", next ? "true" : "false");
      if (next && options.getSparkle) {
        const sparkle = options.getSparkle();
        if (sparkle && sparkle.hide) sparkle.hide();
        else if (sparkle && sparkle.close) sparkle.close();
      }
    }

    function syncCollapse() {
      const expanded = shell.classList.contains("is-expanded");
      const button = shell.querySelector("[data-note-collapse]");
      if (!button) return;
      button.setAttribute("aria-pressed", expanded ? "true" : "false");
      const label = expanded ? "Collapse sidebar" : "Expand sidebar";
      button.setAttribute("aria-label", label);
      button.title = label;
    }

    async function refresh() {
      const list = shell.querySelector("[data-note-list]");
      if (!list || !shell.classList.contains("is-expanded")) return;
      let pads = [];
      try {
        pads = options.getPads ? await options.getPads() : [];
      } catch (_error) {
        pads = [];
      }
      if (!shell.isConnected) return;
      const input = shell.querySelector("[data-note-search-input]");
      const query = input ? input.value : "";
      const current = options.getCurrentId ? options.getCurrentId() : "";
      list.innerHTML = listHtml(Array.isArray(pads) ? pads : [], query, current);
    }

    function onClick(event) {
      if (event.target.closest("[data-note-collapse]")) {
        shell.classList.toggle("is-expanded");
        syncCollapse();
        refresh();
        return;
      }
      if (event.target.closest("[data-note-search]")) {
        shell.classList.add("is-expanded");
        syncCollapse();
        refresh();
        const input = shell.querySelector("[data-note-search-input]");
        if (input) input.focus();
        return;
      }
      if (event.target.closest("[data-note-new]")) {
        if (options.onNew) options.onNew();
        return;
      }
      if (event.target.closest("[data-format-toggle]")) {
        setFormat(!formatOpen);
        return;
      }
      const format = event.target.closest("[data-format]");
      if (format) {
        applyFormat(textarea, format.getAttribute("data-format"));
        return;
      }
      const open = event.target.closest("[data-note-open]");
      if (open && options.onOpen) options.onOpen(open.getAttribute("data-note-open"));
    }

    function onSearch(event) {
      if (event.target && event.target.matches && event.target.matches("[data-note-search-input]")) refresh();
    }

    function onKeydown(event) {
      if (event.key === "Escape" && formatOpen) {
        event.preventDefault();
        event.stopPropagation();
        setFormat(false);
      }
    }

    function onSparkleOpen() {
      if (formatOpen) setFormat(false);
    }

    shell.addEventListener("click", onClick);
    shell.addEventListener("input", onSearch);
    shell.addEventListener("keydown", onKeydown);
    shell.addEventListener("openflow-sparkle-open", onSparkleOpen);
    syncCollapse();
    if (shell.classList.contains("is-expanded")) refresh();

    const api = {
      setShortcut(shortcut) {
        const hint = shell.querySelector(".note-dictate-hint");
        if (!hint) return;
        hint.outerHTML = hintHtml(shortcut);
      },
      setListening(on) {
        shell.classList.toggle("is-listening", Boolean(on));
      },
      refresh,
      destroy() {
        shell.removeEventListener("click", onClick);
        shell.removeEventListener("input", onSearch);
        shell.removeEventListener("keydown", onKeydown);
        shell.removeEventListener("openflow-sparkle-open", onSparkleOpen);
        delete shell.dataset.chrome;
        shell._chromeApi = null;
      },
    };
    shell._chromeApi = api;
    return api;
  }

  window.OpenflowNoteChrome = {
    hintHtml,
    railHtml,
    formatDockHtml,
    applyFormat,
    listHtml,
    keysFor,
    bind,
  };
})();
