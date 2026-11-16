/**
 * krokdaeng-api — Cloudflare Worker
 *
 * This is a placeholder entry point so the project deploys end-to-end
 * (Pages <-> GitHub <-> Worker) before the real routes are built.
 * Routes will be added incrementally:
 *   GET  /api/branches
 *   GET  /api/menu?branch_id=...
 *   POST /api/orders
 *   GET  /api/orders/:id
 *   POST /api/admin/login
 *   ...
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({ ok: true, service: "krokdaeng-api" });
    }

    return Response.json(
      { ok: false, error: "not_found", path: url.pathname },
      { status: 404 }
    );
  },
};
