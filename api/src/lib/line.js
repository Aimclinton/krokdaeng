/**
 * LINE Messaging API — pushes a Flex Message to the kitchen/staff chat
 * whenever a new order comes in. Requires two secrets (set via
 * `wrangler secret put`, see wrangler.toml):
 *   LINE_CHANNEL_ACCESS_TOKEN  — the bot's channel access token
 *   LINE_NOTIFY_TARGET         — the userId or groupId that receives
 *                                new-order alerts (add the bot to a
 *                                staff LINE group and use its groupId
 *                                for a shared feed, or a single staff
 *                                member's userId)
 *
 * Both are optional at runtime: if either is missing, notification is
 * silently skipped so the order flow itself never depends on LINE being
 * configured yet.
 */

const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";

function money(n) {
  return `฿${Number(n).toLocaleString("th-TH", { maximumFractionDigits: 0 })}`;
}

const DINE_TYPE_LABEL = { dine_in: "ทานที่ร้าน", takeaway: "กลับบ้าน" };
const PAYMENT_LABEL = { promptpay: "พร้อมเพย์", cash: "เงินสด" };

/**
 * Builds the Flex Message bubble body for a new order alert.
 * `order` is the order summary returned by createOrder; `items` is the
 * array of priced line items (menu_item_name_snapshot, quantity, line_total,
 * options: [{option_name_snapshot}]) used to render the kitchen ticket.
 */
function buildOrderFlexMessage(order, items, branchName) {
  const itemRows = items.map((item) => ({
    type: "box",
    layout: "horizontal",
    contents: [
      {
        type: "text",
        text: `${item.menu_item_name_snapshot} x${item.quantity}${
          item.options?.length ? `\n  (${item.options.map((o) => o.option_name_snapshot).join(", ")})` : ""
        }`,
        wrap: true,
        size: "sm",
        flex: 4,
      },
      {
        type: "text",
        text: money(item.line_total),
        size: "sm",
        align: "end",
        flex: 1,
      },
    ],
  }));

  const bubble = {
    type: "bubble",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#C0392B",
      paddingAll: "16px",
      contents: [
        { type: "text", text: "ออเดอร์ใหม่", color: "#FFFFFF", weight: "bold", size: "lg" },
        { type: "text", text: order.order_code, color: "#FFFFFF", size: "sm" },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        {
          type: "text",
          text: `${branchName || ""} · ${DINE_TYPE_LABEL[order.dine_type] || order.dine_type}${
            order.table_number ? ` · โต๊ะ ${order.table_number}` : ""
          }`,
          size: "sm",
          color: "#8A7E76",
          wrap: true,
        },
        { type: "separator" },
        { type: "box", layout: "vertical", spacing: "sm", contents: itemRows },
        { type: "separator" },
        {
          type: "box",
          layout: "horizontal",
          contents: [
            { type: "text", text: "ยอดรวม", weight: "bold" },
            { type: "text", text: money(order.total), weight: "bold", align: "end" },
          ],
        },
        {
          type: "text",
          text: `ชำระโดย: ${PAYMENT_LABEL[order.payment_method] || order.payment_method}`,
          size: "xs",
          color: "#8A7E76",
        },
      ],
    },
  };

  return {
    type: "flex",
    altText: `ออเดอร์ใหม่ ${order.order_code} ยอดรวม ${money(order.total)}`,
    contents: bubble,
  };
}

/**
 * Sends the new-order Flex Message. Never throws — logs and returns false
 * on any failure (missing config, network error, LINE API error) so a
 * notification problem never fails the order itself.
 */
export async function notifyNewOrder(env, { order, items, branchName }) {
  const token = env.LINE_CHANNEL_ACCESS_TOKEN;
  const target = env.LINE_NOTIFY_TARGET;
  if (!token || !target) return false;

  try {
    const message = buildOrderFlexMessage(order, items, branchName);
    const res = await fetch(LINE_PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ to: target, messages: [message] }),
    });

    if (!res.ok) {
      console.error("LINE push failed:", res.status, await res.text().catch(() => ""));
      return false;
    }
    return true;
  } catch (err) {
    console.error("LINE push error:", err);
    return false;
  }
}
