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
      instance?.close();
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

  // ─── Global Search (Ctrl + K) ──────────────────────────────────────
  const searchModalEl = document.getElementById("globalSearchModal");
  const searchInput = document.getElementById("globalSearchInput");
  const searchResults = document.getElementById("globalSearchResults");

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (searchModalEl) {
        const modal = bootstrap.Modal.getOrCreateInstance(searchModalEl);
        modal.show();
      }
    }
  });

  searchModalEl?.addEventListener("shown.bs.modal", () => {
    searchInput?.focus();
  });

  let searchTimeout = null;
  searchInput?.addEventListener("input", () => {
    const val = searchInput.value.trim();
    if (searchTimeout) clearTimeout(searchTimeout);
    if (val.length < 2) {
      if (searchResults) {
        searchResults.innerHTML = `
          <div class="p-4 text-center text-muted">
            <i class="bi bi-keyboard fs-3 d-block mb-2"></i>
            <span>Type at least 2 characters to search across all records...</span>
          </div>`;
      }
      return;
    }

    searchTimeout = setTimeout(() => {
      const searchUrl = window.location.pathname.startsWith('/admin')
        ? `/admin/search?q=${encodeURIComponent(val)}`
        : `/operations/search?q=${encodeURIComponent(val)}`;

      fetch(searchUrl)
        .then((res) => res.json())
        .then((data) => {
          if (!searchResults) return;
          const { members = [], payments = [], leads = [], gyms = [], owners = [], bridges = [] } = data;
          
          if (!members.length && !payments.length && !leads.length && !gyms.length && !owners.length && !bridges.length) {
            searchResults.innerHTML = `<div class="p-4 text-center text-muted">No records found matching "${val}".</div>`;
            return;
          }

          let html = "";

          // Super Admin: Gyms
          if (gyms.length) {
            html += `<div class="p-2 px-3 bg-light fw-bold small text-uppercase text-secondary">Gym Deployments (${gyms.length})</div>`;
            html += '<div class="list-group list-group-flush">';
            gyms.forEach((g) => {
              html += `
                <a href="${g.url}" class="list-group-item list-group-item-action d-flex justify-content-between align-items-center py-2 px-3">
                  <div>
                    <span class="fw-bold"><i class="bi bi-buildings me-2 text-primary"></i>${g.name}</span>
                    <span class="text-muted small ms-2">${g.city}</span>
                  </div>
                  <span class="badge status-${g.status}">${g.status}</span>
                </a>`;
            });
            html += "</div>";
          }

          // Super Admin: Owners
          if (owners.length) {
            html += `<div class="p-2 px-3 bg-light fw-bold small text-uppercase text-secondary">Gym Owners & Users (${owners.length})</div>`;
            html += '<div class="list-group list-group-flush">';
            owners.forEach((o) => {
              html += `
                <a href="${o.url}" class="list-group-item list-group-item-action d-flex justify-content-between align-items-center py-2 px-3">
                  <div>
                    <span class="fw-bold"><i class="bi bi-person me-2 text-info"></i>${o.name}</span>
                    <span class="text-muted small ms-2">${o.email}</span>
                  </div>
                  <span class="badge bg-secondary font-monospace text-xs">${o.gym_name}</span>
                </a>`;
            });
            html += "</div>";
          }

          // Super Admin: Bridges & Hardware
          if (bridges.length) {
            html += `<div class="p-2 px-3 bg-light fw-bold small text-uppercase text-secondary">Biometric Hardware (${bridges.length})</div>`;
            html += '<div class="list-group list-group-flush">';
            bridges.forEach((b) => {
              html += `
                <a href="${b.url}" class="list-group-item list-group-item-action d-flex justify-content-between align-items-center py-2 px-3">
                  <div>
                    <span class="fw-bold font-monospace"><i class="bi bi-hdd-network me-2 text-success"></i>${b.serial}</span>
                  </div>
                  <span class="badge bg-light text-dark border">${b.gym_name}</span>
                </a>`;
            });
            html += "</div>";
          }

          // Standard: Members
          if (members.length) {
            html += `<div class="p-2 px-3 bg-light fw-bold small text-uppercase text-secondary">Members (${members.length})</div>`;
            html += '<div class="list-group list-group-flush">';
            members.forEach((m) => {
              html += `
                <a href="${m.url}" class="list-group-item list-group-item-action d-flex justify-content-between align-items-center py-2 px-3">
                  <div>
                    <span class="fw-bold">${m.name}</span>
                    <span class="text-muted small ms-2">${m.phone}</span>
                    <span class="badge bg-dark font-monospace text-xs ms-1">#${m.enroll_number}</span>
                  </div>
                  <span class="badge status-${m.status}">${m.status}</span>
                </a>`;
            });
            html += "</div>";
          }

          // Standard: Payments
          if (payments.length) {
            html += `<div class="p-2 px-3 bg-light fw-bold small text-uppercase text-secondary">Payments (${payments.length})</div>`;
            html += '<div class="list-group list-group-flush">';
            payments.forEach((p) => {
              html += `
                <a href="${p.url}" class="list-group-item list-group-item-action d-flex justify-content-between align-items-center py-2 px-3">
                  <div>
                    <span class="fw-bold">₹${p.amount}</span>
                    <span class="text-muted small ms-2">${p.member_name}</span>
                  </div>
                  <span class="badge status-${p.status}">${p.status}</span>
                </a>`;
            });
            html += "</div>";
          }

          // Standard: Leads
          if (leads.length) {
            html += `<div class="p-2 px-3 bg-light fw-bold small text-uppercase text-secondary">Captured Leads (${leads.length})</div>`;
            html += '<div class="list-group list-group-flush">';
            leads.forEach((l) => {
              html += `
                <a href="${l.url}" class="list-group-item list-group-item-action d-flex justify-content-between align-items-center py-2 px-3">
                  <div>
                    <span class="fw-bold">${l.name}</span>
                    <span class="text-muted small ms-2">${l.phone}</span>
                  </div>
                  <span class="badge status-${l.status}">${l.status}</span>
                </a>`;
            });
            html += "</div>";
          }

          searchResults.innerHTML = html;
        })
        .catch((err) => {
          if (searchResults) {
            searchResults.innerHTML = `<div class="p-3 text-danger text-center">Search error. Please try again.</div>`;
          }
        });
    }, 250);
  });
});

