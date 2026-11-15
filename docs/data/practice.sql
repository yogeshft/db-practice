-- =====================================================================
--  practice.sql: the "shop" practice database for PostgreSQL Mastery
--
--  Load it (once, and again any time you want a clean reset):
--    psql -U postgres -c "CREATE DATABASE practice"
--    psql -U postgres -d practice -f practice.sql
--
--  The data is small on purpose so you can read it, and full of the
--  edge cases real data has:
--    * 4 customers who never ordered (9, 13, 15, 16)
--    * order 30 has no items; products 13 and 15 were never ordered
--    * payments has NO foreign key (it is imported from a payment provider):
--      it contains payments for orders 40 and 9999, which do not exist,
--      a split payment (order 9), a refund (order 4), a double charge
--      (order 2) and an under-payment (order 24)
--    * customer 18 is a duplicate of customer 2 (email differs only in case)
--    * NULL cities, an employee with no department, a category with no products,
--      a supplier with no products, a product with no supplier
--    * deliveries: 25 shipped orders with time-zone-aware timestamps;
--      4 are still in transit (delivered_at is NULL)
--    * page_views: 38 website clicks by customers 1, 2, 5 and 9 (sessions, streaks)
--    * routes: a small one-way shipping network with one cycle
--    * product_details: tags (TEXT[]) and specs (JSONB) for 13 products;
--      Desk Lamp has no tags, Earbuds Lite has 'Wireless' (capital W) and a
--      battery_hours stored as a string, Desk Lamp has a JSON null warranty
--    * events: 24 app events as JSONB; the checkout for order 35 disagrees with
--      order_items, one add_to_cart has qty as a string, one event has no device
--    * inventory + stock_feed: stock per warehouse and an incoming feed with a
--      duplicate, a stale row, an unknown product, a negative qty and a no-op
--    * product_attributes: the EAV anti-pattern ('colour' typo, 'Black', 'light')
--    * price_history: list prices as date ranges, with one overlap and one gap
--    * accounts: four wallets (total 9,200); a balance may never go below zero
--    * jobs: a work queue: 5 queued and due, 1 scheduled for 2099, 1 stuck in
--      'running' (its worker died), 2 done, 1 failed
--    * table_bookings: restaurant tables 1-4 on 20 Feb 2026; one booking per
--      table and one-hour slot (UNIQUE)
--  Dates are fixed (2024-2026) so every answer is reproducible.
--  The database time zone is set to Asia/Kolkata (India), so timestamps
--  with time zone print the same on every machine.
-- =====================================================================

DROP TABLE IF EXISTS accounts, jobs, table_bookings,
  stock_feed, inventory, events, price_history, product_attributes, product_details,
  page_views, routes, deliveries, reviews, payments, order_items, orders, product_suppliers,
  suppliers, products, categories, customers, employees, departments,
  discount_tiers, shipping_zones, sizes, colors CASCADE;

-- Every new connection to this database uses India time; this session too.
DO $$ BEGIN
  EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'Asia/Kolkata');
END $$;
SET timezone TO 'Asia/Kolkata';

CREATE TABLE departments (
  department_id INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  budget        NUMERIC(12, 2) NOT NULL,
  location      TEXT NOT NULL
);

CREATE TABLE employees (
  employee_id   INTEGER PRIMARY KEY,
  full_name     TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  department_id INTEGER REFERENCES departments (department_id),
  manager_id    INTEGER REFERENCES employees (employee_id),
  job_title     TEXT NOT NULL,
  salary        NUMERIC(12, 2) NOT NULL,
  hired_on      DATE NOT NULL
);

CREATE TABLE customers (
  customer_id INTEGER PRIMARY KEY,
  full_name   TEXT NOT NULL,
  email       TEXT NOT NULL,
  city        TEXT,
  country     TEXT,
  signup_date DATE NOT NULL,
  referred_by INTEGER REFERENCES customers (customer_id)
);

CREATE TABLE categories (
  category_id INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  parent_id   INTEGER REFERENCES categories (category_id)
);

CREATE TABLE products (
  product_id   INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  category_id  INTEGER REFERENCES categories (category_id),
  price        NUMERIC(12, 2) NOT NULL,
  discontinued BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE suppliers (
  supplier_id INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  country     TEXT NOT NULL
);

CREATE TABLE product_suppliers (
  product_id  INTEGER REFERENCES products (product_id),
  supplier_id INTEGER REFERENCES suppliers (supplier_id),
  PRIMARY KEY (product_id, supplier_id)
);

CREATE TABLE orders (
  order_id      INTEGER PRIMARY KEY,
  customer_id   INTEGER NOT NULL REFERENCES customers (customer_id),
  order_date    DATE NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('pending', 'shipped', 'delivered', 'cancelled')),
  shipping_city TEXT
);

CREATE TABLE order_items (
  order_id   INTEGER REFERENCES orders (order_id),
  product_id INTEGER REFERENCES products (product_id),
  quantity   INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12, 2) NOT NULL,   -- price at the time of the order
  PRIMARY KEY (order_id, product_id)
);

-- Imported from the payment provider: no foreign key on purpose.
CREATE TABLE payments (
  payment_id INTEGER PRIMARY KEY,
  order_id   INTEGER NOT NULL,
  amount     NUMERIC(12, 2) NOT NULL,   -- negative = refund
  method     TEXT NOT NULL,
  paid_at    TIMESTAMP NOT NULL
);

-- One row per order that has left the warehouse. Times carry real UTC offsets:
-- India +05:30, Dubai +04, London +01 (summer time). delivered_at is NULL while in transit.
CREATE TABLE deliveries (
  order_id     INTEGER PRIMARY KEY REFERENCES orders (order_id),
  carrier      TEXT NOT NULL,
  shipped_at   TIMESTAMPTZ NOT NULL,
  delivered_at TIMESTAMPTZ
);

-- Website clicks, for sessions (gaps over 30 minutes) and streaks of active days.
CREATE TABLE page_views (
  view_id     INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers (customer_id),
  viewed_at   TIMESTAMPTZ NOT NULL,
  page        TEXT NOT NULL
);

