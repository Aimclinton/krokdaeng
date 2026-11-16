/**
 * Thin fetch wrapper around the krokdaeng Worker API.
 */
const KrokdaengAPI = (() => {
  const BASE = window.KROKDAENG_CONFIG.API_BASE;

  async function request(path, options = {}) {
    const res = await fetch(`${BASE}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      const err = new Error(data.error || `request_failed_${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  return {
    getBranches: () => request("/api/branches"),
    getMenu: (branchId) => request(`/api/menu?branch_id=${encodeURIComponent(branchId)}`),
    createOrder: (payload) =>
      request("/api/orders", { method: "POST", body: JSON.stringify(payload) }),
    getOrder: (id) => request(`/api/orders/${id}`),
    imageUrl: (key) =>
      key ? `${BASE}/api/images/${encodeURIComponent(key)}` : null,
  };
})();
