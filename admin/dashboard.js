(function () {
  if (!AdminAPI.isLoggedIn()) {
    window.location.href = "login.html";
    return;
  }

  let currentAdmin = null;

  const el = {
    adminLabel: document.getElementById("adminLabel"),
    logoutBtn: document.getElementById("logoutBtn"),
    tabBtns: document.querySelectorAll(".tab-btn"),
    views: document.querySelectorAll(".view"),
    invitesTabBtn: document.getElementById("invitesTabBtn"),

    branchFilter: document.getElementById("branchFilter"),
    statusFilter: document.getElementById("statusFilter"),
    dateFilter: document.getElementById("dateFilter"),
    refreshOrdersBtn: document.getElementById("refreshOrdersBtn"),
    ordersList: document.getElementById("ordersList"),

    inviteForm: document.getElementById("inviteForm"),
    inviteEmail: document.getElementById("inviteEmail"),
    inviteRole: document.getElementById("inviteRole"),
    createInviteBtn: document.getElementById("createInviteBtn"),
    inviteLinkBox: document.getElementById("inviteLinkBox"),
    invitesList: document.getElementById("invitesList"),
  };

  function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }
  function money(n) {
    return `฿${Number(n).toLocaleString("th-TH", { maximumFractionDigits: 0 })}`;
  }
  function roleLabel(role) {
    return { owner: "เจ้าของร้าน", admin: "แอดมิน", staff: "พนักงาน" }[role] || role;
  }

  // ---------------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------------
  el.tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      el.tabBtns.forEach((b) => b.classList.remove("active"));
      el.views.forEach((v) => v.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(btn.dataset.view).classList.add("active");
      if (btn.dataset.view === "invitesView") loadInvites();
    });
  });

  el.logoutBtn.addEventListener("click", () => {
    AdminAPI.clearToken();
    window.location.href = "login.html";
  });

  // ---------------------------------------------------------------------
  // Boot: verify session, load branches, load today's orders
  // ---------------------------------------------------------------------
  (async function init() {
    try {
      const { admin } = await AdminAPI.me();
      currentAdmin = admin;
      el.adminLabel.textContent = `${admin.name || admin.email} (${roleLabel(admin.role)})`;
      if (!["owner", "admin"].includes(admin.role)) {
        el.invitesTabBtn.style.display = "none";
      }
    } catch {
      window.location.href = "login.html";
      return;
    }

    try {
      const { branches } = await AdminAPI.getBranches();
      for (const b of branches) {
        const opt = document.createElement("option");
        opt.value = b.id;
        opt.textContent = b.name_th;
        el.branchFilter.appendChild(opt);
      }
    } catch {
      /* non-fatal: branch filter just stays at "all" */
    }

    el.dateFilter.value = new Date().toISOString().slice(0, 10);
    loadOrders();
  })();

  // ---------------------------------------------------------------------
  // Orders
  // ---------------------------------------------------------------------
  [el.branchFilter, el.statusFilter, el.dateFilter].forEach((input) =>
    input.addEventListener("change", loadOrders)
  );
  el.refreshOrdersBtn.addEventListener("click", loadOrders);

  async function loadOrders() {
    el.ordersList.innerHTML = '<p class="empty-state">กำลังโหลด...</p>';
    try {
      const params = { date: el.dateFilter.value };
      if (el.branchFilter.value) params.branch_id = el.branchFilter.value;
      if (el.statusFilter.value) params.status = el.statusFilter.value;

      const { orders } = await AdminAPI.listOrders(params);
      renderOrders(orders);
    } catch (err) {
      el.ordersList.innerHTML = `<p class="empty-state">โหลดออเดอร์ไม่สำเร็จ: ${escapeHtml(err.message)}</p>`;
    }
  }

  const STATUS_LABEL = { pending: "รอชำระ", paid: "ชำระแล้ว", cancelled: "ยกเลิก" };

  function renderOrders(orders) {
    if (orders.length === 0) {
      el.ordersList.innerHTML = '<p class="empty-state">ไม่มีออเดอร์ในวันนี้</p>';
      return;
    }

    el.ordersList.innerHTML = orders
      .map((o) => {
        const itemsText = o.items.map((i) => `${escapeHtml(i.name)} <span>x${i.quantity}</span>`).join(", ");
        const dineLabel = o.dine_type === "dine_in" ? `ทานที่ร้าน${o.table_number ? ` · โต๊ะ ${escapeHtml(o.table_number)}` : ""}` : "กลับบ้าน";
        const payLabel = o.payment_method === "promptpay" ? "พร้อมเพย์" : "เงินสด";
        const time = o.opened_at ? o.opened_at.slice(11, 16) : "";

        return `
        <div class="order-card" data-order="${o.id}">
          <div class="order-card-head">
            <span class="order-code">${escapeHtml(o.order_code)}</span>
            <span class="status-pill status-${o.payment_status}">${STATUS_LABEL[o.payment_status]}</span>
          </div>
          <div class="order-meta">${escapeHtml(o.branch_name_th)} · ${dineLabel} · ${payLabel} · ${time}</div>
          <div class="order-items-list">${itemsText}</div>
          <div class="order-card-foot">
            <span class="order-total">${money(o.total)}</span>
            <div class="order-actions">
              ${
                o.payment_status === "pending"
                  ? `<button class="action-btn pay" data-mark-paid="${o.id}">ยืนยันชำระแล้ว</button>
                     <button class="action-btn cancel" data-cancel="${o.id}">ยกเลิก</button>`
                  : ""
              }
            </div>
          </div>
        </div>`;
      })
      .join("");

    el.ordersList.querySelectorAll("[data-mark-paid]").forEach((btn) => {
      btn.addEventListener("click", () => updateStatus(btn.dataset.markPaid, "paid"));
    });
    el.ordersList.querySelectorAll("[data-cancel]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (confirm("ยืนยันยกเลิกออเดอร์นี้?")) updateStatus(btn.dataset.cancel, "cancelled");
      });
    });
  }

  async function updateStatus(orderId, status) {
    try {
      await AdminAPI.updateOrderStatus(orderId, status);
      loadOrders();
    } catch (err) {
      alert("อัปเดตสถานะไม่สำเร็จ: " + err.message);
    }
  }

  // ---------------------------------------------------------------------
  // Invites
  // ---------------------------------------------------------------------
  el.inviteForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    el.createInviteBtn.disabled = true;
    el.inviteLinkBox.classList.add("hidden");

    try {
      const { invite } = await AdminAPI.createInvite({
        email: el.inviteEmail.value.trim(),
        role: el.inviteRole.value,
      });
      const link = `${window.location.origin}${window.location.pathname.replace("index.html", "")}accept-invite.html?token=${invite.token}`;
      el.inviteLinkBox.innerHTML = `ส่งลิงก์นี้ให้ <strong>${escapeHtml(invite.email)}</strong>:<br>${escapeHtml(link)}`;
      el.inviteLinkBox.classList.remove("hidden");
      el.inviteForm.reset();
      loadInvites();
    } catch (err) {
      alert("สร้างคำเชิญไม่สำเร็จ: " + err.message);
    } finally {
      el.createInviteBtn.disabled = false;
    }
  });

  async function loadInvites() {
    el.invitesList.innerHTML = '<p class="empty-state">กำลังโหลด...</p>';
    try {
      const { invites } = await AdminAPI.listInvites();
      if (invites.length === 0) {
        el.invitesList.innerHTML = '<p class="empty-state">ยังไม่มีคำเชิญ</p>';
        return;
      }
      el.invitesList.innerHTML = invites
        .map((inv) => {
          const statusText = inv.used_at
            ? "ใช้แล้ว"
            : new Date(inv.expires_at).getTime() < Date.now()
              ? "หมดอายุ"
              : "รอรับคำเชิญ";
          return `
            <div class="invite-row">
              <span>${escapeHtml(inv.email)} · ${roleLabel(inv.role)}</span>
              <span class="invite-row-status">${statusText}</span>
            </div>`;
        })
        .join("");
    } catch (err) {
      el.invitesList.innerHTML = `<p class="empty-state">โหลดคำเชิญไม่สำเร็จ: ${escapeHtml(err.message)}</p>`;
    }
  }
})();
