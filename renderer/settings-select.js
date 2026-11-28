"use strict";

window.OpenflowSelect = (() => {
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  let active = null, bound = false, search = "", searchTimer;
  const arrow = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m4 6 4 4 4-4"/></svg>';
  function html({ id, key, label, value = "", options = [], describedBy = "" }) {
    const selected = options.find(option => option.value === value) || options[0];
    return `<div class="settings-select"><button type="button" id="${esc(id)}" class="settings-select-trigger" role="combobox" aria-haspopup="listbox" aria-expanded="false" aria-label="${esc(label)}"${describedBy ? ` aria-describedby="${esc(describedBy)}"` : ""} data-select-key="${esc(key)}" data-value="${esc(value)}" data-select-options="${esc(JSON.stringify(options))}"><span class="settings-select-value">${esc(selected?.label || "Choose an option")}</span>${arrow}</button></div>`;
  }
  function close(focus = false) {
    if (!active) return;
    const { trigger, menu } = active;
    active = null; menu.remove();
    trigger.setAttribute("aria-expanded", "false");
    trigger.removeAttribute("aria-activedescendant"); trigger.removeAttribute("aria-controls");
    if (focus && trigger.isConnected) trigger.focus({ preventScroll: true });
    search = ""; clearTimeout(searchTimer);
  }
  function highlight(index) {
    if (!active) return;
    active.index = index;
    const buttons = [...active.menu.querySelectorAll("[role=option]")];
    buttons.forEach((button, i) => button.classList.toggle("is-highlighted", i === index));
    if (buttons[index]) {
      active.trigger.setAttribute("aria-activedescendant", buttons[index].id);
      buttons[index].scrollIntoView({ block: "nearest" });
    }
  }
  function paint() {
    const { trigger, menu, options } = active;
    menu.innerHTML = options.map((option, i) => `<button type="button" tabindex="-1" role="option" id="${esc(trigger.id)}-option-${i}" aria-selected="${option.value === trigger.dataset.value}"${option.disabled ? ' aria-disabled="true" disabled' : ""} data-select-index="${i}"><span>${esc(option.label)}</span>${option.value === trigger.dataset.value ? '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m3 8 3 3 7-7"/></svg>' : ""}</button>`).join("");
    const rect = trigger.getBoundingClientRect(), gap = 6, margin = 8;
    const width = Math.min(Math.max(rect.width, 240), innerWidth - margin * 2);
    const below = innerHeight - rect.bottom - gap - margin, above = rect.top - gap - margin;
    const down = below >= 140 || below >= above;
    menu.style.width = `${width}px`;
    menu.style.maxHeight = `${Math.max(60, Math.min(260, down ? below : above))}px`;
    menu.style.left = `${Math.max(margin, Math.min(rect.right - width, innerWidth - width - margin))}px`;
    menu.style.top = down ? `${rect.bottom + gap}px` : "auto";
    menu.style.bottom = down ? "auto" : `${innerHeight - rect.top + gap}px`;
    highlight(options.findIndex(option => option.value === trigger.dataset.value && !option.disabled));
  }
  function open(trigger) {
    close();
    trigger.dispatchEvent(new CustomEvent("settings-select-open", { bubbles: true, detail: { key: trigger.dataset.selectKey } }));
    const options = JSON.parse(trigger.dataset.selectOptions || "[]");
    const menu = document.createElement("div");
    menu.className = "settings-select-menu"; menu.id = `${trigger.id}-list`;
    menu.setAttribute("role", "listbox"); menu.setAttribute("aria-label", trigger.getAttribute("aria-label"));
    document.body.append(menu);
    active = { trigger, menu, options, index: -1 };
    trigger.setAttribute("aria-expanded", "true"); trigger.setAttribute("aria-controls", menu.id);
    paint(); trigger.focus({ preventScroll: true });
  }
  function choose(index) {
    const option = active?.options[index];
    if (!option || option.disabled) return;
    const { trigger } = active;
    trigger.dataset.value = option.value;
    trigger.querySelector(".settings-select-value").textContent = option.label;
    close(true);
    trigger.dispatchEvent(new CustomEvent("settings-select-change", { bubbles: true, detail: { key: trigger.dataset.selectKey, value: option.value, label: option.label } }));
  }
  function update(trigger, options, value) {
    if (!trigger) return;
    trigger.dataset.selectOptions = JSON.stringify(options); trigger.dataset.value = value;
    trigger.querySelector(".settings-select-value").textContent = (options.find(option => option.value === value) || options[0])?.label || "Choose an option";
    if (active?.trigger === trigger) { active.options = options; paint(); }
  }
  function bind() {
    if (bound) return; bound = true;
    document.addEventListener("click", event => {
      const option = event.target.closest("[data-select-index]");
      if (option && active?.menu.contains(option)) { event.preventDefault(); choose(Number(option.dataset.selectIndex)); return; }
      const trigger = event.target.closest("[data-select-key]");
      if (trigger && !trigger.disabled) { event.preventDefault(); active?.trigger === trigger ? close(true) : open(trigger); }
    });
    document.addEventListener("pointerdown", event => {
      if (active && !active.trigger.contains(event.target) && !active.menu.contains(event.target)) close();
    });
    document.addEventListener("keydown", event => {
      const trigger = event.target.closest("[data-select-key]");
      if (!active && trigger && !trigger.disabled && ["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault(); open(trigger); return;
      }
      if (!active) return;
      const enabled = active.options.map((option, i) => option.disabled ? -1 : i).filter(i => i >= 0);
      if (event.key === "Escape") { event.preventDefault(); close(true); }
      else if (event.key === "Tab") close();
      else if (event.key === "Enter" || (event.key === " " && !search)) { event.preventDefault(); choose(active.index); }
      else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const position = enabled.indexOf(active.index);
        const next = event.key === "Home" ? 0 : event.key === "End" ? enabled.length - 1 : event.key === "ArrowDown" ? (position < 0 ? 0 : position + 1) : (position < 0 ? enabled.length - 1 : position - 1);
        highlight(enabled[(next + enabled.length) % enabled.length]);
      } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        search += event.key.toLowerCase(); clearTimeout(searchTimer); searchTimer = setTimeout(() => { search = ""; }, 700);
        const index = active.options.findIndex(option => !option.disabled && option.label.toLowerCase().startsWith(search));
        if (index >= 0) { event.preventDefault(); highlight(index); }
      }
    });
    document.addEventListener("scroll", event => { if (active && !active.menu.contains(event.target)) close(); }, true);
    window.addEventListener("resize", () => close()); window.addEventListener("blur", () => close());
  }
  return { html, bind, update, close };
})();
