import { json, errorResponse } from "../lib/http.js";
import {
  hashPassword,
  verifyPassword,
  signSession,
  generateInviteToken,
  getAuthenticatedAdmin,
} from "../lib/auth.js";

const INVITE_TTL_DAYS = 7;

/**
 * POST /api/admin/login
 * Body: { email, password }
 */
export async function login(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid JSON body", 400);
  }

  const { email, password } = body;
  if (!email || !password) {
    return errorResponse("email and password are required", 400);
  }

  const admin = await env.DB.prepare(
    `SELECT id, email, name, password_hash, role, branch_scope, is_active
     FROM admin_users WHERE email = ?`
  )
    .bind(email.trim().toLowerCase())
    .first();

  if (!admin || !admin.is_active || !(await verifyPassword(password, admin.password_hash))) {
    return errorResponse("invalid_credentials", 401);
  }

  const token = await signSession({ admin_id: admin.id }, env.ADMIN_INVITE_SECRET);

  return json({
    ok: true,
    token,
    admin: {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: admin.role,
      branch_scope: admin.branch_scope,
    },
  });
}

/**
 * POST /api/admin/bootstrap
 * Body: { email, password, name? }
 * Creates the very first owner account. Only works while admin_users is
 * empty — this is how the system gets its first admin without a
 * chicken-and-egg invite. Returns 403 once any admin exists; use the
 * normal invite flow from then on.
 */
export async function bootstrap(request, env) {
  const { cnt } = await env.DB.prepare(`SELECT COUNT(*) AS cnt FROM admin_users`).first();
  if (cnt > 0) {
    return errorResponse("already_bootstrapped: use the invite flow instead", 403);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid JSON body", 400);
  }

  const email = (body.email || "").trim().toLowerCase();
  const { password, name } = body;
  if (!email) return errorResponse("email is required", 400);
  if (!password || password.length < 8) {
    return errorResponse("password must be at least 8 characters", 400);
  }

  const passwordHash = await hashPassword(password);
  const inserted = await env.DB.prepare(
    `INSERT INTO admin_users (email, name, password_hash, role, branch_scope)
     VALUES (?, ?, ?, 'owner', 'all')`
  )
    .bind(email, name || null, passwordHash)
    .run();

  const adminId = inserted.meta.last_row_id;
  const token = await signSession({ admin_id: adminId }, env.ADMIN_INVITE_SECRET);

  return json(
    {
      ok: true,
      token,
      admin: { id: adminId, email, name: name || null, role: "owner" },
    },
    { status: 201 }
  );
}

/**
 * GET /api/admin/me — resolves the current session token to its admin.
 * Lets the console verify a stored token is still valid on load.
 */
export async function me(request, env) {
  const admin = await getAuthenticatedAdmin(request, env);
  if (!admin) return errorResponse("unauthorized", 401);
  return json({ ok: true, admin });
}

/**
 * POST /api/admin/invites
 * Body: { email, role?, branch_scope?, branch_ids?: [] }
 * Requires an authenticated owner/admin. Returns the invite link for the
 * caller to share manually (no outbound email integration yet).
 */
