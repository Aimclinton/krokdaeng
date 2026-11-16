-- krokdaeng-db schema (D1 / SQLite)
-- Multi-branch food ordering system for ครกแดง (Krok Dang)
-- Convention: anything that can be scoped to one branch or all branches uses
--   scope TEXT CHECK(scope IN ('all','specific')) DEFAULT 'all'
-- plus a join table listing branch_ids when scope = 'specific'.

PRAGMA foreign_keys = ON;

-- ============================================================
-- 1. BRANCHES
-- ============================================================
CREATE TABLE branches (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name_th       TEXT NOT NULL,
  name_en       TEXT,
  address       TEXT,
  phone         TEXT,
  hours_text    TEXT,                 -- free-text hours e.g. "ทุกวัน 10:00-21:00"
  lat           REAL,
  lng           REAL,
  gmaps_url     TEXT,
  promptpay_id  TEXT,                 -- per-branch PromptPay override; falls back to corporate id
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Dine-in tables per branch, used for QR-at-table auto branch+table detection
CREATE TABLE branch_tables (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  branch_id     INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  table_number  TEXT NOT NULL,
  qr_token      TEXT NOT NULL UNIQUE, -- encoded in the table's QR code URL
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(branch_id, table_number)
);
CREATE INDEX idx_branch_tables_branch ON branch_tables(branch_id);

-- ============================================================
-- 2. CATEGORIES (menu sections, e.g. ก๋วยเตี๋ยว / กะเพรา / Signature)
-- ============================================================
CREATE TABLE categories (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name_th       TEXT NOT NULL,
  name_en       TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  scope         TEXT NOT NULL DEFAULT 'all' CHECK(scope IN ('all','specific')),
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE category_branches (
  category_id   INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  branch_id     INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  PRIMARY KEY (category_id, branch_id)
);

-- ============================================================
-- 3. MENU ITEMS
-- ============================================================
CREATE TABLE menu_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id   INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  name_th       TEXT NOT NULL,
  name_en       TEXT,                 -- shown as subtitle, Thai name is primary
  description   TEXT,
  base_price    REAL NOT NULL DEFAULT 0,
  image_key     TEXT,                 -- R2 object key in krokdaeng-images bucket
  is_signature  INTEGER NOT NULL DEFAULT 0,
  is_bestseller INTEGER NOT NULL DEFAULT 0,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  scope         TEXT NOT NULL DEFAULT 'all' CHECK(scope IN ('all','specific')),
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_menu_items_category ON menu_items(category_id);

CREATE TABLE menu_item_branches (
  menu_item_id  INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  branch_id     INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  PRIMARY KEY (menu_item_id, branch_id)
);

-- Option groups: e.g. "ขนาด" (required, single), "เพิ่มไข่" (optional, multi)
CREATE TABLE option_groups (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  menu_item_id    INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  name_th         TEXT NOT NULL,
  name_en         TEXT,
  is_required     INTEGER NOT NULL DEFAULT 0,
  is_multi_select INTEGER NOT NULL DEFAULT 0,
  min_select      INTEGER NOT NULL DEFAULT 0,
  max_select      INTEGER,            -- NULL = unlimited when multi-select
  sort_order      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_option_groups_menu_item ON option_groups(menu_item_id);

CREATE TABLE options (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  option_group_id INTEGER NOT NULL REFERENCES option_groups(id) ON DELETE CASCADE,
  name_th         TEXT NOT NULL,
  name_en         TEXT,
  price_delta     REAL NOT NULL DEFAULT 0,
  is_default      INTEGER NOT NULL DEFAULT 0,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_active       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_options_group ON options(option_group_id);

-- ============================================================
-- 4. DISCOUNTS / PROMOTIONS
-- ============================================================
CREATE TABLE discounts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT NOT NULL,
  code              TEXT UNIQUE,        -- NULL = auto-applied (no code needed)
  discount_type     TEXT NOT NULL CHECK(discount_type IN ('percent','amount')),
  value             REAL NOT NULL,
  apply_scope       TEXT NOT NULL DEFAULT 'all' CHECK(apply_scope IN ('all','category','menu_item')),
  min_order_amount  REAL NOT NULL DEFAULT 0,
  branch_scope      TEXT NOT NULL DEFAULT 'all' CHECK(branch_scope IN ('all','specific')),
  starts_at         TEXT,
  ends_at           TEXT,
  is_active         INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE discount_branches (
  discount_id   INTEGER NOT NULL REFERENCES discounts(id) ON DELETE CASCADE,
  branch_id     INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  PRIMARY KEY (discount_id, branch_id)
);

CREATE TABLE discount_categories (
  discount_id   INTEGER NOT NULL REFERENCES discounts(id) ON DELETE CASCADE,
  category_id   INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (discount_id, category_id)
);

CREATE TABLE discount_menu_items (
  discount_id   INTEGER NOT NULL REFERENCES discounts(id) ON DELETE CASCADE,
  menu_item_id  INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  PRIMARY KEY (discount_id, menu_item_id)
);

-- ============================================================
-- 5. CUSTOMERS (LINE users) + MEMBERSHIP (Phase 2 scaffolding)
-- ============================================================
CREATE TABLE membership_tiers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name_th         TEXT NOT NULL,       -- e.g. พริกเม็ดเดียว
  min_annual_spend REAL NOT NULL,
  max_annual_spend REAL,               -- NULL = no upper bound
  benefit_text    TEXT,
  discount_percent REAL NOT NULL DEFAULT 0,
  sort_order      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE customers (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  line_user_id      TEXT NOT NULL UNIQUE,
  display_name      TEXT,
  picture_url       TEXT,
  phone             TEXT,
  is_friend         INTEGER NOT NULL DEFAULT 0,   -- cached LINE follow status
  annual_spend      REAL NOT NULL DEFAULT 0,       -- Phase 2
  membership_tier_id INTEGER REFERENCES membership_tiers(id),
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_customers_line_user ON customers(line_user_id);

-- ============================================================
-- 6. ORDERS
-- ============================================================
CREATE TABLE orders (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code         TEXT NOT NULL UNIQUE,         -- e.g. KD-20261116-0001
  branch_id          INTEGER NOT NULL REFERENCES branches(id),
  customer_id        INTEGER REFERENCES customers(id),
  dine_type          TEXT NOT NULL CHECK(dine_type IN ('dine_in','takeaway')),
  table_id           INTEGER REFERENCES branch_tables(id),
  table_number       TEXT,                         -- denormalized snapshot
  payment_method     TEXT NOT NULL CHECK(payment_method IN ('promptpay','cash')),
  payment_status     TEXT NOT NULL DEFAULT 'pending' CHECK(payment_status IN ('pending','paid','cancelled')),
  subtotal           REAL NOT NULL DEFAULT 0,
  discount_id        INTEGER REFERENCES discounts(id),
  discount_amount    REAL NOT NULL DEFAULT 0,
  total              REAL NOT NULL DEFAULT 0,
  note               TEXT,
  opened_at          TEXT NOT NULL DEFAULT (datetime('now')),  -- order confirmed by customer
  paid_at            TEXT,                                      -- payment confirmed by staff
  confirmed_by       TEXT,                                      -- admin/staff identifier who marked paid
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_orders_branch ON orders(branch_id);
CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_orders_opened_at ON orders(opened_at);
CREATE INDEX idx_orders_paid_at ON orders(paid_at);

CREATE TABLE order_items (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id              INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id          INTEGER NOT NULL REFERENCES menu_items(id),
  menu_item_name_snapshot TEXT NOT NULL,
  section_name_snapshot  TEXT,          -- category name at order time, for kitchen grouping
  quantity              INTEGER NOT NULL DEFAULT 1,
  unit_price            REAL NOT NULL DEFAULT 0,  -- base + selected option deltas
  line_total            REAL NOT NULL DEFAULT 0,
  note                  TEXT                        -- customer note to kitchen (e.g. allergy)
);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_menu_item ON order_items(menu_item_id);

CREATE TABLE order_item_options (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  order_item_id             INTEGER NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  option_group_name_snapshot TEXT NOT NULL,
  option_name_snapshot      TEXT NOT NULL,
  price_delta               REAL NOT NULL DEFAULT 0
);
CREATE INDEX idx_order_item_options_item ON order_item_options(order_item_id);

-- ============================================================
-- 7. ADMIN CONSOLE (invite-link auth, no shared password)
-- ============================================================
CREATE TABLE admin_users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT NOT NULL UNIQUE,
  name            TEXT,
  password_hash   TEXT,                 -- set after accepting invite
  role            TEXT NOT NULL DEFAULT 'staff' CHECK(role IN ('owner','admin','staff')),
  branch_scope    TEXT NOT NULL DEFAULT 'all' CHECK(branch_scope IN ('all','specific')),
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE admin_user_branches (
  admin_user_id   INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  branch_id       INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  PRIMARY KEY (admin_user_id, branch_id)
);

CREATE TABLE admin_invites (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT NOT NULL,
  token           TEXT NOT NULL UNIQUE,  -- one-time link token, set own password on accept
  role            TEXT NOT NULL DEFAULT 'staff' CHECK(role IN ('owner','admin','staff')),
  branch_scope    TEXT NOT NULL DEFAULT 'all' CHECK(branch_scope IN ('all','specific')),
  expires_at      TEXT NOT NULL,
  used_at         TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE admin_invite_branches (
  invite_id       INTEGER NOT NULL REFERENCES admin_invites(id) ON DELETE CASCADE,
  branch_id       INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  PRIMARY KEY (invite_id, branch_id)
);
