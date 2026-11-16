/**
 * krokdaeng-api — Cloudflare Worker
 *
 * Routes:
 *   GET  /api/health
 *   GET  /api/branches
 *   GET  /api/branches/:id
 *   GET  /api/menu?branch_id=...
 *   POST /api/orders
 *   GET  /api/orders/:id
 *   POST /api/admin/login        (not yet implemented)
 *   ...
 */
import { json, notFound, handleOptions } from "./lib/http.js";
import { listBranches, getBranch } from "./routes/branches.js";
import { getMenu } from "./routes/menu.js";
import { createOrder, getOrder } from "./routes/orders.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    if (method === "OPTIONS") {
      return handleOptions();
    }

    if (pathname === "/api/health") {
      return json({ ok: true, service: "krokdaeng-api" });
    }

    if (pathname === "/api/branches" && method === "GET") {
      return listBranches(request, env);
    }

    const branchMatch = pathname.match(/^\/api\/branches\/(\d+)$/);
    if (branchMatch && method === "GET") {
      return getBranch(request, env, Number(branchMatch[1]));
    }

    if (pathname === "/api/menu" && method === "GET") {
      return getMenu(request, env);
    }

    if (pathname === "/api/orders" && method === "POST") {
      return createOrder(request, env);
    }

    const orderMatch = pathname.match(/^\/api\/orders\/(\d+)$/);
    if (orderMatch && method === "GET") {
      return getOrder(request, env, Number(orderMatch[1]));
    }

    return notFound(pathname);
  },
};
