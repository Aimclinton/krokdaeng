import { json, errorResponse } from "../lib/http.js";
import { getAuthenticatedAdmin } from "../lib/auth.js";
import { notifyNewOrder } from "../lib/line.js";

/** Zero-pad an integer to `len` digits. */
function pad(n, len) {
  return String(n).padStart(len, "0");
}

/** Generates the next order_code for today, e.g. KD-20261116-0001. */
async function nextOrderCode(db) {
  const now = new Date();
  const ymd = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1, 2)}${pad(
    now.getUTCDate(),
    2
  )}`;
  const prefix = `KD-${ymd}-`;
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM orders WHERE order_code LIKE ? || '%'`
    )
    .bind(prefix)
    .first();
  const seq = (row?.cnt || 0) + 1;
  return `${prefix}${pad(seq, 4)}`;
}

/**
 * Finds a customer by LINE user id, creating one if it doesn't exist yet.
 * Returns the customer id, or null if no customer info was supplied
 * (e.g. an order placed without LINE login context).
 */
async function upsertCustomer(db, customer) {
  if (!customer?.line_user_id) return null;

  const existing = await db
    .prepare(`SELECT id FROM customers WHERE line_user_id = ?`)
    .bind(customer.line_user_id)
    .first();
  if (existing) {
    await db
      .prepare(
        `UPDATE customers SET display_name = ?, picture_url = ?, updated_at = datetime('now')
         WHERE id = ?`
      )
      .bind(customer.display_name || null, customer.picture_url || null, existing.id)
      .run();
    return existing.id;
  }

  const inserted = await db
    .prepare(
      `INSERT INTO customers (line_user_id, display_name, picture_url)
       VALUES (?, ?, ?)`
    )
    .bind(customer.line_user_id, customer.display_name || null, customer.picture_url || null)
    .run();
  return inserted.meta.last_row_id;
}

/**
 * Loads live pricing/validation data for a set of menu_item_ids:
 * base price, option groups (with required/min/max rules) and their options.
 * Used so the client's submitted prices are never trusted directly.
 */
async function loadPricingContext(db, menuItemIds) {
  const placeholders = menuItemIds.map(() => "?").join(",");

  const { results: menuItems } = await db
    .prepare(
      `SELECT id, category_id, name_th, base_price, is_active
       FROM menu_items WHERE id IN (${placeholders})`
    )
    .bind(...menuItemIds)
    .all();

  const { results: categories } = await db
    .prepare(`SELECT id, name_th FROM categories`)
    .all();
  const categoryNameById = new Map(categories.map((c) => [c.id, c.name_th]));

  const { results: groups } = await db
    .prepare(
      `SELECT id, menu_item_id, name_th, is_required, is_multi_select,
              min_select, max_select
       FROM option_groups WHERE menu_item_id IN (${placeholders})`
    )
    .bind(...menuItemIds)
    .all();

  let optionsByGroup = new Map();
  if (groups.length > 0) {
    const groupIds = groups.map((g) => g.id);
    const groupPlaceholders = groupIds.map(() => "?").join(",");
    const { results: options } = await db
      .prepare(
        `SELECT id, option_group_id, name_th, price_delta, is_active
         FROM options WHERE option_group_id IN (${groupPlaceholders})`
      )
      .bind(...groupIds)
      .all();
    for (const opt of options) {
      if (!optionsByGroup.has(opt.option_group_id)) {
        optionsByGroup.set(opt.option_group_id, []);
      }
      optionsByGroup.get(opt.option_group_id).push(opt);
    }
  }

  const groupsByItem = new Map();
  for (const g of groups) {
    if (!groupsByItem.has(g.menu_item_id)) groupsByItem.set(g.menu_item_id, []);
    groupsByItem.get(g.menu_item_id).push(g);
  }

  const menuItemById = new Map(menuItems.map((m) => [m.id, m]));

  return { menuItemById, categoryNameById, groupsByItem, optionsByGroup };
}

/**
 * Validates one cart line against the live menu and returns the priced
 * order_item + order_item_options rows ready for insertion.
 * Throws a descriptive Error on any validation failure.
 */