-- One-way shipping routes between warehouses, for graph traversal.
CREATE TABLE routes (
  from_city TEXT NOT NULL,
  to_city   TEXT NOT NULL,
  km        INTEGER NOT NULL,
  PRIMARY KEY (from_city, to_city)
);

CREATE TABLE reviews (
  review_id   INTEGER PRIMARY KEY,
  product_id  INTEGER NOT NULL REFERENCES products (product_id),
  customer_id INTEGER NOT NULL REFERENCES customers (customer_id),
  rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  created_at  DATE NOT NULL
);

-- Lookup tables for non-equi joins and CROSS JOIN practice
CREATE TABLE discount_tiers (
  tier         TEXT PRIMARY KEY,
  min_amount   NUMERIC(12, 2) NOT NULL,
  max_amount   NUMERIC(12, 2),            -- NULL = no upper limit
  discount_pct NUMERIC(4, 1) NOT NULL
);

CREATE TABLE shipping_zones (
  city TEXT PRIMARY KEY,
  zone TEXT NOT NULL
);

CREATE TABLE sizes  (size  TEXT PRIMARY KEY, sort_order INTEGER NOT NULL);
CREATE TABLE colors (color TEXT PRIMARY KEY);

-- Phase 4: arrays, JSONB, upsert and data modelling ------------------------

-- 1:1 extension of products: free-form tags and category-specific specs.
CREATE TABLE product_details (
  product_id INTEGER PRIMARY KEY REFERENCES products (product_id),
  tags       TEXT[] NOT NULL DEFAULT '{}',
  specs      JSONB  NOT NULL DEFAULT '{}'
);

-- Raw app events, stored as received. The event type lives inside the JSON.
CREATE TABLE events (
  event_id    INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers (customer_id),
  created_at  TIMESTAMPTZ NOT NULL,
  payload     JSONB NOT NULL
);

-- Stock on hand per warehouse.
CREATE TABLE inventory (
  warehouse  TEXT NOT NULL,
  product_id INTEGER NOT NULL REFERENCES products (product_id),
  qty        INTEGER NOT NULL CHECK (qty >= 0),
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (warehouse, product_id)
);

-- Stock counts sent by the warehouses. A raw feed: no foreign key, no checks.
CREATE TABLE stock_feed (
  feed_id     INTEGER PRIMARY KEY,
  warehouse   TEXT NOT NULL,
  product_id  INTEGER NOT NULL,
  qty         INTEGER NOT NULL,
  received_at TIMESTAMPTZ NOT NULL
);

-- The EAV anti-pattern: one row per (product, attribute), every value as text.
CREATE TABLE product_attributes (
  product_id INTEGER NOT NULL REFERENCES products (product_id),
  attr       TEXT NOT NULL,
  value      TEXT NOT NULL,
  PRIMARY KEY (product_id, attr)
);

-- List price over time. valid_during is a date range: [from, to).
CREATE TABLE price_history (
  product_id   INTEGER NOT NULL REFERENCES products (product_id),
  price        NUMERIC(12, 2) NOT NULL,
  valid_during DATERANGE NOT NULL,
  PRIMARY KEY (product_id, valid_during)
);

-- Phase 6: transactions and locking ----------------------------------------

-- Customer wallets. Money must never be created or lost, and never go negative.
CREATE TABLE accounts (
  account_id INTEGER PRIMARY KEY,
  owner      TEXT NOT NULL,
  balance    NUMERIC(12, 2) NOT NULL CHECK (balance >= 0)
);

-- A work queue that several workers read at the same time.
CREATE TABLE jobs (
  job_id    INTEGER PRIMARY KEY,
  kind      TEXT NOT NULL,
  payload   JSONB NOT NULL DEFAULT '{}',
  status    TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  attempts  INTEGER NOT NULL DEFAULT 0,
  run_after TIMESTAMPTZ NOT NULL,          -- do not start before this time
  locked_by TEXT,                          -- the worker that took the job
  locked_at TIMESTAMPTZ
);

-- Restaurant table bookings in one-hour slots: one booking per table and slot.
CREATE TABLE table_bookings (
  booking_id INTEGER PRIMARY KEY,
  table_no   INTEGER NOT NULL,
  slot       TIMESTAMPTZ NOT NULL,         -- start of the one-hour slot
  guest      TEXT NOT NULL,
  party_size INTEGER NOT NULL CHECK (party_size > 0),
  UNIQUE (table_no, slot)
);

-- ---------------------------------------------------------------------
INSERT INTO departments VALUES
  (1, 'Engineering', 900000, 'Pune'),
  (2, 'Sales',       500000, 'Mumbai'),
  (3, 'Marketing',   300000, 'Mumbai'),
  (4, 'Finance',     250000, 'Pune'),
  (5, 'Legal',       150000, 'Delhi');          -- no employees

INSERT INTO employees VALUES
  (1,  'Asha Rao',       'asha@shop.test',   NULL, NULL, 'CEO',                  300000, '2018-01-10'),
  (2,  'Vikram Mehta',   'vikram@shop.test', 1,    1,    'CTO',                  220000, '2018-03-01'),
  (3,  'Neha Kulkarni',  'neha@shop.test',   1,    2,    'Engineering Manager',  150000, '2019-06-15'),
  (4,  'Rahul Verma',    'rahul@shop.test',  1,    3,    'Senior Engineer',      120000, '2020-02-01'),
  (5,  'Priya Nair',     'priya@shop.test',  1,    3,    'Engineer',              95000, '2021-08-23'),
  (6,  'Arjun Singh',    'arjun@shop.test',  1,    3,    'Engineer',              95000, '2022-01-10'),
  (7,  'Sneha Iyer',     'sneha@shop.test',  2,    1,    'Sales Head',           160000, '2019-01-07'),
  (8,  'Karan Malhotra', 'karan@shop.test',  2,    7,    'Sales Executive',       60000, '2021-04-12'),
  (9,  'Meera Joshi',    'meera@shop.test',  2,    7,    'Sales Executive',       62000, '2023-09-01'),
  (10, 'Rohan Das',      'rohan@shop.test',  3,    1,    'Marketing Lead',       110000, '2020-11-30'),
  (11, 'Isha Kapoor',    'isha@shop.test',   4,    1,    'Accountant',            85000, '2022-05-16'),
  (12, 'Dev Patel',      'dev@shop.test',    NULL, 3,    'Intern',                25000, '2025-06-01');

