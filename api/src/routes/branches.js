import { json, errorResponse } from "../lib/http.js";

/**
 * GET /api/branches
 * Lists active branches. Used by the LIFF app's branch picker and by the
 * admin console's branch-scope selectors.
 */
export async function listBranches(request, env) {
  const { results } = await env.DB.prepare(
    `SELECT id, name_th, name_en, address, phone, hours_text,
            lat, lng, gmaps_url, is_active
     FROM branches
     WHERE is_active = 1
     ORDER BY id ASC`
  ).all();

  return json({ ok: true, branches: results });
}

/**
 * GET /api/branches/:id
 */
export async function getBranch(request, env, id) {
  const branch = await env.DB.prepare(
    `SELECT id, name_th, name_en, address, phone, hours_text,
            lat, lng, gmaps_url, is_active
     FROM branches WHERE id = ?`
  )
    .bind(id)
    .first();

  if (!branch) return errorResponse("branch_not_found", 404);
  return json({ ok: true, branch });
}