function priceLine(line, ctx) {
  const menuItem = ctx.menuItemById.get(line.menu_item_id);
  if (!menuItem || !menuItem.is_active) {
    throw new Error(`menu_item ${line.menu_item_id} is not available`);
  }

  const quantity = Number(line.quantity) || 1;
  if (quantity < 1) throw new Error("quantity must be at least 1");

  const groups = ctx.groupsByItem.get(menuItem.id) || [];
  const selectedIds = new Set(line.selected_options || []);
  const chosenOptions = [];
  let optionsTotal = 0;

  for (const group of groups) {
    const groupOptions = ctx.optionsByGroup.get(group.id) || [];
    const groupOptionIds = new Set(groupOptions.map((o) => o.id));
    const selectedInGroup = groupOptions.filter((o) => selectedIds.has(o.id));

    if (group.is_required && selectedInGroup.length < 1) {
      throw new Error(
        `option group "${group.name_th}" is required for ${menuItem.name_th}`
      );
    }
    if (!group.is_multi_select && selectedInGroup.length > 1) {
      throw new Error(
        `option group "${group.name_th}" allows only one selection`
      );
    }
    if (group.max_select != null && selectedInGroup.length > group.max_select) {
      throw new Error(
        `option group "${group.name_th}" allows at most ${group.max_select} selections`
      );
    }
    if (selectedInGroup.length < group.min_select) {
      throw new Error(
        `option group "${group.name_th}" requires at least ${group.min_select} selections`
      );
    }

    for (const opt of selectedInGroup) {
      if (!opt.is_active) {
        throw new Error(`option "${opt.name_th}" is no longer available`);
      }
      optionsTotal += opt.price_delta;
      chosenOptions.push({
        option_group_name_snapshot: group.name_th,
        option_name_snapshot: opt.name_th,
        price_delta: opt.price_delta,
      });
    }

    // Any selected id that doesn't belong to this item's groups at all is
    // caught after the loop via the leftover-id check below.
    for (const id of selectedInGroup.map((o) => o.id)) groupOptionIds.delete(id);
  }

  const allKnownOptionIds = new Set(
    groups.flatMap((g) => (ctx.optionsByGroup.get(g.id) || []).map((o) => o.id))
  );
  for (const id of selectedIds) {
    if (!allKnownOptionIds.has(id)) {
      throw new Error(`option ${id} does not belong to ${menuItem.name_th}`);
    }
  }

  const unitPrice = menuItem.base_price + optionsTotal;
  const lineTotal = unitPrice * quantity;

  return {
    menu_item_id: menuItem.id,
    menu_item_name_snapshot: menuItem.name_th,
    section_name_snapshot: ctx.categoryNameById.get(menuItem.category_id) || null,
    quantity,
    unit_price: unitPrice,
    line_total: lineTotal,
    note: line.note || null,
    options: chosenOptions,
  };
}

/**
 * Looks up an active discount (by code, or the best auto-applied one with
 * no code) that applies to this branch/subtotal, and returns the amount
 * to subtract. Returns { discount: null, amount: 0 } when none applies.
 */
async function resolveDiscount(db, branchId, subtotal, code) {
  let discount;
  if (code) {
    discount = await db
      .prepare(
        `SELECT * FROM discounts
         WHERE code = ? AND is_active = 1
           AND (starts_at IS NULL OR starts_at <= datetime('now'))
           AND (ends_at IS NULL OR ends_at >= datetime('now'))`
      )
      .bind(code)
      .first();
    if (!discount) throw new Error("invalid or expired discount code");
  } else {
    discount = await db
      .prepare(
        `SELECT * FROM discounts
         WHERE code IS NULL AND is_active = 1
           AND (starts_at IS NULL OR starts_at <= datetime('now'))
           AND (ends_at IS NULL OR ends_at >= datetime('now'))
         ORDER BY value DESC LIMIT 1`
      )
      .first();
  }

  if (!discount) return { discount: null, amount: 0 };

  if (discount.branch_scope === "specific") {
    const inScope = await db
      .prepare(
        `SELECT 1 FROM discount_branches WHERE discount_id = ? AND branch_id = ?`
      )
      .bind(discount.id, branchId)
      .first();
    if (!inScope) return { discount: null, amount: 0 };
  }

  if (subtotal < discount.min_order_amount) {
    if (code) throw new Error(`order must be at least ${discount.min_order_amount} to use this code`);
    return { discount: null, amount: 0 };
  }

  const amount =
    discount.discount_type === "percent"
      ? Math.round(((subtotal * discount.value) / 100) * 100) / 100
      : Math.min(discount.value, subtotal);

  return { discount, amount };
}

