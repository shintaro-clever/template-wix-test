(() => {
  async function mountSidebar() {
    const root = document.getElementById("sidebar-root");
    if (!root) return;

    try {
      const res = await fetch("/ui/partials/sidebar.html", { cache: "no-store" });
      if (!res.ok) throw new Error("sidebar fetch failed");
      root.innerHTML = await res.text();

      const page = document.body.getAttribute("data-page") || "";
      const active = root.querySelector(`[data-nav-key="${page}"]`);
      if (active) {
        active.classList.remove("text-slate-400");
        active.classList.add("bg-primary/20", "text-primary", "border", "border-primary/30");
      }
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
