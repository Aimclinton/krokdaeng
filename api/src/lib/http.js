/**
 * Shared HTTP helpers: JSON responses with CORS enabled for the LIFF app
 * and admin console (both served from different origins than the Worker).
 */

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

export function json(data, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("Content-Type", "application/json; charset=utf-8");
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function errorResponse(message, status = 400, extra = {}) {
  return json({ ok: false, error: message, ...extra }, { status });
}

export function notFound(path) {
  return errorResponse("not_found", 404, { path });
}

export function handleOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
