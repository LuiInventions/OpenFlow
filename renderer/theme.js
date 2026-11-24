"use strict";

(() => {
  function apply(theme) {
    const value = theme === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = value;
    try { localStorage.setItem("openflow-theme", value); } catch (_) {}
  }
  try { apply(localStorage.getItem("openflow-theme")); } catch (_) { apply("dark"); }
  if (window.openflow) {
    // Subscribe before reading, so a late initial response cannot undo a new choice.
    let changed = false;
    window.openflow.on("theme-changed", settings => { changed = true; apply(settings.theme); });
    window.openflow.dispatch("settings.get").then(settings => {
      if (!changed) apply(settings.theme);
    }).catch(() => {});
  }
})();
