/**
 * krokdaeng-api — Cloudflare Worker
 *
 * Routes:
 *   GET  /api/health
 *   GET  /api/branches
 *   GET  /api/branches/:id
 *   GET  /api/menu?branch_id=...
 *   GET  /api/images/:key              (streams a photo out of R2)
 *   POST /api/orders
 *   GET  /api/orders/:id
 *   POST /api/admin/bootstrap          (first owner only, works once)
 *   POST /api/admin/login
 *   GET  /api/admin/me
 *   POST /api/admin/invites            (owner/admin, authenticated)
 *   GET  /api/admin/invites            (owner/admin, authenticated)
 *   GET  /api/admin/invites/:token
 *   POST /api/admin/invites/:token/accept
 *   GET  /api/admin/orders             (authenticated, branch-scoped)
 *   PATCH /api/admin/orders/:id        (authenticated, branch-scoped)
 */
import { json, notFound, handleOptions } from "./lib/http.js";
import { listBranches, getBranch } from "./routes/branches.js";
import { getMenu } from "./routes/menu.js";
import {
  createOrder,
  getOrder,
  listOrdersAdmin,
  updateOrderStatus,
} from "./routes/orders.js";
import {
  bootstrap,
  login,
  me,
  createInvite,
  listInvites,
  getInvite,
  acceptInvite,
} from "./routes/admin.js";
import { getImage } from "./routes/images.js";

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

    const imageMatch = pathname.match(/^\/api\/images\/(.+)$/);
    if (imageMatch && method === "GET") {
      return getImage(request, env, decodeURIComponent(imageMatch[1]));
    }

    if (pathname === "/api/admin/bootstrap" && method === "POST") {
      return bootstrap(request, env);
    }

    if (pathname === "/api/admin/login" && method === "POST") {
      return login(request, env);
    }

    if (pathname === "/api/admin/me" && method === "GET") {
      return me(request, env);
    }

    if (pathname === "/api/admin/invites" && method === "POST") {
      return createInvite(request, env);
    }
    if (pathname === "/api/admin/invites" && method === "GET") {
      return listInvites(request, env);
    }

    if (pathname === "/api/admin/orders" && method === "GET") {
      return listOrdersAdmin(request, env);
    }

    const adminOrderMatch = pathname.match(/^\/api\/admin\/orders\/(\d+)$/);
    if (adminOrderMatch && method === "PATCH") {
      return updateOrderStatus(request, env, Number(adminOrderMatch[1]));
    }

    const inviteMatch = pathname.match(/^\/api\/admin\/invites\/([^/]+)$/);
    if (inviteMatch && method === "GET") {
      return getInvite(request, env, inviteMatch[1]);
    }

    const acceptMatch = pathname.match(/^\/api\/admin\/invites\/([^/]+)\/accept$/);
    if (acceptMatch && method === "POST") {
      return acceptInvite(request, env, acceptMatch[1]);
    }

    return notFound(pathname);
  },
};
