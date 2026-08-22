document.addEventListener("DOMContentLoaded", () => {
  const sidebar = document.querySelector(".sidebar");
  const toggles = document.querySelectorAll("[data-sidebar-toggle]");
  const overlay = document.querySelector("[data-sidebar-overlay]");

  const closeSidebar = () => {
    sidebar?.classList.remove("open");
    overlay?.classList.remove("visible");
    toggles.forEach((toggle) => toggle.setAttribute("aria-expanded", "false"));
  };

  toggles.forEach((toggle) => toggle.addEventListener("click", () => {
    sidebar?.classList.toggle("open");
    overlay?.classList.toggle("visible");
    const isOpen = sidebar?.classList.contains("open") || false;
    toggles.forEach((item) => item.setAttribute("aria-expanded", String(isOpen)));
  }));

  overlay?.addEventListener("click", closeSidebar);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSidebar();
  });

  document.querySelectorAll(".sidebar .nav-item").forEach((link) => {
    link.addEventListener("click", closeSidebar);
  });

  document.querySelectorAll(".alert").forEach((alert) => {
    window.setTimeout(() => {
      const instance = bootstrap.Alert.getOrCreateInstance(alert);
      instance.close();
    }, 5000);
  });

  document.querySelectorAll("[data-confirm]").forEach((control) => {
    control.addEventListener("click", (event) => {
      const message = control.getAttribute("data-confirm");
      if (message && !window.confirm(message)) {
        event.preventDefault();
        event.stopPropagation();
      }
    });
  });

  const scanForm = document.getElementById("scan-form");
  scanForm?.addEventListener("submit", () => {
    document.querySelector(".scan-idle")?.classList.add("d-none");
    document.querySelector(".scan-loading")?.classList.remove("d-none");
    const scanButton = document.getElementById("scan-btn");
    if (scanButton) {
      scanButton.disabled = true;
    }
  });
});
