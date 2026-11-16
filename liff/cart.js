/**
 * Cart state for one ordering session. Persisted to localStorage as a
 * per-viewer convenience only (so a reload doesn't lose the cart) — the
 * source of truth for prices is always re-resolved from the live menu
 * data in app.js before checkout, never trusted from storage.
 */
const KrokdaengCart = (() => {
  const STORAGE_KEY = "krokdaeng_cart_v1";
  let lines = [];

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      lines = raw ? JSON.parse(raw) : [];
    } catch {
      lines = [];
    }
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    } catch {
      /* ignore — storage may be unavailable (private mode, quota) */
    }
  }

  function makeLineId() {
    return `l_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  load();

  return {
    getLines: () => lines.slice(),

    addLine({ menuItemId, quantity, note, selectedOptionIds }) {
      lines.push({
        lineId: makeLineId(),
        menuItemId,
        quantity,
        note: note || "",
        selectedOptionIds: selectedOptionIds || [],
      });
      persist();
    },

    updateQuantity(lineId, quantity) {
      const line = lines.find((l) => l.lineId === lineId);
      if (!line) return;
      if (quantity <= 0) {
        lines = lines.filter((l) => l.lineId !== lineId);
      } else {
        line.quantity = quantity;
      }
      persist();
    },

    removeLine(lineId) {
      lines = lines.filter((l) => l.lineId !== lineId);
      persist();
    },

    clear() {
      lines = [];
      persist();
    },

    count() {
      return lines.reduce((sum, l) => sum + l.quantity, 0);
    },
  };
})();