INSERT INTO customers VALUES
  (1,  'Aarav Shah',     'aarav@mail.test',   'Mumbai',    'India',     '2024-01-05', NULL),
  (2,  'Diya Menon',     'diya@mail.test',    'Bengaluru', 'India',     '2024-01-18', 1),
  (3,  'Kabir Khan',     'kabir@mail.test',   'Delhi',     'India',     '2024-02-02', NULL),
  (4,  'Ananya Gupta',   'ananya@mail.test',  'Pune',      'India',     '2024-02-20', 2),
  (5,  'Ishaan Reddy',   'ishaan@mail.test',  'Hyderabad', 'India',     '2024-03-11', NULL),
  (6,  'Saanvi Pillai',  'saanvi@mail.test',  NULL,        'India',     '2024-03-29', 1),
  (7,  'Vivaan Bose',    'vivaan@mail.test',  'Kolkata',   'India',     '2024-04-14', NULL),
  (8,  'Myra Chawla',    'myra@mail.test',    'Mumbai',    'India',     '2024-05-02', 4),
  (9,  'Reyansh Jain',   'reyansh@mail.test', 'Pune',      'India',     '2024-05-27', NULL),
  (10, 'Kiara Sethi',    'kiara@mail.test',   'Delhi',     'India',     '2024-06-09', 3),
  (11, 'Aditya Rao',     'aditya@mail.test',  'Bengaluru', 'India',     '2024-07-15', NULL),
  (12, 'Zara Ali',       'zara@mail.test',    'Dubai',     'UAE',       '2024-08-01', NULL),
  (13, 'Liam Wong',      'liam@mail.test',    'Singapore', 'Singapore', '2024-08-20', 12),
  (14, 'Emma Brown',     'emma@mail.test',    'London',    'UK',        '2024-09-05', NULL),
  (15, 'Noah Fernandes', 'noah@mail.test',    'Panaji',    'India',     '2024-10-10', NULL),
  (16, 'Tara Singh',     'tara@mail.test',    NULL,        NULL,        '2025-01-03', 6),
  (17, 'Arnav Desai',    'arnav@mail.test',   'Mumbai',    'India',     '2025-02-14', 8),
  (18, 'Diya M',         'DIYA@mail.test',    'Bengaluru', 'India',     '2025-03-01', NULL),
  (19, 'Om Prakash',     'om@mail.test',      'Delhi',     'India',     '2025-04-22', NULL),
  (20, 'Riya Kapoor',    'riya@mail.test',    'Pune',      'India',     '2025-05-30', 17);

INSERT INTO categories VALUES
  (1, 'Electronics', NULL),
  (2, 'Computers',   1),
  (3, 'Audio',       1),
  (4, 'Home',        NULL),
  (5, 'Kitchen',     4),
  (6, 'Books',       NULL),                     -- no products
  (7, 'Accessories', 2);

INSERT INTO products VALUES
  (1,  'Laptop Pro 14',           2,    120000, false),
  (2,  'Laptop Air 13',           2,     85000, false),
  (3,  'Wireless Mouse',          7,      1500, false),
  (4,  'Mechanical Keyboard',     7,      6500, false),
  (5,  'USB-C Hub',               7,      3500, false),
  (6,  'Noise-Cancel Headphones', 3,     18000, false),
  (7,  'Bluetooth Speaker',       3,      7000, false),
  (8,  'Earbuds Lite',            3,      2500, true),
  (9,  'Coffee Maker',            5,      9000, false),
  (10, 'Chef Knife',              5,      4000, false),
  (11, 'Air Fryer',               5,     11000, false),
  (12, 'Desk Lamp',               4,      2200, false),
  (13, 'Standing Desk',           4,     32000, false),   -- never ordered
  (14, 'Gift Card',               NULL,   1000, false),   -- no category, no supplier
  (15, '4K Monitor',              2,     42000, false);   -- never ordered

INSERT INTO suppliers VALUES
  (1, 'TechSource',   'India'),
  (2, 'SoundWorks',   'Germany'),
  (3, 'HomeGoods Co', 'India'),
  (4, 'GlobalParts',  'China');                 -- supplies nothing

INSERT INTO product_suppliers VALUES
  (1, 1), (2, 1), (3, 1), (4, 1), (5, 1), (15, 1), (6, 1),
  (6, 2), (7, 2), (8, 2),
  (9, 3), (10, 3), (11, 3), (12, 3), (13, 3);

