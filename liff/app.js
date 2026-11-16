/**
 * krokdaeng LIFF ordering app — single-page flow:
 * menu browse -> item options sheet -> cart sheet -> checkout -> confirmation.
 */
(function () {
  const cfg = window.KROKDAENG_CONFIG;

  const state = {
    branchId: cfg.DEFAULT_BRANCH_ID,
    branchName: "",
    categories: [], // full menu tree from GET /api/menu
    itemsById: new Map(),
    lineProfile: null, // { userId, displayName, pictureUrl } once LIFF resolves it
  };

  const el = {
    branchName: document.getElementById("branchName"),
    loadingState: document.getElementById("loadingState"),
    errorState: document.getElementById("errorState"),
    errorMessage: document.getElementById("errorMessage"),
    retryBtn: document.getElementById("retryBtn"),
    categoryTabs: document.getElementById("categoryTabs"),
    menuList: document.getElementById("menuList"),
    cartBar: document.getElementById("cartBar"),
    cartCount: document.getElementById("cartCount"),
    cartTotal: document.getElementById("cartTotal"),
    itemSheetOverlay: document.getElementById("itemSheetOverlay"),
    itemSheet: document.getElementById("itemSheet"),
    cartSheetOverlay: document.getElementById("cartSheetOverlay"),
    cartSheet: document.getElementById("cartSheet"),
    confirmScreen: document.getElementById("confirmScreen"),
  };

  function money(n) {
    return `฿${Number(n).toLocaleString("th-TH", { maximumFractionDigits: 0 })}`;
  }

  function show(elm) { elm.classList.remove("hidden"); }
  function hide(elm) { elm.classList.add("hidden"); }

  // ---------------------------------------------------------------------
  // LIFF bootstrap (best-effort — the app still works outside LINE)
  // ---------------------------------------------------------------------
  async function initLiff() {
    try {
      if (!window.liff || cfg.LIFF_ID === "YOUR-LIFF-ID") return;
      await liff.init({ liffId: cfg.LIFF_ID });
      if (liff.isLoggedIn()) {
        const profile = await liff.getProfile();
        state.lineProfile = {
          userId: profile.userId,
          displayName: profile.displayName,
          pictureUrl: profile.pictureUrl,
        };
      }
    } catch (err) {
      console.warn("LIFF init skipped:", err);
    }
  }

  // ---------------------------------------------------------------------
  // Load menu
  // ---------------------------------------------------------------------
  async function loadMenu() {
    hide(el.errorState);
    show(el.loadingState);
    hide(el.categoryTabs);
    hide(el.menuList);

    try {
      const data = await KrokdaengAPI.getMenu(state.branchId);
      state.categories = data.categories;
      state.itemsById = new Map();
      for (const cat of state.categories) {
        for (const item of cat.items) {
          state.itemsById.set(item.id, item);
        }
      }

      const branches = await KrokdaengAPI.getBranches().catch(() => ({ branches: [] }));
      const branch = (branches.branches || []).find((b) => b.id === state.branchId);
      state.branchName = branch ? branch.name_th : "";
      el.branchName.textContent = state.branchName || "";

      renderCategoryTabs();
      renderMenuList();
      hide(el.loadingState);
      show(el.categoryTabs);
      show(el.menuList);
      updateCartBar();
    } catch (err) {
      hide(el.loadingState);
      el.errorMessage.textContent =
        err.status === 404
          ? "ไม่พบสาขานี้ หรือยังไม่เปิดให้สั่งตอนนี้"
          : "โหลดเมนูไม่สำเร็จ กรุณาลองใหม่";
      show(el.errorState);
    }
  }

  function renderCategoryTabs() {
    el.categoryTabs.innerHTML = state.categories
      .map((cat) => `<button class="tab" data-cat="${cat.id}">${escapeHtml(cat.name_th)}</button>`)
      .join("");
    el.categoryTabs.querySelectorAll(".tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = document.getElementById(`cat-${btn.dataset.cat}`);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  function renderMenuList() {
    el.menuList.innerHTML = state.categories
      .map(
        (cat) => `
        <section class="category-section" id="cat-${cat.id}">
          <h2 class="category-title">${escapeHtml(cat.name_th)}</h2>
          <div class="item-grid">
            ${cat.items.map(renderItemCard).join("")}
          </div>
        </section>`
      )
      .join("");

    el.menuList.querySelectorAll("[data-item]").forEach((card) => {
      card.addEventListener("click", () => openItemSheet(Number(card.dataset.item)));
    });
  }

  function renderItemCard(item) {
    const imgUrl = KrokdaengAPI.imageUrl(item.image_key);
    const badge = item.is_signature
      ? '<span class="badge badge-signature">ซิกเนเจอร์</span>'
      : item.is_bestseller
        ? '<span class="badge badge-bestseller">ขายดี</span>'
        : "";
    return `
      <button class="item-card" data-item="${item.id}" type="button">
        <div class="item-photo">
          ${
            imgUrl
              ? `<img src="${imgUrl}" alt="${escapeHtml(item.name_th)}" loading="lazy"
                   onerror="this.closest('.item-photo').classList.add('no-photo'); this.remove();" />`
              : ""
          }
          <span class="item-photo-fallback">🍽️</span>
          ${badge}
        </div>
        <div class="item-info">
          <div class="item-name">${escapeHtml(item.name_th)}</div>
          <div class="item-price">${money(item.base_price)}</div>
        </div>
      </button>`;
  }

  function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  // ---------------------------------------------------------------------
  // Item options sheet
  // ---------------------------------------------------------------------
  function openItemSheet(itemId, existingLine) {
    const item = state.itemsById.get(itemId);
    if (!item) return;

    const selected = new Map(); // group_id -> Set(option_id)
    for (const group of item.option_groups) {
      selected.set(group.id, new Set(existingLine ? existingLine.selectedOptionIds.filter((id) => group.options.some((o) => o.id === id)) : []));
      if (!existingLine) {
        const defaults = group.options.filter((o) => o.is_default).map((o) => o.id);
        if (defaults.length > 0) selected.set(group.id, new Set(defaults));
      }
    }

    let quantity = existingLine ? existingLine.quantity : 1;
    let note = existingLine ? existingLine.note : "";

    function computeUnitPrice() {
      let total = item.base_price;
      for (const group of item.option_groups) {
        for (const optId of selected.get(group.id) || []) {
          const opt = group.options.find((o) => o.id === optId);
          if (opt) total += opt.price_delta;
        }
      }
      return total;
    }

    function render() {
      const unitPrice = computeUnitPrice();
      el.itemSheet.innerHTML = `
        <div class="sheet-handle"></div>
        <button class="sheet-close" id="itemSheetClose" type="button">✕</button>
        <h3 class="sheet-title">${escapeHtml(item.name_th)}</h3>
        ${item.description ? `<p class="sheet-desc">${escapeHtml(item.description)}</p>` : ""}
        <div class="sheet-body">
          ${item.option_groups.map((group) => renderOptionGroup(group)).join("")}
          <div class="form-row">
            <label class="form-label">หมายเหตุ (ถ้ามี)</label>
            <input type="text" id="itemNote" class="text-input" placeholder="เช่น ไม่ใส่ผัก, เผ็ดน้อย" value="${escapeHtml(note)}" />
          </div>
        </div>
        <div class="sheet-footer">
          <div class="qty-stepper">
            <button type="button" id="qtyMinus" class="qty-btn">−</button>
            <span id="qtyValue">${quantity}</span>
            <button type="button" id="qtyPlus" class="qty-btn">+</button>
          </div>
          <button type="button" id="addToCartBtn" class="btn btn-primary btn-wide">
            เพิ่มลงตะกร้า · ${money(unitPrice * quantity)}
          </button>
        </div>`;

      document.getElementById("itemSheetClose").addEventListener("click", closeItemSheet);
      document.getElementById("qtyMinus").addEventListener("click", () => {
        if (quantity > 1) { quantity--; render(); }
      });
      document.getElementById("qtyPlus").addEventListener("click", () => {
        quantity++; render();
      });
      document.getElementById("itemNote").addEventListener("input", (e) => { note = e.target.value; });

      for (const group of item.option_groups) {
        el.itemSheet.querySelectorAll(`[data-group="${group.id}"]`).forEach((input) => {
          input.addEventListener("change", () => {
            const optId = Number(input.value);
            const set = selected.get(group.id);
            if (input.type === "radio") {
              set.clear();
              set.add(optId);
            } else if (input.checked) {
              if (group.max_select && set.size >= group.max_select) {
                input.checked = false;
                return;
              }
              set.add(optId);
            } else {
              set.delete(optId);
            }
            render();
          });
        });
      }

      document.getElementById("addToCartBtn").addEventListener("click", () => {
        const missingRequired = item.option_groups.find(
          (g) => g.is_required && (selected.get(g.id) || new Set()).size === 0
        );
        if (missingRequired) {
          alert(`กรุณาเลือก "${missingRequired.name_th}"`);
          return;
        }

        if (existingLine) KrokdaengCart.removeLine(existingLine.lineId);
        const selectedOptionIds = item.option_groups.flatMap((g) => [...(selected.get(g.id) || [])]);
        KrokdaengCart.addLine({ menuItemId: item.id, quantity, note, selectedOptionIds });
        closeItemSheet();
        updateCartBar();
      });
    }

    function renderOptionGroup(group) {
      const inputType = group.is_multi_select ? "checkbox" : "radio";
      const requiredLabel = group.is_required
        ? '<span class="required-tag">จำเป็น</span>'
        : '<span class="optional-tag">เลือกได้</span>';
      return `
        <div class="option-group">
          <div class="option-group-title">${escapeHtml(group.name_th)} ${requiredLabel}</div>
          ${group.options
            .map((opt) => {
              const checked = (selected.get(group.id) || new Set()).has(opt.id) ? "checked" : "";
              const priceLabel =
                opt.price_delta > 0 ? ` (+${money(opt.price_delta)})` : opt.price_delta < 0 ? ` (${money(opt.price_delta)})` : "";
              return `
                <label class="option-row">
                  <input type="${inputType}" name="group-${group.id}" data-group="${group.id}" value="${opt.id}" ${checked} />
                  <span>${escapeHtml(opt.name_th)}${priceLabel}</span>
                </label>`;
            })
            .join("")}
        </div>`;
    }

    render();
    show(el.itemSheetOverlay);
  }

  function closeItemSheet() {
    hide(el.itemSheetOverlay);
  }

  // ---------------------------------------------------------------------
  // Cart bar + cart sheet
  // ---------------------------------------------------------------------
  function resolveLineDisplay(line) {
    const item = state.itemsById.get(line.menuItemId);
    if (!item) return null;
    let unitPrice = item.base_price;
    const optionLabels = [];
    for (const group of item.option_groups) {
      for (const optId of line.selectedOptionIds) {
        const opt = group.options.find((o) => o.id === optId);
        if (opt) {
          unitPrice += opt.price_delta;
          optionLabels.push(opt.name_th);
        }
      }
    }
    return {
      item,
      unitPrice,
      lineTotal: unitPrice * line.quantity,
      optionLabels,
    };
  }

  function cartSubtotal() {
    return KrokdaengCart.getLines().reduce((sum, line) => {
      const resolved = resolveLineDisplay(line);
      return sum + (resolved ? resolved.lineTotal : 0);
    }, 0);
  }

  function updateCartBar() {
    const count = KrokdaengCart.count();
    if (count === 0) {
      hide(el.cartBar);
      return;
    }
    el.cartCount.textContent = count;
    el.cartTotal.textContent = money(cartSubtotal());
    show(el.cartBar);
  }

  function renderCartSheet() {
    const lines = KrokdaengCart.getLines();
    const rows = lines
      .map((line) => {
        const resolved = resolveLineDisplay(line);
        if (!resolved) return "";
        return `
          <div class="cart-line" data-line="${line.lineId}">
            <div class="cart-line-main">
              <div class="cart-line-name">${escapeHtml(resolved.item.name_th)}</div>
              ${resolved.optionLabels.length ? `<div class="cart-line-opts">${escapeHtml(resolved.optionLabels.join(", "))}</div>` : ""}
              ${line.note ? `<div class="cart-line-note">หมายเหตุ: ${escapeHtml(line.note)}</div>` : ""}
              <button class="cart-line-edit" data-edit="${line.lineId}" type="button">แก้ไข</button>
            </div>
            <div class="cart-line-side">
              <div class="qty-stepper qty-stepper-sm">
                <button type="button" class="qty-btn" data-dec="${line.lineId}">−</button>
                <span>${line.quantity}</span>
                <button type="button" class="qty-btn" data-inc="${line.lineId}">+</button>
              </div>
              <div class="cart-line-price">${money(resolved.lineTotal)}</div>
            </div>
          </div>`;
      })
      .join("");

    el.cartSheet.innerHTML = `
      <div class="sheet-handle"></div>
      <button class="sheet-close" id="cartSheetClose" type="button">✕</button>
      <h3 class="sheet-title">ตะกร้าของคุณ</h3>
      <div class="sheet-body">
        ${rows || '<p class="empty-cart">ยังไม่มีรายการ</p>'}
      </div>
      ${
        lines.length > 0
          ? `
        <div class="sheet-footer sheet-footer-stacked">
          <div class="cart-subtotal-row">
            <span>ยอดรวม</span><span>${money(cartSubtotal())}</span>
          </div>
          <button type="button" id="goToCheckoutBtn" class="btn btn-primary btn-wide">ไปหน้าชำระเงิน</button>
        </div>`
          : ""
      }`;

    document.getElementById("cartSheetClose").addEventListener("click", closeCartSheet);
    el.cartSheet.querySelectorAll("[data-edit]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const line = lines.find((l) => l.lineId === btn.dataset.edit);
        closeCartSheet();
        openItemSheet(line.menuItemId, line);
      });
    });
    el.cartSheet.querySelectorAll("[data-inc]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const line = lines.find((l) => l.lineId === btn.dataset.inc);
        KrokdaengCart.updateQuantity(line.lineId, line.quantity + 1);
        renderCartSheet();
        updateCartBar();
      });
    });
    el.cartSheet.querySelectorAll("[data-dec]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const line = lines.find((l) => l.lineId === btn.dataset.dec);
        KrokdaengCart.updateQuantity(line.lineId, line.quantity - 1);
        renderCartSheet();
        updateCartBar();
      });
    });
    const checkoutBtn = document.getElementById("goToCheckoutBtn");
    if (checkoutBtn) checkoutBtn.addEventListener("click", openCheckoutSheet);
  }

  function openCartSheet() {
    renderCartSheet();
    show(el.cartSheetOverlay);
  }
  function closeCartSheet() {
    hide(el.cartSheetOverlay);
  }

  el.cartBar.addEventListener("click", openCartSheet);

  // ---------------------------------------------------------------------
  // Checkout
  // ---------------------------------------------------------------------
  function openCheckoutSheet() {
    closeCartSheet();
    let dineType = "dine_in";
    let paymentMethod = "cash";
    let tableNumber = "";

    function render() {
      el.cartSheet.innerHTML = `
        <div class="sheet-handle"></div>
        <button class="sheet-close" id="checkoutClose" type="button">✕</button>
        <h3 class="sheet-title">ยืนยันคำสั่งซื้อ</h3>
        <div class="sheet-body">
          <div class="form-row">
            <label class="form-label">รูปแบบการรับอาหาร</label>
            <div class="choice-row">
              <button type="button" class="choice-btn ${dineType === "dine_in" ? "active" : ""}" data-dine="dine_in">ทานที่ร้าน</button>
              <button type="button" class="choice-btn ${dineType === "takeaway" ? "active" : ""}" data-dine="takeaway">กลับบ้าน</button>
            </div>
          </div>
          ${
            dineType === "dine_in"
              ? `<div class="form-row">
                   <label class="form-label">หมายเลขโต๊ะ</label>
                   <input type="text" id="tableNumberInput" class="text-input" placeholder="เช่น A3" value="${escapeHtml(tableNumber)}" />
                 </div>`
              : ""
          }
          <div class="form-row">
            <label class="form-label">วิธีชำระเงิน</label>
            <div class="choice-row">
              <button type="button" class="choice-btn ${paymentMethod === "cash" ? "active" : ""}" data-pay="cash">เงินสด</button>
              <button type="button" class="choice-btn ${paymentMethod === "promptpay" ? "active" : ""}" data-pay="promptpay">พร้อมเพย์</button>
            </div>
            ${paymentMethod === "promptpay" ? '<p class="hint-text">พนักงานจะแสดง QR พร้อมเพย์ให้ที่ร้าน</p>' : ""}
          </div>
          <div class="cart-subtotal-row">
            <span>ยอดรวม</span><span>${money(cartSubtotal())}</span>
          </div>
        </div>
        <div class="sheet-footer">
          <button type="button" id="placeOrderBtn" class="btn btn-primary btn-wide">สั่งอาหาร</button>
        </div>`;

      document.getElementById("checkoutClose").addEventListener("click", closeCartSheet);
      el.cartSheet.querySelectorAll("[data-dine]").forEach((btn) =>
        btn.addEventListener("click", () => { dineType = btn.dataset.dine; render(); })
      );
      el.cartSheet.querySelectorAll("[data-pay]").forEach((btn) =>
        btn.addEventListener("click", () => { paymentMethod = btn.dataset.pay; render(); })
      );
      const tableInput = document.getElementById("tableNumberInput");
      if (tableInput) tableInput.addEventListener("input", (e) => { tableNumber = e.target.value; });

      document.getElementById("placeOrderBtn").addEventListener("click", submitOrder);
    }

    async function submitOrder() {
      const btn = document.getElementById("placeOrderBtn");
      btn.disabled = true;
      btn.textContent = "กำลังส่งคำสั่งซื้อ...";

      const items = KrokdaengCart.getLines().map((line) => ({
        menu_item_id: line.menuItemId,
        quantity: line.quantity,
        note: line.note || undefined,
        selected_options: line.selectedOptionIds,
      }));

      try {
        const payload = {
          branch_id: state.branchId,
          dine_type: dineType,
          payment_method: paymentMethod,
          table_number: dineType === "dine_in" ? tableNumber || undefined : undefined,
          items,
        };
        if (state.lineProfile) {
          payload.customer = {
            line_user_id: state.lineProfile.userId,
            display_name: state.lineProfile.displayName,
            picture_url: state.lineProfile.pictureUrl,
          };
        }

        const result = await KrokdaengAPI.createOrder(payload);
        KrokdaengCart.clear();
        updateCartBar();
        closeCartSheet();
        showConfirmation(result.order);
      } catch (err) {
        btn.disabled = false;
        btn.textContent = "สั่งอาหาร";
        alert(err.data?.error === "invalid or expired discount code" ? err.data.error : "สั่งอาหารไม่สำเร็จ: " + (err.message || "unknown_error"));
      }
    }

    render();
    show(el.cartSheetOverlay);
  }

  function showConfirmation(order) {
    document.getElementById("app").querySelectorAll(".category-tabs, .menu-list").forEach(hide);
    el.confirmScreen.innerHTML = `
      <div class="confirm-box">
        <div class="confirm-check">✓</div>
        <h2>สั่งอาหารสำเร็จ</h2>
        <p class="confirm-code">เลขที่ออเดอร์: <strong>${escapeHtml(order.order_code)}</strong></p>
        <p>ยอดรวม: <strong>${money(order.total)}</strong></p>
        <p class="hint-text">
          ${order.payment_method === "promptpay" ? "กรุณาชำระเงินผ่านพร้อมเพย์ที่หน้าร้าน" : "กรุณาชำระเงินสดที่หน้าร้าน"}
        </p>
        <button type="button" id="newOrderBtn" class="btn btn-primary btn-wide">สั่งเพิ่ม</button>
      </div>`;
    show(el.confirmScreen);
    document.getElementById("newOrderBtn").addEventListener("click", () => {
      hide(el.confirmScreen);
      show(el.categoryTabs);
      show(el.menuList);
    });
  }

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------
  el.retryBtn.addEventListener("click", loadMenu);

  (async function boot() {
    await initLiff();
    await loadMenu();
  })();
})();
