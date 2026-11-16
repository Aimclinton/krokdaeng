import { json, errorResponse } from "../lib/http.js";

/**
 * GET /api/menu?branch_id=1
 *
 * Returns the full menu tree for a branch:
 *   categories[] -> items[] -> option_groups[] -> options[]
 *
 * Visibility rule (see migrations/0001_init.sql):
 *   a category/item is visible at a branch when scope='all',
 *   or scope='specific' and the branch appears in its *_branches join table.
 */
export async function getMenu(request, env) {
  const url = new URL(request.url);
  const branchId = Number(url.searchParams.get("branch_id"));

  if (!branchId || Number.isNaN(branchId)) {
    return errorResponse("branch_id query param is required", 400);
  }

  const branch = await env.DB.prepare(
    `SELECT id FROM branches WHERE id = ? AND is_active = 1`
  )
    .bind(branchId)
    .first();
  if (!branch) return errorResponse("branch_not_found", 404);

  // 1. Categories visible at this branch
  const { results: categories } = await env.DB.prepare(
    `SELECT c.id, c.name_th, c.name_en, c.sort_order
     FROM categories c
     WHERE c.is_active = 1
       AND (
         c.scope = 'all'
         OR EXISTS (
           SELECT 1 FROM category_branches cb
           WHERE cb.category_id = c.id AND cb.branch_id = ?
         )
       )
     ORDER BY c.sort_order ASC, c.id ASC`
  )
    .bind(branchId)
    .all();

  if (categories.length === 0) {
    return json({ ok: true, branch_id: branchId, categories: [] });
  }

  const categoryIds = categories.map((c) => c.id);
  const catPlaceholders = categoryIds.map(() => "?").join(",");

  // 2. Menu items visible at this branch, within those categories
  const { results: items } = await env.DB.prepare(
    `SELECT mi.id, mi.category_id, mi.name_th, mi.name_en, mi.description,
            mi.base_price, mi.image_key, mi.is_signature, mi.is_bestseller,
            mi.sort_order
     FROM menu_items mi
     WHERE mi.is_active = 1
       AND mi.category_id IN (${catPlaceholders})
       AND (
         mi.scope = 'all'
         OR EXISTS (
           SELECT 1 FROM menu_item_branches mib
           WHERE mib.menu_item_id = mi.id AND mib.branch_id = ?
         )
       )
     ORDER BY mi.sort_order ASC, mi.id ASC`
  )
    .bind(...categoryIds, branchId)
    .all();

  if (items.length === 0) {
    return json({
      ok: true,
      branch_id: branchId,
      categories: categories.map((c) => ({ ...c, items: [] })),
    });
  }

  const itemIds = items.map((i) => i.id);
  const itemPlaceholders = itemIds.map(() => "?").join(",");

  // 3. Option groups for those items
  const { results: groups } = await env.DB.prepare(
    `SELECT id, menu_item_id, name_th, name_en, is_required,
            is_multi_select, min_select, max_select, sort_order
     FROM option_groups
     WHERE menu_item_id IN (${itemPlaceholders})
     ORDER BY sort_order ASC, id ASC`
  )
    .bind(...itemIds)
    .all();

  let optionsByGroup = new Map();
  if (groups.length > 0) {
    const groupIds = groups.map((g) => g.id);
    const groupPlaceholders = groupIds.map(() => "?").join(",");

    // 4. Options for those groups
    const { results: options } = await env.DB.prepare(
      `SELECT id, option_group_id, name_th, name_en, price_delta,
              is_default, sort_order
       FROM options
       WHERE is_active = 1 AND option_group_id IN (${groupPlaceholders})
       ORDER BY sort_order ASC, id ASC`
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
    groupsByItem.get(g.menu_item_id).push({
      id: g.id,
      name_th: g.name_th,
      name_en: g.name_en,
      is_required: !!g.is_required,
      is_multi_select: !!g.is_multi_select,
      min_select: g.min_select,
      max_select: g.max_select,
      options: optionsByGroup.get(g.id) || [],
    });
  }

  const itemsByCategory = new Map();
  for (const item of items) {
    if (!itemsByCategory.has(item.category_id)) {
      itemsByCategory.set(item.category_id, []);
    }
    itemsByCategory.get(item.category_id).push({
      id: item.id,
      name_th: item.name_th,
      name_en: item.name_en,
      description: item.description,
      base_price: item.base_price,
      image_key: item.image_key,
      is_signature: !!item.is_signature,
      is_bestseller: !!item.is_bestseller,
      option_groups: groupsByItem.get(item.id) || [],
    });
  }

  const tree = categories.map((c) => ({
    id: c.id,
    name_th: c.name_th,
    name_en: c.name_en,
    items: itemsByCategory.get(c.id) || [],
  }));

  return json({ ok: true, branch_id: branchId, categories: tree });
}