INSERT INTO orders VALUES
  (1,  1,  '2025-01-05', 'delivered', 'Mumbai'),
  (2,  2,  '2025-01-09', 'delivered', 'Bengaluru'),
  (3,  1,  '2025-01-20', 'delivered', 'Mumbai'),
  (4,  3,  '2025-02-03', 'cancelled', 'Delhi'),
  (5,  4,  '2025-02-11', 'delivered', 'Pune'),
  (6,  5,  '2025-02-14', 'delivered', 'Hyderabad'),
  (7,  6,  '2025-02-28', 'delivered', 'Chennai'),
  (8,  7,  '2025-03-04', 'delivered', 'Kolkata'),
  (9,  2,  '2025-03-15', 'delivered', 'Bengaluru'),
  (10, 8,  '2025-03-21', 'delivered', 'Mumbai'),
  (11, 10, '2025-04-02', 'delivered', 'Delhi'),
  (12, 11, '2025-04-10', 'cancelled', 'Bengaluru'),
  (13, 1,  '2025-04-18', 'delivered', 'Pune'),
  (14, 12, '2025-05-01', 'delivered', 'Dubai'),
  (15, 14, '2025-05-09', 'shipped',   'London'),
  (16, 3,  '2025-05-20', 'delivered', 'Delhi'),
  (17, 5,  '2025-06-02', 'delivered', 'Hyderabad'),
  (18, 17, '2025-06-15', 'delivered', 'Mumbai'),
  (19, 18, '2025-06-30', 'delivered', 'Bengaluru'),
  (20, 19, '2025-07-07', 'cancelled', 'Delhi'),
  (21, 20, '2025-07-19', 'delivered', 'Pune'),
  (22, 2,  '2025-08-01', 'delivered', 'Bengaluru'),
  (23, 4,  '2025-08-14', 'shipped',   'Pune'),
  (24, 6,  '2025-08-30', 'delivered', NULL),
  (25, 8,  '2025-09-09', 'delivered', 'Mumbai'),
  (26, 10, '2025-09-25', 'shipped',   'Delhi'),
  (27, 1,  '2025-10-03', 'pending',   'Mumbai'),
  (28, 11, '2025-10-18', 'delivered', 'Bengaluru'),
  (29, 12, '2025-11-02', 'pending',   'Dubai'),
  (30, 7,  '2025-11-20', 'pending',   'Kolkata'),   -- no items
  (31, 17, '2025-12-05', 'shipped',   'Mumbai'),
  (32, 20, '2025-12-24', 'pending',   'Pune'),
  (33, 5,  '2026-01-08', 'pending',   'Hyderabad'),
  (34, 14, '2026-01-15', 'cancelled', 'London'),
  (35, 3,  '2026-02-01', 'pending',   'Delhi'),
  (36, 2,  '2026-02-14', 'pending',   'Bengaluru');

INSERT INTO order_items VALUES
  (1, 1, 1, 118000), (1, 3, 1, 1500),
  (2, 6, 1, 18000),  (2, 8, 2, 2500),
  (3, 4, 1, 6500),   (3, 5, 2, 3500),
  (4, 2, 1, 85000),
  (5, 9, 1, 9000),   (5, 10, 2, 4000),
  (6, 7, 1, 7000),   (6, 12, 2, 2200),
  (7, 11, 1, 11000),
  (8, 6, 1, 17500),  (8, 3, 2, 1500),
  (9, 2, 1, 84000),  (9, 5, 1, 3500),  (9, 3, 1, 1500),
  (10, 9, 1, 9000),  (10, 14, 3, 1000),
  (11, 1, 1, 120000), (11, 4, 1, 6500),
  (12, 7, 2, 7000),
  (13, 12, 1, 2200), (13, 10, 1, 4000),
  (14, 6, 2, 18000), (14, 14, 5, 1000),
  (15, 2, 1, 85000),
  (16, 8, 3, 2400),  (16, 3, 1, 1500),
  (17, 11, 1, 10500), (17, 9, 1, 9000),
  (18, 4, 2, 6500),  (18, 5, 1, 3500),
  (19, 7, 1, 7000),
  (20, 1, 1, 120000),
  (21, 10, 3, 4000), (21, 12, 1, 2200),
  (22, 3, 2, 1500),  (22, 8, 1, 2500),
  (23, 6, 1, 18000),
  (24, 9, 1, 8800),
  (25, 1, 1, 119000), (25, 6, 1, 18000), (25, 3, 1, 1500),
  (26, 11, 1, 11000), (26, 14, 2, 1000),
  (27, 5, 1, 3500),  (27, 4, 1, 6500),
  (28, 7, 1, 7000),  (28, 12, 3, 2200),
  (29, 2, 1, 85000),
  (31, 14, 10, 1000),
  (32, 10, 1, 4000), (32, 9, 1, 9000),
  (33, 6, 1, 18000),
  (34, 2, 1, 85000),
  (35, 3, 3, 1500),  (35, 5, 1, 3500),
  (36, 12, 2, 2200);

INSERT INTO payments VALUES
  (1,  1,    119500, 'card', '2025-01-05 10:12'),
  (2,  2,     23000, 'upi',  '2025-01-09 18:40'),
  (3,  3,     13500, 'card', '2025-01-20 09:05'),
  (4,  4,     85000, 'card', '2025-02-03 12:00'),
  (5,  4,    -85000, 'card', '2025-02-05 16:30'),   -- refund
  (6,  5,     17000, 'upi',  '2025-02-11 11:11'),
  (7,  6,     11400, 'cod',  '2025-02-18 14:20'),
  (8,  7,     11000, 'upi',  '2025-02-28 20:02'),
  (9,  8,     20500, 'card', '2025-03-04 08:45'),
  (10, 9,     50000, 'card', '2025-03-15 13:00'),   -- split payment
  (11, 9,     39000, 'upi',  '2025-03-15 13:02'),
  (12, 10,    12000, 'upi',  '2025-03-21 19:30'),
  (13, 11,   126500, 'card', '2025-04-02 10:00'),
  (14, 13,     6200, 'cod',  '2025-04-22 17:45'),
  (15, 14,    41000, 'card', '2025-05-01 09:30'),
  (16, 15,    85000, 'card', '2025-05-09 15:15'),
  (17, 16,     8700, 'upi',  '2025-05-20 12:12'),
  (18, 17,    19500, 'card', '2025-06-02 16:00'),
  (19, 18,    16500, 'upi',  '2025-06-15 11:50'),
  (20, 19,     7000, 'upi',  '2025-06-30 21:10'),
  (21, 21,    14200, 'card', '2025-07-19 10:40'),
  (22, 22,     5500, 'upi',  '2025-08-01 09:09'),
  (23, 23,    18000, 'card', '2025-08-14 14:14'),
  (24, 24,     8000, 'cod',  '2025-09-03 18:00'),   -- under-paid (8800 due)
  (25, 25,   138500, 'card', '2025-09-09 10:10'),
  (26, 26,    13000, 'upi',  '2025-09-25 13:30'),
  (27, 28,    13600, 'card', '2025-10-18 15:45'),
  (28, 31,    10000, 'card', '2025-12-05 11:00'),
  (29, 33,    18000, 'upi',  '2026-01-08 09:00'),
  (30, 9999,   4999, 'card', '2025-06-01 00:00'),   -- order does not exist
  (31, 40,     1200, 'upi',  '2025-12-31 23:59'),   -- order does not exist
  (32, 2,     23000, 'upi',  '2025-01-09 18:41');   -- double charge

