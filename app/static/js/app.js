document.addEventListener("DOMContentLoaded", () => {
  const sidebar = document.querySelector(".sidebar");
  const toggle = document.querySelector("[data-sidebar-toggle]");
  const overlay = document.querySelector("[data-sidebar-overlay]");

  const closeSidebar = () => {
    sidebar?.classList.remove("open");
    overlay?.classList.remove("visible");
  };

  toggle?.addEventListener("click", () => {
    sidebar?.classList.toggle("open");
    overlay?.classList.toggle("visible");
  });

  overlay?.addEventListener("click", closeSidebar);

  document.querySelectorAll(".sidebar .nav-item").forEach((link) => {
    link.addEventListener("click", closeSidebar);
  });

  document.querySelectorAll(".alert").forEach((alert) => {
    window.setTimeout(() => {
      const instance = bootstrap.Alert.getOrCreateInstance(alert);
      instance.close();
    }, 5000);
  });
});
