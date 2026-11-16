/**
 * Thin fetch wrapper for the Admin Console, carrying the session token
 * from localStorage as a Bearer header on every call.
 */
const AdminAPI = (() => {
  const BASE = window.KROKDAENG_ADMIN_CONFIG.API_BASE;
  const TOKEN_KEY = "krokdaeng_admin_token";

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
  }
  function setToken(token) {
    try { localStorage.setItem(TOKEN_KEY, token); } catch { /* ignore */ }
  }
  function clearToken() {
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  }

  async function request(path, options = {}) {
    const token = getToken();
    const res = await fetch(`${BASE}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      clearToken();
    }
    if (!res.ok || data.ok === false) {
      const err = new Error(data.error || `request_failed_${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  return {
    getToken,
    setToken,
    clearToken,
    isLoggedIn: () => !!getToken(),

    bootstrap: (payload) => request("/api/admin/bootstrap", { method: "POST", body: JSON.stringify(payload) }),
    login: (payload) => request("/api/admin/login", { method: "POST", body: JSON.stringify(payload) }),
    me: () => request("/api/admin/me"),
    getInvite: (token) => request(`/api/admin/invites/${encodeURIComponent(token)}`),
    acceptInvite: (token, payload) =>
      request(`/api/admin/invites/${encodeURIComponent(token)}/accept`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    createInvite: (payload) => request("/api/admin/invites", { method: "POST", body: JSON.stringify(payload) }),
    listInvites: () => request("/api/admin/invites"),

    listOrders: (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return request(`/api/admin/orders${qs ? `?${qs}` : ""}`);
    },
    updateOrderStatus: (id, payment_status) =>
      request(`/api/admin/orders/${id}`, { method: "PATCH", body: JSON.stringify({ payment_status }) }),

    getBranches: () => request("/api/branches"),
  };
})();