INSERT INTO deliveries VALUES
  (1,  'BlueDart',  '2025-01-06 10:30+05:30', '2025-01-08 18:45+05:30'),
  (2,  'Delhivery', '2025-01-10 09:15+05:30', '2025-01-13 12:00+05:30'),
  (3,  'BlueDart',  '2025-01-21 11:00+05:30', '2025-01-22 16:20+05:30'),
  (5,  'Delhivery', '2025-02-12 14:40+05:30', '2025-02-15 10:05+05:30'),
  (6,  'BlueDart',  '2025-02-15 08:50+05:30', '2025-02-17 19:30+05:30'),
  (7,  'Delhivery', '2025-03-02 01:15+05:30', '2025-03-06 11:10+05:30'),   -- shipped just after midnight India time
  (8,  'BlueDart',  '2025-03-05 12:00+05:30', '2025-03-07 15:45+05:30'),
  (9,  'Delhivery', '2025-03-16 10:10+05:30', '2025-03-18 17:00+05:30'),
  (10, 'BlueDart',  '2025-03-22 09:00+05:30', '2025-03-23 13:30+05:30'),
  (11, 'BlueDart',  '2025-04-03 16:00+05:30', '2025-04-05 11:45+05:30'),
  (13, 'Delhivery', '2025-04-19 10:20+05:30', '2025-04-24 09:00+05:30'),
  (14, 'DHL',       '2025-05-02 09:00+04',    '2025-05-06 14:00+04'),      -- Dubai
  (15, 'DHL',       '2025-05-10 08:00+01',    NULL),                       -- London, still in transit
  (16, 'BlueDart',  '2025-05-21 00:40+05:30', '2025-05-23 12:10+05:30'),   -- shipped just after midnight India time
  (17, 'Delhivery', '2025-06-03 15:30+05:30', '2025-06-06 10:00+05:30'),
  (18, 'BlueDart',  '2025-06-16 11:11+05:30', '2025-06-17 18:00+05:30'),
  (19, 'Delhivery', '2025-07-01 09:45+05:30', '2025-07-03 16:30+05:30'),
  (21, 'Delhivery', '2025-07-20 13:00+05:30', '2025-07-22 11:15+05:30'),
  (22, 'BlueDart',  '2025-08-02 10:00+05:30', '2025-08-04 09:30+05:30'),
  (23, 'Delhivery', '2025-08-15 12:00+05:30', NULL),                       -- in transit
  (24, 'BlueDart',  '2025-08-31 22:50+05:30', '2025-09-03 17:40+05:30'),
  (25, 'BlueDart',  '2025-09-10 09:30+05:30', '2025-09-11 12:00+05:30'),
  (26, 'Delhivery', '2025-09-26 18:00+05:30', NULL),                       -- in transit
  (28, 'Delhivery', '2025-10-19 10:00+05:30', '2025-10-25 20:00+05:30'),
  (31, 'BlueDart',  '2025-12-06 23:55+05:30', NULL);                       -- in transit

INSERT INTO page_views VALUES
  -- customer 1: several sessions a day, active 1-3, 5-6 and 10 March
  (1,  1, '2025-03-01 10:00+05:30', 'home'),
  (2,  1, '2025-03-01 10:05+05:30', 'product'),
  (3,  1, '2025-03-01 10:12+05:30', 'cart'),
  (4,  1, '2025-03-01 10:20+05:30', 'checkout'),
  (5,  1, '2025-03-01 14:00+05:30', 'home'),
  (6,  1, '2025-03-01 14:03+05:30', 'search'),
  (7,  1, '2025-03-02 09:00+05:30', 'home'),
  (8,  1, '2025-03-02 09:10+05:30', 'product'),
  (9,  1, '2025-03-03 20:00+05:30', 'home'),
  (10, 1, '2025-03-03 20:25+05:30', 'product'),
  (11, 1, '2025-03-03 20:58+05:30', 'cart'),        -- 33 minutes later: a new session
  (12, 1, '2025-03-05 11:00+05:30', 'home'),
  (13, 1, '2025-03-06 11:30+05:30', 'product'),
  (14, 1, '2025-03-06 11:45+05:30', 'cart'),
  (15, 1, '2025-03-10 18:00+05:30', 'home'),
  (16, 1, '2025-03-10 18:20+05:30', 'product'),
  (17, 1, '2025-03-10 18:40+05:30', 'product'),
  (18, 1, '2025-03-10 19:00+05:30', 'checkout'),
  -- customer 2: active 2-5 March
  (19, 2, '2025-03-02 08:00+05:30', 'home'),
  (20, 2, '2025-03-02 08:15+05:30', 'product'),
  (21, 2, '2025-03-03 08:00+05:30', 'home'),
  (22, 2, '2025-03-04 21:00+05:30', 'search'),
  (23, 2, '2025-03-04 21:10+05:30', 'product'),
  (24, 2, '2025-03-04 21:30+05:30', 'cart'),
  (25, 2, '2025-03-04 21:45+05:30', 'checkout'),
  (26, 2, '2025-03-05 07:30+05:30', 'home'),
  (27, 2, '2025-03-05 09:00+05:30', 'product'),
  -- customer 5: a gap of exactly 30 minutes, and a session that crosses midnight
  (28, 5, '2025-03-01 12:00+05:30', 'home'),
  (29, 5, '2025-03-01 12:30+05:30', 'product'),
  (30, 5, '2025-03-03 16:00+05:30', 'product'),
  (31, 5, '2025-03-03 16:10+05:30', 'cart'),
  (32, 5, '2025-03-04 23:50+05:30', 'home'),
  (33, 5, '2025-03-05 00:10+05:30', 'product'),
  -- customer 9 (never ordered)
  (34, 9, '2025-03-01 09:00+05:30', 'home'),
  (35, 9, '2025-03-01 09:02+05:30', 'search'),
  (36, 9, '2025-03-01 09:05+05:30', 'product'),
  (37, 9, '2025-03-08 10:00+05:30', 'home'),
  (38, 9, '2025-03-09 10:00+05:30', 'home');

