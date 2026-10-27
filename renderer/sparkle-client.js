"use strict";

(function () {
  const FALLBACK = ["Polish", "Shorten", "As a list"];
  const DEBOUNCE_MS = 4000;
  const MIN_WORDS = 15;
  const ICON = '<svg class="sparkle-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"></path><path d="M20 3v4"></path><path d="M22 5h-4"></path><path d="M4 17v2"></path><path d="M5 18H3"></path></svg>';

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function wordCount(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed) return 0;
    return trimmed.split(/\s+/).length;
  }

  function chipLabel(label) {
    const text = String(label || "").trim().replace(/\s+/g, " ");
    const words = text.split(" ").filter(Boolean);
    if (!text || text.length > 12 || words.length < 1 || words.length > 3) return "";
    return text;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function inlineMarkdown(text) {
    let html = escapeHtml(text);
    html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_match, label, href) => {
      const safe = href.replace(/&quot;/g, "");
      return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    });
    html = html.replace(/&lt;u&gt;([\s\S]+?)&lt;\/u&gt;/g, "<u>$1</u>");
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
    return html;
  }

  function renderMarkdown(source) {
    const lines = String(source || "").replace(/\r\n/g, "\n").split("\n");
    const out = [];
    let list = "";
    function closeList() {
      if (!list) return;
      out.push(list === "ol" ? "</ol>" : "</ul>");
      list = "";
    }
    function openList(type) {
      if (list === type) return;
      closeList();
      list = type;
      out.push(type === "ol" ? "<ol>" : "<ul>");
    }
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        closeList();
        continue;
      }
      const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
      if (heading) {
        closeList();
        const level = heading[1].length;
        out.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
        continue;
      }
      if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
        closeList();
        out.push("<hr>");
        continue;
      }
      const quote = trimmed.match(/^>\s?(.+)$/);
      if (quote) {
        closeList();
        out.push(`<blockquote>${inlineMarkdown(quote[1])}</blockquote>`);
        continue;
      }
      const image = trimmed.match(/^!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)$/);
      if (image) {
        closeList();
        const alt = escapeHtml(image[1]);
        const src = image[2].replace(/"/g, "");
        out.push(`<p><img alt="${alt}" src="${src}"></p>`);
        continue;
      }
      const check = trimmed.match(/^[-*]\s+\[( |x|X)\]\s+(.+)$/);
      if (check) {
        openList("ul");
        const mark = check[1].toLowerCase() === "x" ? "☑" : "☐";
        out.push(`<li>${mark} ${inlineMarkdown(check[2])}</li>`);
        continue;
      }
      const bullet = trimmed.match(/^[-*]\s+(.+)$/);
      if (bullet) {
        openList("ul");
        out.push(`<li>${inlineMarkdown(bullet[1])}</li>`);
        continue;
      }
      const numbered = trimmed.match(/^\d+\.\s+(.+)$/);
      if (numbered) {
        openList("ol");
        out.push(`<li>${inlineMarkdown(numbered[1])}</li>`);
        continue;
      }
      closeList();
      out.push(`<p>${inlineMarkdown(trimmed)}</p>`);
    }
    closeList();
    return out.join("");
  }

  const editingNotes = new WeakSet();

  function markdownView(textarea) {
    const parent = textarea && textarea.parentElement;
    if (!parent) return null;
    return parent.querySelector(":scope > .note-md");
  }

  function paintMarkdown(textarea) {
    const view = markdownView(textarea);
    if (!view || !textarea) return;
    const text = String(textarea.value || "");
    const show = Boolean(text.trim()) && !textarea.classList.contains("is-shimmer");
    view.hidden = !show;
    view.innerHTML = show ? renderMarkdown(text) : "";
    if (textarea.parentElement) textarea.parentElement.classList.toggle("is-empty", !text);
  }

  function attach(options) {
    const host = options.host;
    const root = options.root;
    const textarea = options.textarea;
    if (!host || !textarea || host.dataset.mounted === "1") {
      return { destroy() {}, onExternalChange() {}, close() {} };
    }
    host.dataset.mounted = "1";
    const SEND_ICON = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 12.5V3.5"></path><path d="M4.5 7 8 3.5 11.5 7"></path></svg>';
    host.innerHTML = `<button type="button" class="sparkle-btn" data-sparkle-toggle aria-expanded="false" title="Improve" aria-label="Improve"><span class="sparkle-glyph">${ICON}</span><span class="sparkle-label">Improve</span></button>`;
    const panelMarkup = `<div class="sparkle-panel" data-sparkle-panel aria-hidden="true"><div class="sparkle-chips-row"><div class="sparkle-chips" data-sparkle-chips></div><button type="button" class="sparkle-history" data-sparkle-history>History</button></div><div class="sparkle-field"><input class="sparkle-text" data-sparkle-input placeholder="Follow up or ask a question" aria-label="Follow up or ask a question"><span class="sparkle-enter">Press Enter or</span><button type="button" class="sparkle-send" data-sparkle-send aria-label="Send" title="Send">${SEND_ICON}</button></div><p class="sparkle-hint" data-sparkle-limit hidden>At most 6 words.</p><div class="sparkle-privacy" data-sparkle-privacy hidden><p>This note is sent to OpenAI.</p><div class="sparkle-actions"><button type="button" class="sparkle-chip" data-sparkle-ack>Continue</button></div></div><div class="sparkle-preview" data-sparkle-preview hidden><p data-sparkle-preview-text></p><div class="sparkle-actions"><button type="button" class="sparkle-chip" data-sparkle-accept>Use it anyway</button><button type="button" class="sparkle-ghost" data-sparkle-reject>Discard</button></div></div></div>`;
    const dock = root.querySelector("[data-sparkle-dock]");
    if (dock) {
      dock.innerHTML = `<div class="sparkle-dock-clip">${panelMarkup}</div>`;
      dock.setAttribute("inert", "");
    } else host.insertAdjacentHTML("beforeend", panelMarkup);
    const scope = dock || host;
    const panel = scope.querySelector("[data-sparkle-panel]");
    const chips = scope.querySelector("[data-sparkle-chips]");
    const input = scope.querySelector("[data-sparkle-input]");
    const send = scope.querySelector("[data-sparkle-send]");
    const count = scope.querySelector("[data-sparkle-count]");
    const limitHint = scope.querySelector("[data-sparkle-limit]");
    const privacy = scope.querySelector("[data-sparkle-privacy]");
    const preview = scope.querySelector("[data-sparkle-preview]");
    const previewText = scope.querySelector("[data-sparkle-preview-text]");
    const button = host.querySelector("[data-sparkle-toggle]");
    const toastParent = textarea.parentElement && textarea.parentElement.classList.contains("note-write") ? textarea.parentElement : root;
    let toast = toastParent.querySelector(":scope > .sparkle-toast, :scope > .sparkle-undo");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "sparkle-toast";
      toast.hidden = true;
      toastParent.appendChild(toast);
    }
    let panelOpen = false;
    let busy = false;
    let applying = false;
    let timer = null;
    let toastTimer = null;
    let undoArmed = null;
    let undoTyped = false;
    let previewPayload = null;
    let closed = false;
    let historyOpen = false;
    let historyPending = false;
    const markdown = document.createElement("div");
    markdown.className = "note-md";
    markdown.hidden = true;
    const fog = document.createElement("div");
    fog.className = "note-fog";
    fog.hidden = true;
    fog.innerHTML = `<button type="button" class="note-fog-btn" tabindex="-1" disabled><span class="sparkle-glyph">${ICON}</span><span>Improving</span></button>`;
    textarea.insertAdjacentElement("afterend", markdown);
    textarea.insertAdjacentElement("afterend", fog);

    function settings() {
      return options.getSettings() || {};
    }

    function dispatch(action, payload) {
      if (!options.dispatch) return Promise.resolve(null);
      return options.dispatch(action, payload);
    }

    function available() {
      const current = settings();
      return Boolean(current.noteImproveEnabled && current.hasKey);
    }

    function paintAvailability() {
      const on = available();
      button.classList.toggle("is-unavailable", !on && !busy);
      if (!busy) button.disabled = !on;
      if (!on) {
        button.title = settings().hasKey ? "Note improvement is off." : "Add an OpenAI API key in Settings.";
        if (panelOpen) hidePanel();
      } else if (!busy) {
        button.title = "Improve";
      }
    }

    async function ensurePrivacy() {
      const current = settings();
      if (current.noteImprovePrivacyAck && current.noteImproveOnboardingDone) return;
      const patch = { noteImproveOnboardingDone: true, noteImprovePrivacyAck: true };
      const save = options.onSettings ? options.onSettings(patch) : dispatch("settings.save", patch);
      await Promise.resolve(save);
    }

    function paintCount() {
      const total = wordCount(input.value);
      if (count) count.textContent = `${total}/6 words`;
      const over = total > 6;
      limitHint.hidden = !over;
      const enter = panel.querySelector(".sparkle-enter");
      if (enter) enter.hidden = total > 0;
      send.disabled = busy || total === 0;
      input.setAttribute("aria-invalid", over ? "true" : "false");
    }

    function showChips(list, skeleton) {
      const fitted = Array.isArray(list) ? list.map(chipLabel).filter(Boolean) : [];
      const items = skeleton ? ["···", "···", "···"] : (fitted.length === 3 ? fitted : FALLBACK);
      chips.innerHTML = items.map((label) => {
        if (skeleton) return '<span class="sparkle-chip is-skeleton" aria-hidden="true">····</span>';
        return `<button type="button" class="sparkle-chip" data-sparkle-chip="${esc(label)}" ${busy ? "disabled" : ""}>${esc(label)}</button>`;
      }).join("");
    }

    function paintBusy() {
      button.disabled = busy || !available();
      button.classList.toggle("is-unavailable", !busy && !available());
      button.classList.toggle("is-busy", busy);
      textarea.classList.toggle("is-shimmer", busy);
      fog.hidden = !busy;
      if (busy) markdown.hidden = true;
      input.disabled = busy;
      chips.querySelectorAll("button").forEach((chip) => { chip.disabled = busy; });
      paintCount();
      if (!busy) paintMarkdown(textarea);
    }

    function hideToast() {
      clearTimeout(toastTimer);
      toast.hidden = true;
      toast.innerHTML = "";
    }

    function showToast(message, withUndo) {
      clearTimeout(toastTimer);
      toast.hidden = false;
      if (withUndo) {
        toast.className = "sparkle-undo";
        toast.innerHTML = '<button type="button" data-sparkle-undo><span>Undo</span><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.2 3.4 3.2 6.2l3 2.8"></path><path d="M3.5 6.2h6.2a3 3 0 1 1 0 6H8"></path></svg></button>';
      } else {
        toast.className = "sparkle-toast";
        toast.innerHTML = `<span>${esc(message)}</span>`;
        undoArmed = null;
      }
      toastTimer = setTimeout(() => {
        hideToast();
        if (withUndo) undoArmed = null;
      }, withUndo ? 8000 : 5000);
    }

    async function loadCached(generate) {
      const note = options.getNote();
      if (!note.content || wordCount(note.content) < MIN_WORDS) {
        showChips(FALLBACK, false);
        return;
      }
      const cached = await dispatch("notes.sparkle.cached", { id: note.id, content: note.content });
      if (closed) return;
      const list = cached && cached.suggestions ? cached.suggestions : FALLBACK;
      const waiting = generate && cached && !cached.fresh && available();
      showChips(list, waiting && !(cached && cached.suggestions && cached.suggestions.length));
      if (!waiting) {
        showChips(list, false);
        return;
      }
      if (!cached.fallback) showChips(list, false);
      else showChips(FALLBACK, true);
      const result = await dispatch("notes.sparkle.suggest", {
        id: note.id,
        title: note.title,
        content: note.content,
        save: Boolean(note.id),
      });
      if (closed) return;
      showChips(result && result.suggestions ? result.suggestions : FALLBACK, false);
    }

    function setOpen(open) {
      panelOpen = Boolean(open);
      button.setAttribute("aria-expanded", panelOpen ? "true" : "false");
      if (dock) {
        dock.classList.toggle("is-open", panelOpen);
        if (panelOpen) dock.removeAttribute("inert");
        else dock.setAttribute("inert", "");
        panel.removeAttribute("hidden");
        panel.setAttribute("aria-hidden", panelOpen ? "false" : "true");
      } else {
        panel.hidden = !panelOpen;
      }
      if (!panelOpen) {
        privacy.hidden = true;
        preview.hidden = true;
      } else if (root) {
        root.dispatchEvent(new CustomEvent("openflow-sparkle-open"));
      }
    }

    function schedule() {
      clearTimeout(timer);
      const current = settings();
      if (!available() || current.noteImproveAutoSuggestions === false) return;
      timer = setTimeout(() => {
        const note = options.getNote();
        if (!note.id || wordCount(note.content) < MIN_WORDS) return;
        dispatch("pads.save", { id: note.id, title: note.title || "Note", content: note.content })
          .then(() => loadCached(true))
          .catch(() => {});
      }, DEBOUNCE_MS);
    }

    async function ensureId() {
      const note = options.getNote();
      if (note.id) return note;
      const saved = await dispatch("pads.save", { title: note.title || "Note", content: note.content });
      if (saved && saved.id) {
        options.setNoteId(saved.id);
        if (options.onSaved) options.onSaved(saved);
      }
      return options.getNote();
    }

    function hidePanel() {
      setOpen(false);
    }

    async function run(instruction) {
      const clean = String(instruction || "").trim();
      if (busy || wordCount(clean) === 0) return;
      hidePanel();
      if (!available()) return;
      const current = settings();
      busy = true;
      paintBusy();
      let result = null;
      try {
        await ensurePrivacy();
        const note = await ensureId();
        result = await dispatch("notes.sparkle.improve", {
          id: note.id,
          title: note.title,
          content: note.content,
          instruction: clean,
          language: current.spokenLanguage || "",
        });
      } catch (_error) {
        result = { ok: false, code: "error" };
      }
      if (closed) return;
      busy = false;
      paintBusy();
      if (!result || result.code === "aborted") return;
      if (!result.ok && result.code === "preview" && result.output) {
        result = { ok: true, content: result.output, id: result.id, snapshotId: result.snapshotId };
      }
      if (!result.ok) {
        showToast(result.message || "Improvement failed. Try again.", false);
        return;
      }
      applying = true;
      options.setContent(result.content);
      if (result.id) options.setNoteId(result.id);
      editingNotes.delete(textarea);
      paintMarkdown(textarea);
      applying = false;
      undoTyped = false;
      undoArmed = { id: result.id, snapshotId: result.snapshotId };
      showToast("", true);
      input.value = "";
      paintCount();
      loadCached(true).catch(() => {});
    }

    async function acceptPreview() {
      if (!previewPayload) return;
      const payload = previewPayload;
      previewPayload = null;
      preview.hidden = true;
      busy = true;
      paintBusy();
      let result = null;
      try {
        result = await dispatch("notes.sparkle.apply", {
          id: options.getNote().id,
          title: payload.title,
          content: payload.before,
          output: payload.output,
          instruction: payload.instruction,
        });
      } catch (_error) {
        result = { ok: false };
      }
      busy = false;
      paintBusy();
      if (!result || !result.ok) {
        showToast("Improvement failed. Try again.", false);
        return;
      }
      applying = true;
      options.setContent(result.content);
      editingNotes.delete(textarea);
      paintMarkdown(textarea);
      applying = false;
      undoTyped = false;
      undoArmed = { id: result.id, snapshotId: result.snapshotId };
      showToast("", true);
      loadCached(true).catch(() => {});
    }

    async function undo() {
      if (!undoArmed) return;
      const armed = undoArmed;
      undoArmed = null;
      hideToast();
      const result = await dispatch("notes.sparkle.undo", armed);
      if (result && result.ok) {
        applying = true;
        options.setContent(result.content);
        editingNotes.delete(textarea);
        paintMarkdown(textarea);
        applying = false;
      }
    }

    function closeHistory() {
      if (!historyOpen && !historyPending) return;
      historyOpen = false;
      historyPending = false;
      dispatch("notes.sparkle.history.close").catch(() => {});
    }

    function close() {
      setOpen(false);
      const note = options.getNote();
      if (busy && note.id) dispatch("notes.sparkle.cancel", { id: note.id }).catch(() => {});
      busy = false;
      paintBusy();
    }

    function onClick(event) {
      const target = event.target.closest("[data-sparkle-toggle], [data-sparkle-close], [data-sparkle-chip], [data-sparkle-send], [data-sparkle-ack], [data-sparkle-accept], [data-sparkle-reject], [data-sparkle-history], [data-sparkle-undo]");
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      if (target.hasAttribute("data-sparkle-toggle")) {
        if (!available()) return;
        const opening = !panelOpen;
        if (opening) {
          setOpen(true);
          paintCount();
          loadCached(Boolean(settings().noteImproveAutoSuggestions !== false && available())).catch(() => {});
        } else if (busy) close();
        else setOpen(false);
        return;
      }
      if (target.hasAttribute("data-sparkle-close")) {
        close();
        return;
      }
      if (target.hasAttribute("data-sparkle-chip")) {
        run(target.getAttribute("data-sparkle-chip")).catch(() => {});
        return;
      }
      if (target.hasAttribute("data-sparkle-send")) {
        run(input.value).catch(() => {});
        return;
      }
      if (target.hasAttribute("data-sparkle-ack")) {
        const instruction = privacy.dataset.instruction || "";
        privacy.hidden = true;
        const save = options.onSettings
          ? options.onSettings({ noteImprovePrivacyAck: true })
          : dispatch("settings.save", { noteImprovePrivacyAck: true });
        Promise.resolve(save).then(() => run(instruction)).catch(() => {});
        return;
      }
      if (target.hasAttribute("data-sparkle-accept")) {
        acceptPreview().catch(() => {});
        return;
      }
      if (target.hasAttribute("data-sparkle-reject")) {
        previewPayload = null;
        preview.hidden = true;
        return;
      }
      if (target.hasAttribute("data-sparkle-history")) {
        const note = options.getNote();
        if (!note.id) return;
        const rect = root.getBoundingClientRect();
        historyPending = true;
        dispatch("notes.sparkle.history.open", {
          id: note.id,
          anchor: {
            x: Math.round(window.screenX + rect.left),
            y: Math.round(window.screenY + rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
        }).then((result) => {
          historyPending = false;
          historyOpen = Boolean(result && result.open);
        }).catch(() => {
          historyPending = false;
        });
      }
    }

    function onInput(event) {
      if (event.target === input) {
        paintCount();
        return;
      }
      if (event.target === textarea && !applying) {
        undoTyped = true;
        schedule();
        paintMarkdown(textarea);
      }
    }

    function onKeydown(event) {
      if (event.target === input && event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        run(input.value).catch(() => {});
        return;
      }
      if (event.key === "Escape" && panelOpen) {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && undoArmed && !undoTyped && event.target === textarea) {
        event.preventDefault();
        undo().catch(() => {});
      }
    }

    function onToastClick(event) {
      if (event.target.closest("[data-sparkle-undo]")) {
        event.preventDefault();
        undo().catch(() => {});
      }
    }

    markdown.addEventListener("copy", (event) => {
      const source = String(textarea.value || "");
      if (!event.clipboardData) return;
      event.preventDefault();
      event.clipboardData.setData("text/plain", source);
    });
    textarea.addEventListener("blur", () => {
      paintMarkdown(textarea);
    });
    textarea.addEventListener("scroll", () => {
      markdown.scrollTop = textarea.scrollTop;
    });
    const surfaces = dock ? [host, dock] : [host];
    surfaces.forEach((node) => {
      node.addEventListener("click", onClick);
      node.addEventListener("input", onInput);
      node.addEventListener("keydown", onKeydown);
    });
    textarea.addEventListener("input", onInput);
    textarea.addEventListener("keydown", onKeydown);
    toast.addEventListener("click", onToastClick);
    showChips(FALLBACK, false);
    paintCount();
    paintAvailability();
    paintMarkdown(textarea);

    return {
      destroy() {
        closed = true;
        clearTimeout(timer);
        closeHistory();
        const note = options.getNote();
        if (busy && note.id) dispatch("notes.sparkle.cancel", { id: note.id }).catch(() => {});
        surfaces.forEach((node) => {
          node.removeEventListener("click", onClick);
          node.removeEventListener("input", onInput);
          node.removeEventListener("keydown", onKeydown);
        });
        textarea.removeEventListener("input", onInput);
        textarea.removeEventListener("keydown", onKeydown);
        toast.removeEventListener("click", onToastClick);
        hideToast();
        markdown.remove();
        fog.remove();
        host.dataset.mounted = "";
      },
      onExternalChange() {
        paintAvailability();
        if (!applying) schedule();
      },
      paintAvailability,
      hide() { hidePanel(); },
      close,
      closeHistory,
    };
  }

  window.OpenflowSparkle = {
    attach,
    sync(textarea, opts) {
      if (opts && opts.reveal) editingNotes.delete(textarea);
      paintMarkdown(textarea);
    },
  };
})();
