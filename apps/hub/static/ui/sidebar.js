(() => {
  function inferPageFromPath() {
    const path = (window.location && window.location.pathname) ? window.location.pathname : "";
    const file = path.split("/").pop() || "";
    if (!file) return "";
    if (file === "runs.html" || file === "run.html" || file === "jobs.html" || file === "job.html") return "projects";
    if (file === "connections.html" || file === "connection.html") return "projects";
    if (file === "dashboard.html") return "dashboard";
    if (file === "analytics.html") return "analytics";
    if (file === "projects.html" || file === "project.html" || file.startsWith("project-")) return "projects";
    if (file === "setting.html" || file === "settings.html" || file.startsWith("settings-")) return "settings";
    return "";
  }

  function normalizeNavKey(page) {
    if (!page) return inferPageFromPath();
    if (page === "dashboard") return "dashboard";
    if (page === "run" || page === "runs" || page === "job" || page === "jobs") return "projects";
    if (page === "connection" || page === "connections") return "projects";
    if (page === "project" || page === "projects" || page.startsWith("project-")) return "projects";
    if (page === "setting" || page === "settings" || page.startsWith("settings-")) return "settings";
    return page;
  }

  function applyActiveState(scope) {
    const page = normalizeNavKey(document.body.getAttribute("data-page") || "");
    const active = scope.querySelector(`[data-nav-key="${page}"]`);
    if (!active) return;

    active.classList.remove("text-slate-400");
    active.classList.add("bg-primary/20", "text-primary", "border", "border-primary/30");
  }

  async function mountSidebar() {
    const root = document.getElementById("sidebar-root");
    if (!root) {
      applyActiveState(document);
      return;
    }

    try {
      const res = await fetch("/ui/partials/sidebar.html", { cache: "no-store" });
      if (!res.ok) throw new Error("sidebar fetch failed");
      root.innerHTML = await res.text();
      applyActiveState(root);
    } catch (error) {
      root.innerHTML = "";
      console.error("Failed to mount sidebar", error);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountSidebar);
    return;
  }
  mountSidebar();
})();