INSERT INTO routes VALUES
  ('Mumbai',    'Pune',       150),
  ('Mumbai',    'Hyderabad',  710),
  ('Mumbai',    'Delhi',     1400),
  ('Pune',      'Hyderabad',  560),
  ('Pune',      'Bengaluru',  830),
  ('Hyderabad', 'Bengaluru',  570),
  ('Hyderabad', 'Chennai',    630),
  ('Hyderabad', 'Kolkata',   1490),
  ('Bengaluru', 'Chennai',    350),
  ('Chennai',   'Kolkata',   1670),
  ('Delhi',     'Kolkata',   1500),
  ('Kolkata',   'Delhi',     1500);   -- a cycle: Delhi → Kolkata → Delhi

INSERT INTO reviews VALUES
  (1,  1,  1,  5, '2025-01-12'),
  (2,  6,  2,  4, '2025-01-15'),
  (3,  8,  2,  2, '2025-01-20'),
  (4,  9,  4,  5, '2025-02-20'),
  (5,  7,  5,  4, '2025-02-25'),
  (6,  11, 6,  5, '2025-03-08'),
  (7,  6,  7,  3, '2025-03-12'),
  (8,  2,  2,  5, '2025-03-25'),
  (9,  1,  10, 4, '2025-04-15'),
  (10, 13, 9,  3, '2025-05-01'),   -- customer 9 never ordered anything
  (11, 3,  1,  4, '2025-05-02'),
  (12, 12, 5,  2, '2025-05-05'),
  (13, 14, 12, 5, '2025-05-10'),
  (14, 4,  17, 4, '2025-06-25'),
  (15, 15, 13, 1, '2025-07-01'),   -- customer 13 never ordered anything
  (16, 7,  19, 3, '2025-07-20');   -- customer 19 never bought product 7

INSERT INTO discount_tiers VALUES
  ('Bronze',   0,      9999.99, 0),
  ('Silver',   10000,  49999.99, 5),
  ('Gold',     50000,  99999.99, 8),
  ('Platinum', 100000, NULL,     10);

INSERT INTO shipping_zones VALUES
  ('Mumbai', 'West'), ('Pune', 'West'), ('Delhi', 'North'),
  ('Bengaluru', 'South'), ('Hyderabad', 'South'), ('Chennai', 'South'),
  ('Kolkata', 'East');                        -- Dubai, London, Panaji, Singapore missing

INSERT INTO sizes VALUES ('S', 1), ('M', 2), ('L', 3), ('XL', 4);
INSERT INTO colors VALUES ('Black'), ('White'), ('Blue');

-- Phase 4 data -------------------------------------------------------------
INSERT INTO product_details VALUES
  (1,  '{laptop,premium,work}',
       '{"brand": "Zentro", "ram_gb": 32, "storage": {"type": "ssd", "gb": 1024}, "ports": ["usb-c", "usb-c", "hdmi"], "weight_kg": 1.6, "warranty_years": 2}'),
  (2,  '{laptop,portable,work}',
       '{"brand": "Zentro", "ram_gb": 16, "storage": {"type": "ssd", "gb": 512}, "ports": ["usb-c", "usb-c"], "weight_kg": 1.2, "warranty_years": 1}'),
  (3,  '{wireless,work,bestseller}',
       '{"brand": "Clicko", "wireless": true, "dpi": 1600, "battery": {"type": "AA", "count": 1}}'),
  (4,  '{work,gaming}',
       '{"brand": "Clicko", "wireless": false, "switch": "brown", "layout": "US", "warranty_years": 1}'),
  (5,  '{work,portable}',
       '{"brand": "Portly", "ports": ["usb-c", "usb-a", "usb-a", "hdmi", "sd"]}'),
  (6,  '{wireless,premium,travel,bestseller}',
       '{"brand": "Sonora", "wireless": true, "battery_hours": 30, "anc": true, "colors": ["black", "silver"], "warranty_years": 2}'),
  (7,  '{wireless,party}',
       '{"brand": "Sonora", "wireless": true, "battery_hours": 12, "waterproof": "IPX7", "colors": ["black", "blue", "red"]}'),
  (8,  '{Wireless,budget}',                                            -- capital W
       '{"brand": "Sonora", "wireless": true, "battery_hours": "6"}'),  -- a number stored as a string
  (9,  '{kitchen,premium}',
       '{"brand": "Brewly", "capacity_l": 1.2, "power_w": 900, "warranty_years": 1}'),
  (10, '{kitchen}',
       '{"brand": "Edgeline", "blade_cm": 20, "material": "steel"}'),
  (11, '{kitchen,bestseller,healthy}',
       '{"brand": "Brewly", "capacity_l": 4.5, "power_w": 1500, "presets": ["fries", "chicken", "bake"], "warranty_years": 2}'),
  (12, '{}',                                                           -- no tags
       '{"brand": "Lumo", "power_w": 8, "colors": ["white"], "warranty_years": null}'),   -- JSON null
  (15, '{work,premium,gaming}',
       '{"brand": "Zentro", "size_in": 27, "resolution": "3840x2160", "ports": ["hdmi", "hdmi", "displayport", "usb-c"], "warranty_years": 3}');
  -- products 13 (Standing Desk) and 14 (Gift Card) have no details