/**
 * POST /api/orders
 * Body: {
 *   branch_id, dine_type: 'dine_in'|'takeaway', table_id?, table_number?,
 *   payment_method: 'promptpay'|'cash', note?, discount_code?,
 *   customer?: { line_user_id, display_name, picture_url },
 *   items: [{ menu_item_id, quantity, note?, selected_options: [id,...] }]
 * }
 */
export async function createOrder(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid JSON body", 400);
  }

  const { branch_id, dine_type, payment_method, items } = body;

  if (!branch_id) return errorResponse("branch_id is required", 400);
  if (!["dine_in", "takeaway"].includes(dine_type)) {
    return errorResponse("dine_type must be dine_in or takeaway", 400);
  }
  if (!["promptpay", "cash"].includes(payment_method)) {
    return errorResponse("payment_method must be promptpay or cash", 400);
  }
  if (!Array.isArray(items) || items.length === 0) {
    return errorResponse("items must be a non-empty array", 400);
  }

  const db = env.DB;

  const branch = await db
    .prepare(`SELECT id, name_th FROM branches WHERE id = ? AND is_active = 1`)
    .bind(branch_id)
    .first();
  if (!branch) return errorResponse("branch_not_found", 404);

  let tableId = null;
  let tableNumber = body.table_number || null;
  if (dine_type === "dine_in" && body.table_id) {
    const table = await db
      .prepare(
        `SELECT id, table_number FROM branch_tables
         WHERE id = ? AND branch_id = ? AND is_active = 1`
      )
      .bind(body.table_id, branch_id)
      .first();
    if (!table) return errorResponse("table_not_found", 404);
    tableId = table.id;
    tableNumber = table.table_number;
  }

  const menuItemIds = [...new Set(items.map((i) => i.menu_item_id))];
  if (menuItemIds.some((id) => !id)) {
    return errorResponse("every item needs a menu_item_id", 400);
  }

  const ctx = await loadPricingContext(db, menuItemIds);

  let pricedItems;
  try {
    pricedItems = items.map((line) => priceLine(line, ctx));
  } catch (err) {
    return errorResponse(err.message, 422);
  }

  const subtotal = pricedItems.reduce((sum, i) => sum + i.line_total, 0);

  let discountResult;
  try {
    discountResult = await resolveDiscount(db, branch_id, subtotal, body.discount_code);
  } catch (err) {
    return errorResponse(err.message, 422);
  }

  const total = Math.max(0, subtotal - discountResult.amount);

  let customerId = null;
  try {
    customerId = await upsertCustomer(db, body.customer);
  } catch {
    // Non-fatal: an order can still be placed without a resolved customer.
    customerId = null;
  }

  const orderCode = await nextOrderCode(db);

  const orderInsert = await db
    .prepare(
      `INSERT INTO orders (
         order_code, branch_id, customer_id, dine_type, table_id, table_number,
         payment_method, payment_status, subtotal, discount_id, discount_amount,
         total, note
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`
    )
    .bind(
      orderCode,
      branch_id,
      customerId,
      dine_type,
      tableId,
      tableNumber,
      payment_method,
      subtotal,
      discountResult.discount?.id || null,
      discountResult.amount,
      total,
      body.note || null
    )
    .run();

  const orderId = orderInsert.meta.last_row_id;

  const statements = [];
  for (const item of pricedItems) {
    const itemInsert = db
      .prepare(
        `INSERT INTO order_items (
           order_id, menu_item_id, menu_item_name_snapshot, section_name_snapshot,
           quantity, unit_price, line_total, note
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        orderId,
        item.menu_item_id,
        item.menu_item_name_snapshot,
        item.section_name_snapshot,
        item.quantity,
        item.unit_price,
        item.line_total,
        item.note
      );
    statements.push(itemInsert);
  }

  // D1 batch() runs each statement in order and returns per-statement
  // results; we need the new order_item ids before inserting their options,
  // so insert items one at a time instead of a single giant batch.
  const orderItemIds = [];
  for (const stmt of statements) {
    const res = await stmt.run();
    orderItemIds.push(res.meta.last_row_id);
  }

  const optionStatements = [];
  pricedItems.forEach((item, idx) => {
    const orderItemId = orderItemIds[idx];
    for (const opt of item.options) {
      optionStatements.push(
        db
          .prepare(
            `INSERT INTO order_item_options (
               order_item_id, option_group_name_snapshot, option_name_snapshot, price_delta
             ) VALUES (?, ?, ?, ?)`
          )
          .bind(orderItemId, opt.option_group_name_snapshot, opt.option_name_snapshot, opt.price_delta)
      );
    }
  });
  if (optionStatements.length > 0) {
    await db.batch(optionStatements);
  }

  // Best-effort kitchen/staff notification — never blocks or fails the
  // order response if LINE isn't configured yet or the push errors out.
  await notifyNewOrder(env, {
    order: { order_code: orderCode, dine_type, table_number: tableNumber, payment_method, total },
    items: pricedItems,
    branchName: branch.name_th,
  });

  return json(
    {
      ok: true,
      order: {
        id: orderId,
        order_code: orderCode,
        branch_id,
        dine_type,
        table_number: tableNumber,
        payment_method,
        payment_status: "pending",
        subtotal,
        discount_amount: discountResult.amount,
        total,
      },
    },
    { status: 201 }
  );
}

/**
 * GET /api/orders/:id
 */
export async function getOrder(request, env, id) {
  const db = env.DB;

  const order = await db
    .prepare(
      `SELECT o.*, b.name_th AS branch_name_th, b.name_en AS branch_name_en
       FROM orders o JOIN branches b ON b.id = o.branch_id
       WHERE o.id = ?`
    )
    .bind(id)
    .first();
  if (!order) return errorResponse("order_not_found", 404);

  const { results: items } = await db
    .prepare(
      `SELECT id, menu_item_id, menu_item_name_snapshot, section_name_snapshot,
              quantity, unit_price, line_total, note
       FROM order_items WHERE order_id = ? ORDER BY id ASC`
    )
    .bind(id)
    .all();

  let optionsByItem = new Map();
  if (items.length > 0) {
    const itemIds = items.map((i) => i.id);
    const placeholders = itemIds.map(() => "?").join(",");
    const { results: options } = await db
      .prepare(
        `SELECT order_item_id, option_group_name_snapshot, option_name_snapshot, price_delta
         FROM order_item_options WHERE order_item_id IN (${placeholders})`
      )
      .bind(...itemIds)
      .all();
    for (const opt of options) {
      if (!optionsByItem.has(opt.order_item_id)) optionsByItem.set(opt.order_item_id, []);
      optionsByItem.get(opt.order_item_id).push(opt);
    }
  }

  const itemsOut = items.map((i) => ({
    ...i,
    selected_options: optionsByItem.get(i.id) || [],
  }));

  return json({
    ok: true,
    order: {
      id: order.id,
      order_code: order.order_code,
      branch_id: order.branch_id,
      branch_name_th: order.branch_name_th,
      branch_name_en: order.branch_name_en,
      dine_type: order.dine_type,
      table_number: order.table_number,
      payment_method: order.payment_method,
      payment_status: order.payment_status,
      subtotal: order.subtotal,
      discount_amount: order.discount_amount,
      total: order.total,
      note: order.note,
      opened_at: order.opened_at,
      paid_at: order.paid_at,
      items: itemsOut,
    },
  });
}

/**
 * GET /api/admin/orders?branch_id=&status=&date=YYYY-MM-DD&limit=
 * Requires an authenticated admin. Lists orders (newest first) for the
 * kitchen/front-counter dashboard, scoped to the admin's branches and
 * optionally filtered by payment_status and day.
 */
export async function listOrdersAdmin(request, env) {
  const admin = await getAuthenticatedAdmin(request, env);
  if (!admin) return errorResponse("unauthorized", 401);

  const url = new URL(request.url);
  const branchId = url.searchParams.get("branch_id");
  const status = url.searchParams.get("status"); // pending|paid|cancelled
  const date = url.searchParams.get("date"); // YYYY-MM-DD, defaults to today
  const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 200);

  if (admin.branch_ids && branchId && !admin.branch_ids.includes(Number(branchId))) {
    return errorResponse("forbidden: branch not in your scope", 403);
  }

  const conditions = [];
  const params = [];

  if (admin.branch_ids) {
    conditions.push(`o.branch_id IN (${admin.branch_ids.map(() => "?").join(",")})`);
    params.push(...admin.branch_ids);
  }
  if (branchId) {
    conditions.push(`o.branch_id = ?`);
    params.push(Number(branchId));
  }
  if (status) {
    if (!["pending", "paid", "cancelled"].includes(status)) {
      return errorResponse("invalid status filter", 400);
    }
    conditions.push(`o.payment_status = ?`);
    params.push(status);
  }
  conditions.push(`date(o.opened_at) = date(?)`);
  params.push(date || new Date().toISOString().slice(0, 10));

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const { results: orders } = await env.DB.prepare(
    `SELECT o.id, o.order_code, o.branch_id, b.name_th AS branch_name_th,
            o.dine_type, o.table_number, o.payment_method, o.payment_status,
            o.subtotal, o.discount_amount, o.total, o.note,
            o.opened_at, o.paid_at
     FROM orders o
     JOIN branches b ON b.id = o.branch_id
     ${whereClause}
     ORDER BY o.id DESC
     LIMIT ?`
  )
    .bind(...params, limit)
    .all();

  if (orders.length === 0) {
    return json({ ok: true, orders: [] });
  }

  const orderIds = orders.map((o) => o.id);
  const placeholders = orderIds.map(() => "?").join(",");
  const { results: items } = await env.DB.prepare(
    `SELECT order_id, menu_item_name_snapshot, quantity
     FROM order_items WHERE order_id IN (${placeholders}) ORDER BY id ASC`
  )
    .bind(...orderIds)
    .all();

  const itemsByOrder = new Map();
  for (const item of items) {
    if (!itemsByOrder.has(item.order_id)) itemsByOrder.set(item.order_id, []);
    itemsByOrder.get(item.order_id).push({
      name: item.menu_item_name_snapshot,
      quantity: item.quantity,
    });
  }

  return json({
    ok: true,
    orders: orders.map((o) => ({ ...o, items: itemsByOrder.get(o.id) || [] })),
  });
}

/**
 * PATCH /api/admin/orders/:id
 * Body: { payment_status: 'paid' | 'cancelled' }
 * Requires an authenticated admin with the order's branch in scope.
 * Marking 'paid' stamps paid_at and confirmed_by with the admin's email.
 */
export async function updateOrderStatus(request, env, id) {
  const admin = await getAuthenticatedAdmin(request, env);
  if (!admin) return errorResponse("unauthorized", 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid JSON body", 400);
  }

  const { payment_status } = body;
  if (!["paid", "cancelled"].includes(payment_status)) {
    return errorResponse("payment_status must be 'paid' or 'cancelled'", 400);
  }

  const order = await env.DB.prepare(`SELECT id, branch_id FROM orders WHERE id = ?`)
    .bind(id)
    .first();
  if (!order) return errorResponse("order_not_found", 404);

  if (admin.branch_ids && !admin.branch_ids.includes(order.branch_id)) {
    return errorResponse("forbidden: branch not in your scope", 403);
  }

  if (payment_status === "paid") {
    await env.DB.prepare(
      `UPDATE orders SET payment_status = 'paid', paid_at = datetime('now'),
              confirmed_by = ?, updated_at = datetime('now')
       WHERE id = ?`
    )
      .bind(admin.email, id)
      .run();
  } else {
    await env.DB.prepare(
      `UPDATE orders SET payment_status = 'cancelled', confirmed_by = ?,
              updated_at = datetime('now')
       WHERE id = ?`
    )
      .bind(admin.email, id)
      .run();
  }

  return json({ ok: true, order: { id, payment_status } });
}
