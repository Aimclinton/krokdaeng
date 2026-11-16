/**
 * Password hashing (PBKDF2-SHA256 via Web Crypto) and signed session tokens
 * (a minimal HS256 JWT) for the admin console. No external dependencies —
 * Cloudflare Workers expose the standard SubtleCrypto API.
 */

const PBKDF2_ITERATIONS = 100_000;
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function randomHex(byteLength) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

/** Generates a random token suitable for an invite link (URL-safe). */
export function generateInviteToken() {
  return randomHex(32);
}

async function pbkdf2(password, saltBytes, iterations) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes, iterations, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return toHex(derived);
}

/** Hashes a password into a storable "iterations:saltHex:hashHex" string. */
export async function hashPassword(password) {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const hashHex = await pbkdf2(password, saltBytes, PBKDF2_ITERATIONS);
  return `${PBKDF2_ITERATIONS}:${toHex(saltBytes)}:${hashHex}`;
}

/** Verifies a password against a stored "iterations:saltHex:hashHex" string. */
export async function verifyPassword(password, stored) {
  if (!stored) return false;
  const [iterationsStr, saltHex, hashHex] = stored.split(":");
  const iterations = Number(iterationsStr);
  if (!iterations || !saltHex || !hashHex) return false;
  const candidate = await pbkdf2(password, fromHex(saltHex), iterations);
  return timingSafeEqual(candidate, hashHex);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function base64UrlEncode(input) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str) {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacSign(data, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return base64UrlEncode(signature);
}

/**
 * Signs a minimal HS256 JWT for an admin session.
 * Payload gets `iat`/`exp` added automatically.
 */
export async function signSession(payload, secret) {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now, exp: now + SESSION_TTL_SECONDS };

  const headerPart = base64UrlEncode(JSON.stringify(header));
  const payloadPart = base64UrlEncode(JSON.stringify(fullPayload));
  const signature = await hmacSign(`${headerPart}.${payloadPart}`, secret);

  return `${headerPart}.${payloadPart}.${signature}`;
}

/** Verifies and decodes a session JWT. Returns the payload, or null if invalid/expired. */
export async function verifySession(token, secret) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, signaturePart] = parts;

  const expectedSignature = await hmacSign(`${headerPart}.${payloadPart}`, secret);
  if (expectedSignature !== signaturePart) return null;

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadPart)));
  } catch {
    return null;
  }

  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

/**
 * Reads the Bearer token from the request, verifies it, and loads the
 * matching active admin_users row. Returns the admin row (with branch_ids
 * resolved when branch_scope is 'specific'), or null if unauthenticated.
 */
export async function getAuthenticatedAdmin(request, env) {
  const authHeader = request.headers.get("Authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;

  const payload = await verifySession(match[1], env.ADMIN_INVITE_SECRET);
  if (!payload?.admin_id) return null;

  const admin = await env.DB.prepare(
    `SELECT id, email, name, role, branch_scope, is_active
     FROM admin_users WHERE id = ? AND is_active = 1`
  )
    .bind(payload.admin_id)
    .first();
  if (!admin) return null;

  if (admin.branch_scope === "specific") {
    const { results } = await env.DB.prepare(
      `SELECT branch_id FROM admin_user_branches WHERE admin_user_id = ?`
    )
      .bind(admin.id)
      .all();
    admin.branch_ids = results.map((r) => r.branch_id);
  } else {
    admin.branch_ids = null; // null = all branches
  }

  return admin;
}