INSERT INTO events VALUES
  (1,  1,  '2025-10-03 09:50+05:30', '{"type": "search", "query": "keyboard", "results": 4, "device": {"os": "android", "app": "5.2.0"}}'),
  (2,  1,  '2025-10-03 09:55+05:30', '{"type": "add_to_cart", "product_id": 4, "qty": 1, "device": {"os": "android", "app": "5.2.0"}}'),
  (3,  1,  '2025-10-03 09:58+05:30', '{"type": "add_to_cart", "product_id": 5, "qty": 1, "device": {"os": "android", "app": "5.2.0"}}'),
  (4,  1,  '2025-10-03 10:02+05:30', '{"type": "checkout", "order_id": 27, "items": [{"product_id": 4, "qty": 1, "price": 6500}, {"product_id": 5, "qty": 1, "price": 3500}], "coupon": "SAVE10", "device": {"os": "android", "app": "5.2.0"}}'),
  (5,  12, '2025-11-02 19:10+05:30', '{"type": "search", "query": "laptop", "results": 2, "device": {"os": "ios", "app": "5.1.0"}}'),
  (6,  12, '2025-11-02 19:20+05:30', '{"type": "add_to_cart", "product_id": 2, "qty": 1, "device": {"os": "ios", "app": "5.1.0"}}'),
  (7,  12, '2025-11-02 19:25+05:30', '{"type": "app_error", "code": "PAYMENT_TIMEOUT", "device": {"os": "ios", "app": "5.1.0"}}'),
  (8,  12, '2025-11-02 19:31+05:30', '{"type": "checkout", "order_id": 29, "items": [{"product_id": 2, "qty": 1, "price": 85000}], "device": {"os": "ios", "app": "5.1.0"}}'),
  (9,  17, '2025-12-05 10:40+05:30', '{"type": "add_to_cart", "product_id": 14, "qty": "10", "device": {"os": "web"}}'),   -- qty as a string
  (10, 17, '2025-12-05 10:45+05:30', '{"type": "checkout", "order_id": 31, "items": [{"product_id": 14, "qty": 10, "price": 1000}], "coupon": "GIFT5", "device": {"os": "web"}}'),
  (11, 20, '2025-12-24 21:00+05:30', '{"type": "search", "query": "coffee", "results": 1, "device": {"os": "android", "app": "5.3.0"}}'),
  (12, 20, '2025-12-24 21:05+05:30', '{"type": "checkout", "order_id": 32, "items": [{"product_id": 9, "qty": 1, "price": 9000}, {"product_id": 10, "qty": 1, "price": 4000}], "coupon": "XMAS", "device": {"os": "android", "app": "5.3.0"}}'),
  (13, 5,  '2026-01-08 08:30+05:30', '{"type": "search", "query": "headphones", "results": 1, "device": {"os": "ios", "app": "5.3.0"}}'),
  (14, 5,  '2026-01-08 08:50+05:30', '{"type": "checkout", "order_id": 33, "items": [{"product_id": 6, "qty": 1, "price": 18000}], "device": {"os": "ios", "app": "5.3.0"}}'),
  (15, 9,  '2026-01-20 13:00+05:30', '{"type": "search", "query": "standing desk", "results": 0, "device": {"os": "web"}}'),
  (16, 9,  '2026-01-20 13:02+05:30', '{"type": "search", "query": "desk", "results": 2, "device": {"os": "web"}}'),
  (17, 9,  '2026-01-20 13:05+05:30', '{"type": "app_error", "code": "OUT_OF_STOCK", "product_id": 13, "device": {"os": "web"}}'),
  (18, 3,  '2026-02-01 18:00+05:30', '{"type": "add_to_cart", "product_id": 3, "qty": 3, "device": {"os": "android", "app": "5.3.0"}}'),
  (19, 3,  '2026-02-01 18:03+05:30', '{"type": "add_to_cart", "product_id": 5, "qty": 1, "device": {"os": "android", "app": "5.3.0"}}'),
  (20, 3,  '2026-02-01 18:10+05:30', '{"type": "checkout", "order_id": 35, "items": [{"product_id": 3, "qty": 2, "price": 1500}, {"product_id": 5, "qty": 1, "price": 3500}], "device": {"os": "android", "app": "5.3.0"}}'),   -- app bug: the order has qty 3
  (21, 2,  '2026-02-14 11:00+05:30', '{"type": "search", "query": "lamp", "results": 1, "device": {"os": "ios", "app": "5.3.1"}}'),
  (22, 2,  '2026-02-14 11:04+05:30', '{"type": "app_error", "code": "PAYMENT_TIMEOUT", "device": {"os": "ios", "app": "5.3.1"}}'),
  (23, 2,  '2026-02-14 11:09+05:30', '{"type": "checkout", "order_id": 36, "items": [{"product_id": 12, "qty": 2, "price": 2200}], "coupon": "SAVE10", "device": {"os": "ios", "app": "5.3.1"}}'),
  (24, 9,  '2026-02-15 09:00+05:30', '{"type": "search", "query": "laptop", "results": 2}');   -- no device

INSERT INTO inventory VALUES
  ('Pune',  1,  5,  '2026-02-10 18:00+05:30'),
  ('Pune',  2,  3,  '2026-02-10 18:00+05:30'),
  ('Pune',  3,  40, '2026-02-10 18:00+05:30'),
  ('Pune',  4,  12, '2026-02-10 18:00+05:30'),
  ('Pune',  5,  25, '2026-02-10 18:00+05:30'),
  ('Pune',  6,  8,  '2026-02-10 18:00+05:30'),
  ('Pune',  9,  6,  '2026-02-10 18:00+05:30'),
  ('Pune',  10, 15, '2026-02-10 18:00+05:30'),
  ('Pune',  11, 4,  '2026-02-10 18:00+05:30'),
  ('Pune',  12, 20, '2026-02-10 18:00+05:30'),
  ('Delhi', 1,  2,  '2026-02-10 18:00+05:30'),
  ('Delhi', 3,  30, '2026-02-10 18:00+05:30'),
  ('Delhi', 6,  5,  '2026-02-10 18:00+05:30'),
  ('Delhi', 7,  10, '2026-02-10 18:00+05:30'),
  ('Delhi', 11, 3,  '2026-02-10 18:00+05:30'),
  ('Delhi', 12, 7,  '2026-02-10 18:00+05:30');