export async function createInvite(request, env) {
  const caller = await getAuthenticatedAdmin(request, env);
  if (!caller) return errorResponse("unauthorized", 401);
  if (!["owner", "admin"].includes(caller.role)) {
    return errorResponse("forbidden: only owner/admin can invite", 403);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid JSON body", 400);
  }

  const email = (body.email || "").trim().toLowerCase();
  if (!email) return errorResponse("email is required", 400);

  const role = body.role || "staff";
  if (!["owner", "admin", "staff"].includes(role)) {
    return errorResponse("invalid role", 400);
  }
  // Only an owner may grant the owner role.
  if (role === "owner" && caller.role !== "owner") {
    return errorResponse("forbidden: only an owner can invite another owner", 403);
  }

  const branchScope = body.branch_scope === "specific" ? "specific" : "all";
  const branchIds = Array.isArray(body.branch_ids) ? body.branch_ids : [];
  if (branchScope === "specific" && branchIds.length === 0) {
    return errorResponse("branch_ids is required when branch_scope is 'specific'", 400);
  }

  const existing = await env.DB.prepare(`SELECT id FROM admin_users WHERE email = ?`)
    .bind(email)
    .first();
  if (existing) return errorResponse("an admin with this email already exists", 409);

  const token = generateInviteToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86400 * 1000).toISOString();

  const inserted = await env.DB.prepare(
    `INSERT INTO admin_invites (email, token, role, branch_scope, expires_at)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(email, token, role, branchScope, expiresAt)
    .run();

  const inviteId = inserted.meta.last_row_id;

  if (branchScope === "specific") {
    const statements = branchIds.map((branchId) =>
      env.DB.prepare(
        `INSERT INTO admin_invite_branches (invite_id, branch_id) VALUES (?, ?)`
      ).bind(inviteId, branchId)
    );
    await env.DB.batch(statements);
  }

  return json(
    {
      ok: true,
      invite: {
        id: inviteId,
        email,
        role,
        branch_scope: branchScope,
        branch_ids: branchScope === "specific" ? branchIds : null,
        token,
        expires_at: expiresAt,
        accept_path: `/admin/accept-invite?token=${token}`,
      },
    },
    { status: 201 }
  );
}

/**
 * GET /api/admin/invites/:token
 * Public: lets the accept-invite page confirm the link is still valid
 * before asking the person to set a password.
 */
export async function getInvite(request, env, token) {
  const invite = await env.DB.prepare(
    `SELECT id, email, role, expires_at, used_at FROM admin_invites WHERE token = ?`
  )
    .bind(token)
    .first();

  if (!invite) return errorResponse("invite_not_found", 404);
  if (invite.used_at) return errorResponse("invite_already_used", 410);
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    return errorResponse("invite_expired", 410);
  }

  return json({ ok: true, invite: { email: invite.email, role: invite.role } });
}

/**
 * POST /api/admin/invites/:token/accept
 * Body: { name, password }
 * Creates the admin_users row, copies branch scope from the invite, and
 * marks the invite used. Returns a session token so the new admin lands
 * straight in the console.
 */
export async function acceptInvite(request, env, token) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid JSON body", 400);
  }

  const { name, password } = body;
  if (!password || password.length < 8) {
    return errorResponse("password must be at least 8 characters", 400);
  }

  const invite = await env.DB.prepare(`SELECT * FROM admin_invites WHERE token = ?`)
    .bind(token)
    .first();
  if (!invite) return errorResponse("invite_not_found", 404);
  if (invite.used_at) return errorResponse("invite_already_used", 410);
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    return errorResponse("invite_expired", 410);
  }

  const existing = await env.DB.prepare(`SELECT id FROM admin_users WHERE email = ?`)
    .bind(invite.email)
    .first();
  if (existing) return errorResponse("an admin with this email already exists", 409);

  const passwordHash = await hashPassword(password);

  const inserted = await env.DB.prepare(
    `INSERT INTO admin_users (email, name, password_hash, role, branch_scope)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(invite.email, name || null, passwordHash, invite.role, invite.branch_scope)
    .run();

  const adminId = inserted.meta.last_row_id;

  if (invite.branch_scope === "specific") {
    const { results: inviteBranches } = await env.DB.prepare(
      `SELECT branch_id FROM admin_invite_branches WHERE invite_id = ?`
    )
      .bind(invite.id)
      .all();
    if (inviteBranches.length > 0) {
      const statements = inviteBranches.map((row) =>
        env.DB.prepare(
          `INSERT INTO admin_user_branches (admin_user_id, branch_id) VALUES (?, ?)`
        ).bind(adminId, row.branch_id)
      );
      await env.DB.batch(statements);
    }
  }

  await env.DB.prepare(`UPDATE admin_invites SET used_at = datetime('now') WHERE id = ?`)
    .bind(invite.id)
    .run();

  const sessionToken = await signSession({ admin_id: adminId }, env.ADMIN_INVITE_SECRET);

  return json(
    {
      ok: true,
      token: sessionToken,
      admin: { id: adminId, email: invite.email, name: name || null, role: invite.role },
    },
    { status: 201 }
  );
}