INSERT INTO stock_feed VALUES
  (1,  'Pune',  1,  4,  '2026-02-12 09:00+05:30'),
  (2,  'Pune',  3,  38, '2026-02-12 09:00+05:30'),
  (3,  'Pune',  7,  6,  '2026-02-12 09:00+05:30'),   -- new for Pune
  (4,  'Delhi', 6,  0,  '2026-02-12 10:00+05:30'),   -- sold out
  (5,  'Delhi', 15, 3,  '2026-02-12 10:00+05:30'),   -- new for Delhi
  (6,  'Pune',  3,  36, '2026-02-13 09:00+05:30'),   -- second count for (Pune, 3): this one is newer
  (7,  'Pune',  99, 5,  '2026-02-13 09:00+05:30'),   -- product 99 does not exist
  (8,  'Delhi', 12, 9,  '2026-02-09 08:00+05:30'),   -- stale: older than the stock row
  (9,  'Pune',  13, 2,  '2026-02-14 12:00+05:30'),   -- new for Pune
  (10, 'Delhi', 1,  2,  '2026-02-14 12:00+05:30'),   -- same qty as now: nothing to change
  (11, 'Pune',  5,  22, '2026-02-14 12:00+05:30'),
  (12, 'Delhi', 7,  -2, '2026-02-14 12:00+05:30');   -- impossible qty

INSERT INTO product_attributes VALUES
  (1,  'color', 'silver'), (1,  'weight_kg', '1.6'),  (1,  'warranty', '2 years'),
  (2,  'color', 'silver'), (2,  'weight_kg', '1.2'),  (2,  'warranty', '1'),
  (3,  'color', 'black'),  (3,  'weight_kg', '0.09'),
  (4,  'color', 'Black'),  (4,  'weight_kg', '0.9'),  (4,  'warranty', '1'),
  (6,  'color', 'black'),  (6,  'weight_kg', '0.25'), (6,  'warranty', '2'),
  (7,  'color', 'blue'),   (7,  'weight_kg', 'light'),
  (9,  'colour', 'black'), (9,  'weight_kg', '2.5'),  (9,  'warranty', '1'),
  (11, 'color', 'black'),  (11, 'weight_kg', '4.2'),  (11, 'warranty', '2');

INSERT INTO price_history VALUES
  (1,  125000, '[2024-06-01,2025-01-01)'),
  (1,  118000, '[2025-01-01,2025-02-01)'),   -- January sale
  (1,  120000, '[2025-02-01,)'),             -- no upper bound: the current price
  (2,  85000,  '[2024-06-01,)'),
  (3,  1500,   '[2024-06-01,2025-03-01)'),
  (3,  1500,   '[2025-02-15,)'),             -- overlaps the row above
  (6,  18000,  '[2024-06-01,2025-03-01)'),
  (6,  17500,  '[2025-03-01,2025-04-01)'),
  (6,  18000,  '[2025-04-01,)'),
  (8,  2500,   '[2024-06-01,2025-05-01)'),
  (8,  2400,   '[2025-05-01,)'),
  (9,  9000,   '[2024-06-01,)'),
  (11, 11000,  '[2024-06-01,2025-06-01)'),
  (11, 10500,  '[2025-06-01,2025-07-01)'),
  (11, 11000,  '[2025-07-01,)'),
  (12, 2200,   '[2024-06-01,2025-01-01)'),
  (12, 2200,   '[2025-02-01,)');             -- gap: no price in January 2025

-- Phase 6 data -------------------------------------------------------------
INSERT INTO accounts VALUES
  (1, 'Aarav',  5000.00),
  (2, 'Diya',   3000.00),
  (3, 'Kabir',     0.00),
  (4, 'Ananya', 1200.00);                    -- total: 9,200.00

INSERT INTO jobs VALUES
  (1,  'send_email',    '{"to": "aarav@mail.test", "template": "welcome"}',  'done',    1, '2026-02-14 09:00+05:30', NULL, NULL),
  (2,  'send_email',    '{"to": "diya@mail.test", "template": "welcome"}',   'done',    1, '2026-02-14 09:05+05:30', NULL, NULL),
  (3,  'resize_image',  '{"product_id": 7}',                                 'failed',  3, '2026-02-14 10:00+05:30', NULL, NULL),
  (4,  'send_email',    '{"to": "kabir@mail.test", "template": "receipt"}',  'queued',  0, '2026-02-15 08:00+05:30', NULL, NULL),
  (5,  'export_report', '{"month": "2026-01"}',                              'queued',  0, '2026-02-15 08:10+05:30', NULL, NULL),
  (6,  'send_email',    '{"to": "ananya@mail.test", "template": "receipt"}', 'queued',  0, '2026-02-15 08:20+05:30', NULL, NULL),
  (7,  'resize_image',  '{"product_id": 12}',                                'queued',  1, '2026-02-15 08:30+05:30', NULL, NULL),   -- failed once, queued again
  (8,  'send_email',    '{"to": "ishaan@mail.test", "template": "promo"}',   'queued',  0, '2099-01-01 00:00+05:30', NULL, NULL),   -- scheduled far in the future
  (9,  'export_report', '{"month": "2025-12"}',                              'running', 1, '2026-02-15 07:00+05:30', 'worker-2', '2026-02-15 07:00:05+05:30'),   -- stuck: its worker died
  (10, 'send_email',    '{"to": "saanvi@mail.test", "template": "receipt"}', 'queued',  0, '2026-02-15 08:40+05:30', NULL, NULL);

INSERT INTO table_bookings VALUES
  (1, 1, '2026-02-20 19:00+05:30', 'Aarav',  2),
  (2, 1, '2026-02-20 20:00+05:30', 'Diya',   4),
  (3, 2, '2026-02-20 19:00+05:30', 'Kabir',  2),
  (4, 3, '2026-02-20 21:00+05:30', 'Ananya', 6),
  (5, 4, '2026-02-20 20:00+05:30', 'Ishaan', 3);

ANALYZE;
