CREATE TABLE departments (
    department_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name TEXT,
    budget NUMERIC(12, 2),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE employees (
    employee_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    full_name TEXT,
    email TEXT,
    salary NUMERIC(12, 2),
    joined_on DATE,
    department_id INTEGER,
    manager_id INTEGER,
    status TEXT DEFAULT 'active',
    metadata JSONB DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE customers (
    customer_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    full_name TEXT,
    email TEXT,
    phone TEXT,
    city TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE orders (
    order_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_id BIGINT,
    order_status TEXT DEFAULT 'pending',
    total_amount NUMERIC(12, 2),
    shipping_city TEXT,
    ordered_at TIMESTAMPTZ DEFAULT NOW(),
    shipped_at TIMESTAMPTZ
);

CREATE TABLE order_items (
    order_item_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id BIGINT,
    product_name TEXT,
    quantity INTEGER,
    unit_price NUMERIC(10, 2)
);

CREATE TABLE legacy_employees (
    employee_id_text TEXT,
    full_name TEXT,
    salary_text TEXT,
    joined_on_text TEXT,
    active_text TEXT,
    department_code TEXT
);

INSERT INTO
    departments (name, budget)
VALUES ('Engineering', 1000000),
    ('Finance', 500000),
    ('HR', 300000),
    ('Sales', 700000);

INSERT INTO
    employees (
        full_name,
        email,
        salary,
        joined_on,
        department_id,
        manager_id,
        status,
        metadata
    )
VALUES (
        'Aarav Sharma',
        'aarav@example.com',
        120000,
        '2020-01-15',
        1,
        NULL,
        'active',
        '{"skills": ["PostgreSQL", "Node.js"], "level": "manager"}'
    ),
    (
        'Meera Patel',
        'MEERA@example.com',
        85000,
        '2021-06-10',
        1,
        1,
        'active',
        '{"skills": ["React", "TypeScript"]}'
    ),
    (
        'Rohan Verma',
        'rohan@example.com',
        65000,
        '2023-03-01',
        2,
        NULL,
        'active',
        '{"skills": ["Accounting"]}'
    ),
    (
        'Isha Singh',
        NULL,
        55000,
        '2022-08-19',
        3,
        NULL,
        'inactive',
        '{}'
    ),
    (
        'Kabir Khan',
        'kabir@example.com',
        75000,
        '2019-11-05',
        4,
        NULL,
        'active',
        '{"skills": ["Sales", "CRM"]}'
    ),
    (
        'Nisha Shah',
        'nisha@example.com',
        NULL,
        '2024-02-10',
        99,
        500,
        'probation',
        '{}'
    );

INSERT INTO
    customers (full_name, email, phone, city)
VALUES (
        'Rahul Joshi',
        'rahul@example.com',
        '9876543210',
        'Mumbai'
    ),
    (
        'Priya Mehta',
        'priya@example.com',
        '+91-9988776655',
        NULL
    ),
    (
        'Duplicate Priya',
        'PRIYA@example.com',
        '9988776655',
        'Pune'
    ),
    (
        'John Mathew',
        NULL,
        '022-44556677',
        'Mumbai'
    );

INSERT INTO
    orders (
        customer_id,
        order_status,
        total_amount,
        shipping_city,
        ordered_at,
        shipped_at
    )
VALUES (
        1,
        'shipped',
        2500,
        'Mumbai',
        NOW() - INTERVAL '20 days',
        NOW() - INTERVAL '18 days'
    ),
    (
        1,
        'pending',
        1500,
        'Mumbai',
        NOW() - INTERVAL '10 days',
        NULL
    ),
    (
        2,
        'completed',
        3200,
        'Pune',
        NOW() - INTERVAL '5 days',
        NOW() - INTERVAL '3 days'
    ),
    (
        3,
        'cancelled',
        900,
        'Pune',
        NOW() - INTERVAL '100 days',
        NULL
    ),
    (
        4,
        'PENDING',
        1800,
        'Mumbai',
        NOW() - INTERVAL '15 days',
        NULL
    ),
    (
        999,
        'unknown',
        -500,
        NULL,
        NOW(),
        NULL
    );

INSERT INTO
    order_items (
        order_id,
        product_name,
        quantity,
        unit_price
    )
VALUES (1, 'Keyboard', 1, 1500),
    (1, 'Mouse', 2, 500),
    (2, 'Monitor Stand', 1, 1500),
    (3, 'Headphones', 2, 1600),
    (4, 'USB Cable', 3, 300),
    (5, 'Office Chair', 1, 1800),
    (999, 'Orphan Product', 1, 100);

INSERT INTO
    legacy_employees (
        employee_id_text,
        full_name,
        salary_text,
        joined_on_text,
        active_text,
        department_code
    )
VALUES (
        '101',
        'Vikram Rao',
        '75000.50',
        '2022-01-15',
        'yes',
        'ENG'
    ),
    (
        '102',
        'Ananya Das',
        '₹85,000',
        '15/02/2021',
        'Y',
        'FIN'
    ),
    (
        '103',
        'Dev Malhotra',
        'N/A',
        '2020-10-25',
        'no',
        'HR'
    ),
    (
        'ABC',
        'Sara Ali',
        '65000',
        'not-a-date',
        '1',
        'SALES'
    ),
    (
        '105',
        'Karan Roy',
        '',
        '2023-06-01',
        'FALSE',
        'ENG'
    ),
    (
        '106',
        'Neha Kapoor',
        ' 92,500.75 ',
        '01/12/2020',
        'true',
        'UNKNOWN'
    );

-- Level 1 — CRUD Fundamentals
-- 1. Insert a department
-- Insert a new department named Legal with a budget of 400000.
--
-- Return the generated department_id without running a second query.
-- Write your answer below:
INSERT INTO
    departments (name, budget)
VALUES ('Legal', 400000)
RETURNING
    *

-- 2. Insert a complete employee
-- Insert an employee with:
-- - Full name: Yogesh Patil
-- - Email: yogesh@example.com
-- - Salary: 80000
-- - Joined date: today
-- - Department: Engineering
-- - Status: active
-- Do not hardcode the Engineering department ID. Obtain it using a subquery.
-- Write your answer below:
INSERT INTO
    employees (
        full_name,
        email,
        salary,
        joined_on,
        department_id,
        status
    )
VALUES (
        'Yogesh Patil',
        ' yogesh@example.com',
        80000,
        CURRENT_DATE,
        (
            SELECT department_id
            FROM departments
            WHERE
                name = 'Engineering'
        ),
        'active'
    );

-- method 2
DO $$
    DECLARE 
      v_department_id INTEGER;
    BEGIN
    SELECT department_id
    INTO v_department_id
    FROM departments 
    WHERE 
      name = 'Engineering';

   INSERT INTO employees (
        full_name,
        email,
        salary,
        joined_on,
        department_id,
        status
    )
    VALUES
    (
       'm',
        'm@gmail.com',
        8000,
        CURRENT_DATE,
        v_department_id,
        'active'
    );

END;
$$;

-- 3. Insert multiple rows
-- Insert three customers in one SQL statement.
--
-- At least one customer should have a NULL city.
-- Write your answer below:

INSERT INTO
    customers (full_name, email, phone, city)
VALUES (
        'alice',
        'alice@gmail.com',
        124345,
        'pune'
    ),
    (
        'bob',
        'bob@gmail.com',
        434785,
        'pune'
    ),
    (
        'john',
        'john@gmail.com',
        55678,
        NULL
    );

-- 4. Insert data from another table
-- Create a table named inactive_employee_archive.
--
-- Insert all currently inactive employees into it using:
-- INSERT INTO ... SELECT ...
--
-- Do not manually specify employee values.
-- Write your answer below:

CREATE TABLE IF NOT EXISTS inactive_employee_archive (
    LIKE employees INCLUDING INDEXES
);

INSERT INTO
    inactive_employee_archive (
        employee_id,
        full_name,
        email,
        salary,
        joined_on,
        department_id,
        manager_id,
        status,
        metadata,
        created_at,
        updated_at
    )
SELECT
    employee_id,
    full_name,
    email,
    salary,
    joined_on,
    department_id,
    manager_id,
    status,
    metadata,
    created_at,
    updated_at
FROM employees
WHERE
    status = 'inactive';

-- 5. Basic update
-- Increase the salary of employee Meera Patel by 10%.
--
-- The query must use the current salary rather than hardcoding the new salary.
-- Write your answer below:

UPDATE employees
SET
    salary = salary + ((salary * 10) / 100)
WHERE
    full_name = 'Meera Patel';

-- 6. Update multiple columns
-- Change Nisha Shah to:
-- - Salary: 60000
-- - Status: active
-- - Department: HR
-- - updated_at: current timestamp
-- Do not hardcode the HR department ID.
-- Write your answer below:
DO $$
DECLARE
    v_department_id INTEGER;
BEGIN
    SELECT department_id
    INTO v_department_id
    FROM departments
    WHERE name = 'Engineering';

    UPDATE employees
    SET
        salary = 60000,
        status = 'active',
        department_id = v_department_id,
        updated_at = CURRENT_TIMESTAMP
    WHERE full_name = 'Nisha Shah';
END;
$$;

-- 7. Conditional update
-- Set every employee with a NULL salary to 40000.
--
-- Return the employee ID, name, old salary assumption, and new salary.
--
-- Think about whether PostgreSQL can directly return the old value from a normal UPDATE.
-- Write your answer below:

UPDATE employees
SET
    salary = 40000
WHERE
    salary IS NULL
RETURNING
    employee_id,
    full_name,
    OLD.salary as previous_salary,
    NEW.salary as new_salary;

-- 8. Delete safely
-- Delete cancelled orders older than 90 days.
--
-- Return the deleted rows so you can verify what was removed.
-- Write your answer below:
DELETE FROM orders
WHERE
    order_status = 'cancelled'
    AND ordered_at < CURRENT_TIMESTAMP - INTERVAL '90 days'
RETURNING
    *;

-- 9. Transactional CRUD
-- Inside one transaction:
-- 1. Insert a new customer.
-- 2. Insert an order for that customer.
-- 3. Insert two order items.
-- 4. Update the order total from its items.
-- 5. Commit only if everything succeeds.
-- Use the generated customer and order IDs instead of querying by name.
-- Write your answer below:

DO $$

DECLARE
 v_customer_id BIGINT;
v_order_id BIGINT;
v_total_order_price BIGINT;

BEGIN
INSERT INTO
    customers (full_name, email, phone, city)
VALUES (
        'alex',
        'alex@gmail.com',
        754656,
        'delhi'
    )

RETURNING
    customer_id INTO v_customer_id;

INSERT INTO
    orders (
        customer_id,
        order_status,
        shipping_city
    )
VALUES (
        v_customer_id,
        'pending',
        'mumbai'
    )
RETURNING
    order_id INTO v_order_id;

INSERT INTO
    order_items (
        order_id,
        product_name,
        quantity,
        unit_price
    )
VALUES (
        v_order_id,
        'product 1',
        2,
        1200
    ),
    (
        v_order_id,
        'product 2',
        5,
        1300
    );

--Update the order total from its items.
SELECT
    SUM(quantity * unit_price) AS total_order_item_price INTO v_total_order_price
FROM order_items
WHERE
    order_id = v_order_id;

UPDATE orders
SET
    total_amount = v_total_order_price
WHERE
    order_id = v_order_id;
END;
$$;

-- 10. Controlled rollback
-- Write a transaction that updates every employee’s salary by 50%.
--
-- Inspect the result inside the transaction and then roll it back.
--
-- Verify afterward that salaries did not change.
-- Level 2 — ALTER TABLE and Constraints
-- Write your answer below:

BEGIN;

SELECT * FROM employees;

UPDATE employees SET salary = salary * 1.5;

SELECT * FROM employees;

ROLLBACK;

SELECT * FROM employees;

-- 11. Add a column
-- Add an optional phone column to employees.
--
-- The column should store international phone numbers, spaces, hyphens, and +.
--
-- Choose an appropriate data type.
-- Write your answer below:

ALTER TABLE employees ADD COLUMN phone VARCHAR(30)

ALTER TABLE employees
ADD CONSTRAINT check_employee_phone CHECK (
    phone is NULL
    OR phone ~ '^\+[0-9][0-9 -]*$'
)

-- 12. Add a default
-- Add a country_code column to customers.
--
-- Requirements:
-- - Data type should hold values such as IN, US, and GB.
-- - Default should be IN.
-- - Existing rows should receive a meaningful value.
-- - Future inserts should automatically use IN.
-- Write your answer below:
ALTER TABLE customers ADD COLUMN country_code VARCHAR(2) DEFAULT 'IN'

-- 13. Rename a column
-- Rename:
-- employees.full_name
--
-- to:
-- employees.employee_name
--
-- Then write a query to rename it back.
--
-- Think about what application code could break after this migration.
-- Write your answer below:
BEGIN;

ALTER TABLE employees RENAME COLUMN full_name TO employee_name;

-- Inspect the renamed column
SELECT employee_name FROM employees;

-- Rename it back explicitly
ALTER TABLE employees RENAME COLUMN employee_name TO full_name;

COMMIT;

-- 14. Set NOT NULL
-- Make departments.name non-null.
--
-- Before adding the constraint:
-- 1. Find rows that violate it.
-- 2. Decide whether to update or delete those rows.
-- 3. Apply the constraint.
-- Write your answer below:

BEGIN;

DELETE FROM departments WHERE name IS NULL;

ALTER TABLE departments
ADD CONSTRAINT department_name_not_null CHECK (name IS NOT NULL);

COMMIT;

-- 15. Add a unique constraint
-- Ensure department names cannot be duplicated.
--
-- Test it by attempting to insert another Engineering department.
--
-- Determine whether Engineering and engineering should be treated as duplicates.
-- Write your answer below:

-- Step 1: Check existing duplicates
SELECT LOWER(BTRIM(name)), COUNT(*)
FROM departments
GROUP BY
    LOWER(BTRIM(name))
HAVING
    COUNT(*) > 1;

-- Step 2: Add constraints
BEGIN;

ALTER TABLE departments ALTER COLUMN name SET NOT NULL;

ALTER TABLE departments
ADD CONSTRAINT chk_department_name CHECK (BTRIM(name) <> '');

CREATE UNIQUE INDEX uq_department_name_ci ON departments (LOWER(BTRIM(name)));

COMMIT;

-- Step 3: Test duplicate insertion
INSERT INTO departments (name) VALUES ('engineering');

-- 16. Case-insensitive unique email
-- Ensure two employees cannot have these emails simultaneously:
-- meera@example.com
-- MEERA@example.com
--
-- A normal UNIQUE(email) constraint is not sufficient for this requirement.
--
-- Handle NULL emails correctly.
-- Write your answer below:

-- first we will check for duplicates
SELECT
    LOWER(email) AS normalized_email,
    COUNT(*) AS duplicate_count,
    ARRAY_AGG(
        employee_id
        ORDER BY employee_id
    ) AS employee_ids,
    ARRAY_AGG(
        email
        ORDER BY employee_id
    ) AS stored_emails
FROM employees
WHERE
    email IS NOT NULL
GROUP BY
    LOWER(email)
HAVING
    COUNT(*) > 1;

CREATE UNIQUE INDEX employee_email_ci_unique_idx ON employees (LOWER(email))
WHERE
    email IS NOT NULL;

-- 17. Add check constraints
-- Add constraints ensuring:
-- - Salary cannot be negative.
-- - Department budget cannot be negative.
-- - Order total cannot be negative.
-- - Order-item quantity must be greater than zero.
-- - Unit price cannot be negative.
-- The existing dirty data must be corrected before all constraints can succeed.
-- Write your answer below:

BEGIN;

-- 1. Inspect existing violations first

SELECT * FROM employees WHERE salary < 0;

SELECT * FROM departments WHERE budget < 0;

SELECT * FROM orders WHERE total_amount < 0;

SELECT * FROM order_items WHERE quantity <= 0;

SELECT * FROM order_items WHERE unit_price < 0;

-- 2. Clean invalid existing data
-- For this practice dataset, change negative order totals to 0.
-- In a real system, you should investigate why the value became negative.

UPDATE orders SET total_amount = 0 WHERE total_amount < 0;

-- 3. Add constraints

ALTER TABLE employees
ADD CONSTRAINT employees_salary_non_negative CHECK (salary >= 0);

ALTER TABLE departments
ADD CONSTRAINT departments_budget_non_negative CHECK (budget >= 0);

ALTER TABLE orders
ADD CONSTRAINT orders_total_amount_non_negative CHECK (total_amount >= 0);

ALTER TABLE order_items
ADD CONSTRAINT order_items_quantity_positive CHECK (quantity > 0);

ALTER TABLE order_items
ADD CONSTRAINT order_items_unit_price_non_negative CHECK (unit_price >= 0);

COMMIT;

-- 18. Restrict employee statuses
-- Allow only:
-- active
-- inactive
-- probation
-- terminated
--
-- First identify invalid or inconsistently cased values.
--
-- Then clean the data and add the constraint.
-- Write your answer below:

-- Identify invalid and inconsistently cased statuses
BEGIN;

SELECT employee_id, full_name, status
FROM employees
WHERE
    LOWER(BTRIM(status)) NOT IN (
        'active',
        'inactive',
        'probation',
        'terminated'
    )
    OR status <> LOWER(BTRIM(status));

-- Clean existing data
UPDATE employees
SET
    status = LOWER(BTRIM(status))
WHERE
    LOWER(BTRIM(status)) IN (
        'active',
        'inactive',
        'probation',
        'terminated'
    )
    AND status IS DISTINCT FROM LOWER(BTRIM(status));

-- Create an ENUM and apply it
CREATE TYPE employee_statuses AS ENUM ('active', 'inactive', 'probation','terminated');

ALTER TABLE employees
ALTER COLUMN status TYPE employee_statuses USING status::employee_statuses;

COMMIT;

-- 19. Add foreign keys
-- Add these foreign keys:
-- employees.department_id → departments.department_id
-- orders.customer_id → customers.customer_id
-- order_items.order_id → orders.order_id
--
-- Choose an appropriate deletion strategy for each:
-- - RESTRICT
-- - CASCADE
-- - SET NULL
-- Explain why you chose each one.
-- Write your answer below:

ALTER TABLE employees
ADD CONSTRAINT fk_department_id FOREIGN KEY (department_id) REFERENCES departments (department_id) ON DELETE RESTRICT;

ALTER TABLE orders
ADD CONSTRAINT fk_customer_id FOREIGN KEY (customer_id) REFERENCES customers (customer_id) ON DELETE RESTRICT;

ALTER TABLE order_items
ADD CONSTRAINT fk_order_id FOREIGN KEY (order_id) REFERENCES orders (order_id) ON DELETE CASCADE;

-- 20. Self-referencing foreign key
-- Add this relationship:
-- employees.manager_id → employees.employee_id
--
-- Requirements:
-- - An employee may have no manager.
-- - Deleting a manager must not delete their employees.
-- - Existing invalid manager IDs must be handled first.
-- Also investigate whether this constraint prevents an employee from being their own manager.
-- Write your answer below:
BEGIN;

-- Step 1: Identify invalid manager references
SELECT e.employee_id, e.full_name, e.manager_id
FROM employees AS e
WHERE
    e.manager_id IS NOT NULL
    AND NOT EXISTS (
        SELECT 1
        FROM employees AS m
        WHERE
            m.employee_id = e.manager_id
    );

-- Step 2: Clean invalid manager references
UPDATE employees AS e
SET
    manager_id = NULL
WHERE
    e.manager_id IS NOT NULL
    AND NOT EXISTS (
        SELECT 1
        FROM employees AS m
        WHERE
            m.employee_id = e.manager_id
    );

-- Step 3: Add self-referencing foreign key
ALTER TABLE employees
ADD CONSTRAINT fk_employee_manager_id FOREIGN KEY (manager_id) REFERENCES employees (employee_id) ON DELETE SET NULL;

-- Step 4: Prevent self-management
ALTER TABLE employees
ADD CONSTRAINT chk_employee_not_own_manager CHECK (
    manager_id IS DISTINCT FROM employee_id
);

COMMIT;

-- Level 3 — Type Conversion and Data Cleanup
-- 21. Find invalid integer values
-- From legacy_employees.employee_id_text, identify rows that cannot safely be converted to INTEGER.
--
-- Do not attempt the cast until invalid values are isolated.
-- Write your answer below:

SELECT employee_id_text
FROM legacy_employees
WHERE
    NOT pg_input_is_valid (employee_id_text, 'integer');

-- 22. Convert employee IDs
-- Create a converted result containing:
-- employee_id INTEGER
-- full_name TEXT
--
-- Only include rows whose employee IDs are valid integers.
--
-- Use explicit casting.
-- Write your answer below:

SELECT employee_id_text::INTEGER, full_name
FROM legacy_employees
WHERE
    pg_input_is_valid (employee_id_text, 'integer');

-- 23. Clean and convert salaries
-- Convert these values into NUMERIC(12,2):
-- 75000.50
-- ₹85,000
--  92,500.75
--
-- Handle:
-- - Currency symbols
-- - Commas
-- - Leading and trailing whitespace
-- - Empty strings
-- - N/A
-- Invalid salary values should become NULL, not crash the query.
-- Write your answer below:

-- 24. Convert mixed date formats
-- Convert both date formats:
-- 2022-01-15
-- 15/02/2021
--
-- into PostgreSQL DATE.
--
-- Values such as not-a-date should become NULL.
--
-- Do not rely on implicit date conversion.
-- Write your answer below:
SELECT
    date_text,
    CASE
        WHEN date_text ~ '^\d{4}-\d{2}-\d{2}$'
        AND pg_input_is_valid (date_text, 'date') THEN date_text::DATE
        WHEN date_text ~ '^\d{2}/\d{2}/\d{4}$' THEN TO_DATE(date_text, 'DD/MM/YYYY')
        ELSE NULL
    END AS converted_date
FROM legacy_employees;

-- 25. Convert text to boolean
-- Convert these values to real PostgreSQL booleans:
-- yes
-- Y
-- 1
-- true
-- TRUE
-- no
-- N
-- 0
-- false
-- FALSE
--
-- Unexpected values should become NULL.
--
-- Use CASE.
-- Write your answer below:

SELECT
    CASE
        WHEN pg_input_is_valid (text_input, 'boolean') THEN text_input::BOOLEAN
        ELSE NULL
    END AS converted_boolean

-- 26. Build a clean staging table
-- Create a new table named clean_employees.
--
-- Populate it from legacy_employees with these types:
-- employee_id INTEGER
-- full_name TEXT
-- salary NUMERIC(12, 2)
-- joined_on DATE
-- is_active BOOLEAN
-- department_code TEXT
--
-- Do not allow a single invalid record to crash the complete insert.
-- Write your answer below:
BEGIN;

CREATE TABLE IF NOT EXISTS clean_employees (
    employee_id INTEGER,
    full_name TEXT,
    salary NUMERIC(12, 2),
    joined_on DATE,
    is_active BOOLEAN,
    department_code TEXT
);

INSERT INTO
    clean_employees (
        employee_id,
        full_name,
        salary,
        joined_on,
        is_active,
        department_code
    )
SELECT
    CASE
        WHEN pg_input_is_valid (employee_id_text, 'integer') THEN employee_id_text::INTEGER
    END,
    full_name,
    CASE
        WHEN pg_input_is_valid (salary_text, 'numeric(12,2)') THEN salary_text::NUMERIC(12, 2)
    END,
    CASE
        WHEN pg_input_is_valid (joined_on_text, 'date') THEN joined_on_text::DATE
    END,
    CASE
        WHEN pg_input_is_valid (is_active, 'boolean') THEN is_active::BOOLEAN
    END,
    department_code
FROM legacy_employees;

COMMIT;

-- 27. ALTER COLUMN with USING
-- Create this test table:
-- CREATE TABLE salary_import (
--     salary TEXT
-- );
--
-- INSERT INTO salary_import (salary)
-- VALUES
--     ('10000'),
--     ('25000.50'),
--     ('50000');
--
-- Change salary from TEXT to NUMERIC(12,2) using:
-- ALTER TABLE ... ALTER COLUMN ... TYPE ... USING ...
--
-- Then add a dirty value such as ₹10,000 and observe why the same migration fails.
-- Write your answer below:
CREATE TABLE salary_import (salary TEXT);

INSERT INTO
    salary_import (salary)
VALUES ('10000'),
    ('25000.50'),
    ('50000');

ALTER TABLE salary_import
ALTER COLUMN salary TYPE NUMERIC(12, 2) USING (salary::NUMERIC(12, 2));

-- 28. Convert status into an enum
-- Create an enum type for order statuses:
-- pending
-- processing
-- shipped
-- completed
-- cancelled
--
-- Then convert orders.order_status from TEXT to the enum.
--
-- You must first handle:
-- - PENDING
-- - unknown
-- - Any other invalid status
-- Write a rollback migration that converts the enum column back to TEXT.
-- Write your answer below:

BEGIN;

CREATE TYPE order_statuses_enum AS ENUM('pending', 'processing', 'shipped','completed','cancelled');

UPDATE orders SET order_status = LOWER(TRIM(order_status));

UPDATE orders
SET
    order_status = 'pending'
WHERE
    order_status NOT IN (
        'pending',
        'processing',
        'shipped',
        'completed',
        'cancelled'
    );

ALTER TABLE orders
ALTER COLUMN order_status TYPE order_statuses_enum USING (
    order_status::order_statuses_enum
);

ROLLBACK;

-- 29. Convert monetary values to integer cents
-- Create a new total_amount_cents BIGINT column.
--
-- Populate it from orders.total_amount.
--
-- Examples:
-- 2500.00 → 250000
-- 99.99   → 9999
--
-- Then answer:
-- - How will you handle rounding?
-- - What happens with values containing more than two decimal places?
-- - Is integer-cents storage always better than NUMERIC?
-- Write your answer below:
BEGIN;

ALTER TABLE orders ADD COLUMN total_amount_cents BIGINT;

UPDATE orders
SET
    total_amount_cents = ROUND(total_amount * 100)::BIGINT;

COMMIT;

-- 30. Phone-number conversion trap
-- Someone suggests changing:
-- customers.phone TEXT
--
-- to:
-- customers.phone BIGINT
--
-- Your task is to prove why this is a bad migration.
--
-- Consider:
-- - +91
-- - Leading zeroes
-- - Hyphens
-- - Extensions
-- - International formats
-- - Arithmetic meaning
-- Then design a better phone storage strategy.
-- Write your answer below:
this is very bad idea because when we try to change the type of the column then it will simply give error because bigint does not store hyphen
and white space
and does not know about leading 0 which that is why it should be text only

-- Level 4 — Advanced UPDATE and Data Manipulation
-- 31. Department-based salary update
-- Apply these raises:
-- - Engineering: 12%
-- - Finance: 8%
-- - HR: 6%
-- - Sales: 10%
-- - Any other department: 3%
-- No salary may exceed 150000.
-- Use one UPDATE statement with CASE.
-- Write your answer below:
BEGIN;

UPDATE employees e
SET
    salary = LEAST(
        CASE
            WHEN d.name = 'Engineering' THEN e.salary * 1.12
            WHEN d.name = 'Finance' THEN e.salary * 1.08
            WHEN d.name = 'HR' THEN e.salary * 1.06
            WHEN d.name = 'Sales' THEN e.salary * 1.10
            ELSE e.salary * 1.03
        END,
        150000
    )
FROM departments d
WHERE
    e.department_id = d.department_id

COMMIT;

-- 32. Update according to experience
-- Add an employee_level column. Allow junior, mid, senior, lead, and manager. Set employee_level = 'senior' for active employees who joined more than 5 years ago and earn at least 70,000.

BEGIN;

CREATE TYPE seniority_enum_employee AS ENUM('junior','mid','senior','lead','manager');

ALTER TABLE employees
ADD COLUMN employee_level seniority_enum_employee NOT NULL DEFAULT 'junior';

UPDATE employees 
SET employee_level = 'senior'
WHERE
    (joined_on < CURRENT_DATE - INTERVAL '5 years')
    AND
    (salary >= 70000)
    AND
    (status = 'active');

COMMIT;

-- 33. Assign department managers
-- For every department, assign the employee with the highest salary as the manager of all other employees in that department.
--
-- Requirements:
-- - The selected manager must not manage themselves.
-- - Ignore employees with NULL salaries.
-- - Handle salary ties deterministically.
-- - Use one update based on a CTE or window function.
-- Write your answer below:

WITH managers AS (
    SELECT DISTINCT ON (department_id) department_id, employee_id
    FROM employees
    WHERE salary IS NOT NULL AND department_id IS NOT NULL
    ORDER BY department_id, salary DESC, employee_id
)
UPDATE employees AS e
SET manager_id = CASE WHEN e.employee_id = m.employee_id THEN NULL ELSE m.employee_id END
FROM managers AS m WHERE e.department_id = m.department_id;
-- Lowest ID wins ties. NULL-salary employees cannot be selected as managers.
-- Departments without eligible candidates remain unchanged.

-- 34. Update customers from latest order
-- For customers whose city is NULL, set their city from the shipping_city of their latest order.
--
-- Requirements:
-- - Ignore orders with a NULL shipping city.
-- - If multiple orders have the same timestamp, make the result deterministic.
-- - Do not overwrite an existing customer city.
-- Write your answer below:

WITH latest AS (
    SELECT DISTINCT ON (customer_id) customer_id, shipping_city
    FROM orders WHERE shipping_city IS NOT NULL
    ORDER BY customer_id, ordered_at DESC NULLS LAST, order_id DESC
)
UPDATE customers AS c SET city = l.shipping_city
FROM latest AS l WHERE c.customer_id = l.customer_id AND c.city IS NULL;

-- 35. Recalculate order totals
-- Update every order’s total_amount using:
-- SUM(quantity × unit_price)
--
-- from order_items.
--
-- Requirements:
-- - Orders without items should become 0.
-- - Avoid updating rows whose total is already correct.
-- - Return only changed orders.
-- Write your answer below:

WITH totals AS (
    SELECT o.order_id, COALESCE(SUM(i.quantity * i.unit_price), 0) AS total
    FROM orders AS o LEFT JOIN order_items AS i USING (order_id)
    GROUP BY o.order_id
)
UPDATE orders AS o SET total_amount = t.total
FROM totals AS t WHERE o.order_id = t.order_id
AND o.total_amount IS DISTINCT FROM t.total
RETURNING o.order_id, o.total_amount;

-- 36. Normalize text data
-- Normalize employee emails by:
-- - Trimming whitespace
-- - Converting to lowercase
-- - Converting empty strings to NULL
-- Before applying the update, check whether normalization will create duplicate emails.
-- Write your answer below:

BEGIN;
LOCK TABLE employees IN SHARE ROW EXCLUSIVE MODE;
SELECT NULLIF(LOWER(BTRIM(email)), '') AS normalized_email,
       ARRAY_AGG(employee_id) AS employee_ids
FROM employees WHERE NULLIF(BTRIM(email), '') IS NOT NULL
GROUP BY NULLIF(LOWER(BTRIM(email)), '') HAVING COUNT(*) > 1;
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM employees WHERE NULLIF(BTRIM(email), '') IS NOT NULL
        GROUP BY LOWER(BTRIM(email)) HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Resolve duplicate emails before normalization';
    END IF;
END;
$$;
UPDATE employees SET email = NULLIF(LOWER(BTRIM(email)), '')
WHERE email IS DISTINCT FROM NULLIF(LOWER(BTRIM(email)), '');
COMMIT;

-- 37. Update JSONB data
-- For all Engineering employees, update metadata to include:
-- {
--   "department": "Engineering",
--   "review_required": true
-- }
--
-- Do not replace existing metadata such as skills.
--
-- Then remove only the review_required key.
-- Write your answer below:

UPDATE employees AS e
SET metadata = COALESCE(e.metadata, '{}'::JSONB)
    || '{"department":"Engineering","review_required":true}'::JSONB
FROM departments AS d
WHERE e.department_id = d.department_id AND d.name = 'Engineering';

UPDATE employees AS e SET metadata = e.metadata - 'review_required'
FROM departments AS d
WHERE e.department_id = d.department_id AND d.name = 'Engineering';

-- 38. Deduplicate customers
-- The following emails represent the same customer:
-- priya@example.com
-- PRIYA@example.com
--
-- Create a safe deduplication process:
-- 1. Choose one canonical customer.
-- 2. Move all orders to the canonical customer.
-- 3. Merge useful non-null customer fields.
-- 4. Delete the duplicate record.
-- 5. Add protection against future case-insensitive duplicates.
-- Perform the operation inside a transaction.
-- Write your answer below:

BEGIN;
LOCK TABLE customers, orders IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE customer_merge ON COMMIT DROP AS
SELECT customer_id, MIN(customer_id) OVER (
    PARTITION BY LOWER(BTRIM(email))) AS canonical_id
FROM customers WHERE NULLIF(BTRIM(email), '') IS NOT NULL;

WITH merged AS (
    SELECT m.canonical_id,
        (ARRAY_AGG(c.full_name ORDER BY c.customer_id)
            FILTER (WHERE NULLIF(BTRIM(c.full_name), '') IS NOT NULL))[1] AS full_name,
        (ARRAY_AGG(c.phone ORDER BY c.customer_id)
            FILTER (WHERE NULLIF(BTRIM(c.phone), '') IS NOT NULL))[1] AS phone,
        (ARRAY_AGG(c.city ORDER BY c.customer_id)
            FILTER (WHERE NULLIF(BTRIM(c.city), '') IS NOT NULL))[1] AS city
    FROM customer_merge AS m JOIN customers AS c USING (customer_id)
    GROUP BY m.canonical_id
)
UPDATE customers AS c SET full_name = m.full_name, phone = m.phone, city = m.city
FROM merged AS m WHERE c.customer_id = m.canonical_id;
UPDATE orders AS o SET customer_id = m.canonical_id
FROM customer_merge AS m WHERE o.customer_id = m.customer_id;
DELETE FROM customers AS c USING customer_merge AS m
WHERE c.customer_id = m.customer_id AND m.customer_id <> m.canonical_id;
UPDATE customers SET email = NULLIF(LOWER(BTRIM(email)), '');
CREATE UNIQUE INDEX customers_email_normalized_uidx ON customers (LOWER(BTRIM(email)));
COMMIT;
-- Repoint any additional customer foreign keys before deleting duplicates.

-- 39. Upsert department budgets
-- Create a temporary table:
-- CREATE TEMP TABLE department_budget_updates (
--     department_name TEXT,
--     new_budget NUMERIC(12, 2)
-- );
--
-- Insert data containing:
-- - One existing department
-- - One new department
-- - One duplicate department name with different casing
-- Use INSERT ... ON CONFLICT DO UPDATE to:
-- - Insert missing departments.
-- - Update existing department budgets.
-- - Treat department names case-insensitively.
-- Write your answer below:

CREATE TEMP TABLE department_budget_updates (
    update_id BIGINT GENERATED ALWAYS AS IDENTITY,
    department_name TEXT, new_budget NUMERIC(12, 2)
);
INSERT INTO department_budget_updates (department_name, new_budget)
VALUES ('Engineering', 1100000), ('Support', 200000), ('engineering', 1200000);
-- Last input wins. Deduplicate input to avoid updating one target twice.
-- Uses the expression unique index created in question 15.
INSERT INTO departments (name, budget)
SELECT department_name, new_budget FROM (
    SELECT DISTINCT ON (LOWER(BTRIM(department_name)))
        BTRIM(department_name) AS department_name, new_budget
    FROM department_budget_updates
    ORDER BY LOWER(BTRIM(department_name)), update_id DESC
) AS incoming
ON CONFLICT (LOWER(BTRIM(name))) DO UPDATE SET budget = EXCLUDED.budget;

-- 40. Soft deletion
-- Add these columns to employees:
-- deleted_at TIMESTAMPTZ
-- deleted_by TEXT
--
-- Create an update that “deletes” terminated employees by setting these fields instead of physically deleting them.
--
-- Then create:
-- - A query returning only active, non-deleted employees.
-- - A partial index optimized for that query.
-- - A restore query.
-- Level 5 — Production and Brainstorming Problems
-- Write your answer below:

ALTER TABLE employees ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE employees ADD COLUMN deleted_by TEXT;
UPDATE employees SET deleted_at = CURRENT_TIMESTAMP, deleted_by = CURRENT_USER
WHERE status = 'terminated' AND deleted_at IS NULL;
SELECT * FROM employees WHERE status = 'active' AND deleted_at IS NULL;
CREATE INDEX employees_active_not_deleted_idx ON employees (employee_id)
WHERE status = 'active' AND deleted_at IS NULL;
-- Example restoration; restoring does not automatically reactivate an employee.
UPDATE employees SET deleted_at = NULL, deleted_by = NULL WHERE employee_id = 4;

-- 41. Add constraints to dirty production data
-- Assume orders contains 100 million rows and some totals are negative.
--
-- You need to enforce:
-- total_amount >= 0
--
-- Design a migration using:
-- ADD CONSTRAINT ... NOT VALID
-- VALIDATE CONSTRAINT
--
-- Your plan must cover:
-- - Existing invalid rows
-- - New writes during cleanup
-- - Locking behavior
-- - Rollback
-- - Monitoring progress
-- Write your answer below:

-- Independent production example; question 17 already adds a similar check.
BEGIN;
SET LOCAL lock_timeout = '2s';
ALTER TABLE orders ADD CONSTRAINT orders_total_nonnegative_v2
CHECK (total_amount >= 0) NOT VALID;
COMMIT;
-- Brief ACCESS EXCLUSIVE lock for ADD; new writes are immediately checked.
-- Repeat this batch until no rows change. Zero is an explicit practice repair
-- policy; retain original values in a repair log before changing real money.
BEGIN;
WITH batch AS (
    SELECT order_id FROM orders WHERE total_amount < 0
    ORDER BY order_id LIMIT 10000 FOR UPDATE SKIP LOCKED
)
UPDATE orders AS o SET total_amount = 0
FROM batch AS b WHERE o.order_id = b.order_id;
COMMIT;
-- Execute after all cleanup batches finish:
ALTER TABLE orders VALIDATE CONSTRAINT orders_total_nonnegative_v2;
-- Validation scans the table under SHARE UPDATE EXCLUSIVE, allowing normal DML.
-- Monitor batch counts/durations, pg_stat_activity, pg_locks and replica lag.
-- pg_constraint.convalidated reports completion, not percentage progress.
-- Rollback: DROP this constraint; reverse repairs from the saved repair log.

-- 42. Zero-downtime NOT NULL migration
-- You need to make customers.email non-null on a heavily used table.
--
-- You cannot run one long blocking migration.
--
-- Design a staged rollout involving:
-- 1. Application validation
-- 2. Data backfill
-- 3. Temporary check constraint
-- 4. Constraint validation
-- 5. Final NOT NULL
-- 6. Application cleanup
-- Explain what happens when old application versions are still running.
-- Write your answer below:

-- Deploy non-NULL email validation to all writers first, including old versions.
-- Install the guard before backfill so concurrent writers cannot add more NULLs.
BEGIN;
SET LOCAL lock_timeout = '2s';
ALTER TABLE customers ADD CONSTRAINT customers_email_present
CHECK (email IS NOT NULL) NOT VALID;
COMMIT;
-- Backfill in short primary-key batches using verified email data. Resolve
-- duplicates under question 38's index. Never invent a customer's real email.
-- Old app versions sending NULL now fail; upgrade/drain them before enforcement.
SELECT customer_id FROM customers WHERE email IS NULL;
-- Continue only when backfill is complete and this returns zero rows:
ALTER TABLE customers VALIDATE CONSTRAINT customers_email_present;
BEGIN;
SET LOCAL lock_timeout = '2s';
ALTER TABLE customers ALTER COLUMN email SET NOT NULL;
ALTER TABLE customers DROP CONSTRAINT customers_email_present;
COMMIT;
-- A validated CHECK avoids another scan on supported PostgreSQL versions.
-- SET NOT NULL still needs a brief ACCESS EXCLUSIVE lock; retry lock timeouts.
-- Remove temporary application compatibility code after all versions migrate.

-- 43. Convert a large INTEGER primary key to BIGINT
-- employees.employee_id is approaching the INTEGER limit.
--
-- It is referenced by:
-- - employees.manager_id
-- - Audit tables
-- - Payroll tables
-- - External services
-- Design a safe migration to BIGINT.
--
-- Cover:
-- - Foreign keys
-- - Indexes
-- - Locks
-- - Application compatibility
-- - Dual-read or dual-write possibilities
-- - Rollback difficulty
-- Do not assume a simple ALTER COLUMN TYPE BIGINT is always safe at production scale.
-- Write your answer below:

-- Staged production plan:
-- 1. Inventory manager/audit/payroll FKs, indexes, views, identity sequences and
--    external consumers. Deploy 64-bit-compatible clients first (decimal strings
--    for JavaScript IDs beyond its safe integer range). Check integer headroom.
-- 2. Add BIGINT shadow ID/reference columns. Install synchronization triggers
--    before backfilling in bounded, committed primary-key batches.
-- 3. Build the parent UNIQUE index CONCURRENTLY and child indexes CONCURRENTLY
--    outside transactions. Add shadow FKs NOT VALID, then validate them.
-- 4. Dual-read/dual-write during transition, checking old/new consistency. Use
--    one authoritative allocator; widen the identity sequence to BIGINT too.
-- 5. Rehearse a brief cutover: fixed lock order, lock_timeout, consistency check,
--    switch PK/FKs and application reads, rename columns, rebind dependencies
--    and sequence ownership/default. Renaming alone does not retarget dependencies.
-- 6. Keep old columns during a rollback window. Once generated IDs exceed INTEGER,
--    rollback requires global ID remapping; prefer forward recovery.
-- Measure locks, disk overhead, WAL and replica lag on a production-sized clone.

-- 44. Prevent lost salary updates
-- Two administrators read an employee salary of 80000.
-- - Administrator A adds 5000.
-- - Administrator B adds 10000.
-- - Both save their calculated values.
-- One update can overwrite the other.
--
-- Implement optimistic locking using a version column.
--
-- The update should succeed only when the version matches the value originally read.
-- Write your answer below:

ALTER TABLE employees ADD COLUMN version BIGINT NOT NULL DEFAULT 0;
SELECT employee_id, salary, version FROM employees WHERE employee_id = 1;
-- Example: the administrator originally read version 0.
UPDATE employees SET salary = salary + 5000, version = version + 1,
    updated_at = CURRENT_TIMESTAMP
WHERE employee_id = 1 AND version = 0
RETURNING employee_id, salary, version;
-- Bind employee ID, raise and original version as application parameters.
-- Zero returned rows: reload and resolve the conflict (or employee was deleted).
-- Every salary-writing path must increment version for this guarantee to hold.

-- 45. Create a salary audit system
-- Create an employee_salary_audit table that records:
-- - Employee ID
-- - Old salary
-- - New salary
-- - Changed by
-- - Reason
-- - Timestamp
-- Implement salary changes so that the employee update and audit insert succeed or fail together.
--
-- Then brainstorm whether this should be implemented using:
-- - Application code
-- - Stored procedure
-- - Database trigger
-- Rank the options for a normal production application.
-- Write your answer below:

CREATE TABLE employee_salary_audit (
    audit_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    employee_id INTEGER NOT NULL,
    old_salary NUMERIC(12, 2), new_salary NUMERIC(12, 2),
    changed_by TEXT NOT NULL, reason TEXT NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE FUNCTION audit_salary_change() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.salary IS DISTINCT FROM NEW.salary THEN
        IF NULLIF(BTRIM(current_setting('app.salary_reason', true)), '') IS NULL THEN
            RAISE EXCEPTION 'Salary change reason required';
        END IF;
        INSERT INTO employee_salary_audit
            (employee_id, old_salary, new_salary, changed_by, reason)
        VALUES (NEW.employee_id, OLD.salary, NEW.salary, SESSION_USER,
                current_setting('app.salary_reason'));
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER salary_audit AFTER UPDATE OF salary ON employees
FOR EACH ROW EXECUTE FUNCTION audit_salary_change();
BEGIN;
SET LOCAL app.salary_reason = 'Annual review';
UPDATE employees SET salary = salary + 5000, version = version + 1
WHERE employee_id = 1;
COMMIT;
-- Trigger and update share the transaction: both commit or both fail.
-- Ranking for mandatory audit across writers: 1 trigger (covers all normal DML),
-- 2 stored procedure (revoke direct writes), 3 application transaction (easy to
-- bypass accidentally). Application transactions may suffice for one controlled writer.
-- Preserve audit history after employee deletion; restrict audit table permissions.
-- SESSION_USER is the DB login; pooled apps need a trusted end-user identity too.

-- 46. Archive old orders
-- Move completed and cancelled orders older than two years into archive tables.
--
-- Requirements:
-- - Preserve order items.
-- - Do not create orphan records.
-- - Avoid loading millions of rows into one transaction.
-- - Make the process resumable.
-- - Prevent duplicate archive records if the job retries.
-- - Verify data before deleting it from the source tables.
-- Design the SQL and batch strategy.
-- Write your answer below:

CREATE TABLE archived_orders (LIKE orders INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
ALTER TABLE archived_orders ADD PRIMARY KEY (order_id);
CREATE TABLE archived_order_items (LIKE order_items INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
ALTER TABLE archived_order_items ADD PRIMARY KEY (order_item_id);
ALTER TABLE archived_order_items ADD FOREIGN KEY (order_id) REFERENCES archived_orders (order_id);
-- Repeat the following bounded transaction until no candidates remain.
BEGIN;
-- Practice implementation blocks writes for a short batch. Before using only
-- row locks in production, require ALL item/order writers to lock the parent.
LOCK TABLE orders, order_items IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE archive_batch ON COMMIT DROP AS
SELECT order_id FROM orders
WHERE order_status IN ('completed', 'cancelled')
AND ordered_at < CURRENT_TIMESTAMP - INTERVAL '2 years'
ORDER BY order_id LIMIT 1000;
INSERT INTO archived_orders SELECT o.* FROM orders AS o
JOIN archive_batch AS b USING (order_id) ON CONFLICT (order_id) DO NOTHING;
INSERT INTO archived_order_items SELECT i.* FROM order_items AS i
JOIN archive_batch AS b USING (order_id) ON CONFLICT (order_item_id) DO NOTHING;
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM orders AS o JOIN archive_batch AS b USING (order_id)
        LEFT JOIN archived_orders AS a USING (order_id)
        WHERE a.order_id IS NULL OR to_jsonb(o) IS DISTINCT FROM to_jsonb(a)
    ) OR EXISTS (
        SELECT 1 FROM order_items AS i JOIN archive_batch AS b USING (order_id)
        LEFT JOIN archived_order_items AS a USING (order_item_id)
        WHERE a.order_item_id IS NULL OR to_jsonb(i) IS DISTINCT FROM to_jsonb(a)
    ) OR EXISTS (
        SELECT 1 FROM archived_order_items AS a JOIN archive_batch AS b USING (order_id)
        LEFT JOIN order_items AS i USING (order_item_id)
        WHERE i.order_item_id IS NULL OR to_jsonb(i) IS DISTINCT FROM to_jsonb(a)
    ) THEN RAISE EXCEPTION 'Archive mismatch; nothing deleted';
    END IF;
END;
$$;
DELETE FROM order_items USING archive_batch AS b WHERE order_items.order_id = b.order_id;
DELETE FROM orders USING archive_batch AS b WHERE orders.order_id = b.order_id;
COMMIT;
-- Commit makes the job resumable; PKs prevent retry duplicates. Mismatches abort.
-- Inventory other references first. Index orders(ordered_at, order_id) and
-- order_items(order_id); monitor lock waits, WAL and lag; tune batch size.

-- 47. Write an idempotent migration
-- Create a migration that can safely run multiple times and performs:
-- - Add employees.last_login_at if missing.
-- - Add an index if missing.
-- - Add a named check constraint if missing.
-- - Backfill only rows that still need backfilling.
-- PostgreSQL supports IF NOT EXISTS for some operations but not equally for every operation.
--
-- Use a DO block when necessary.
-- Write your answer below:

BEGIN;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS employees_last_login_at_idx ON employees (last_login_at);
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conrelid = 'employees'::REGCLASS
        AND conname = 'employees_login_after_creation'
    ) THEN
        ALTER TABLE employees ADD CONSTRAINT employees_login_after_creation
        CHECK (last_login_at IS NULL OR last_login_at >= created_at) NOT VALID;
    END IF;
END;
$$;
-- Practice assumption: account creation counts as initial login.
-- Real systems should use actual authentication history instead.
UPDATE employees SET last_login_at = created_at
WHERE last_login_at IS NULL AND created_at IS NOT NULL;
ALTER TABLE employees VALIDATE CONSTRAINT employees_login_after_creation;
COMMIT;
-- Serialize migration runners. IF NOT EXISTS compares names, not definitions;
-- verify existing definitions and fail on schema drift. Large tables need batch
-- backfill and CREATE INDEX CONCURRENTLY outside a transaction.

-- 48. Handle concurrent customer creation
-- Two requests simultaneously try to create:
-- newuser@example.com
--
-- A design using:
-- 1. SELECT to check whether the email exists
-- 2. INSERT if it does not
-- contains a race condition.
--
-- Replace it with a database-enforced, concurrency-safe solution.
--
-- Return the existing or newly created customer in both cases.
-- Write your answer below:

-- Uses question 38's normalized unique index.
INSERT INTO customers (full_name, email, city)
VALUES ('New User', 'newuser@example.com', 'Pune')
ON CONFLICT (LOWER(BTRIM(email))) DO UPDATE SET email = customers.email
RETURNING customers.*;
-- Unique-index arbitration handles concurrent requests. The no-op UPDATE returns
-- the existing row without replacing its profile, but writes a row version and
-- can fire UPDATE triggers. Retry serialization/deadlock errors as appropriate.

-- 49. Design a retry-safe order-status update
-- A worker receives a message to mark an order as shipped.
--
-- The same message may be delivered multiple times.
--
-- Design an idempotent update that:
-- - Changes only processing orders to shipped.
-- - Sets shipped_at exactly once.
-- - Does not overwrite an existing shipping timestamp.
-- - Detects when another worker already completed the update.
-- - Records the processed message ID to prevent duplicate side effects.
-- Explain the transaction boundary.
-- Write your answer below:

CREATE TABLE processed_order_messages (
    message_id TEXT PRIMARY KEY, order_id BIGINT NOT NULL,
    outcome TEXT NOT NULL, processed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
BEGIN;
DO $$
DECLARE
    v_message TEXT := 'ship-order-1-message-001';
    v_id BIGINT := 1;
    v_order orders%ROWTYPE;
    v_previous_id BIGINT;
BEGIN
    INSERT INTO processed_order_messages (message_id, order_id, outcome)
    VALUES (v_message, v_id, 'processing') ON CONFLICT (message_id) DO NOTHING;
    IF NOT FOUND THEN
        SELECT order_id INTO v_previous_id FROM processed_order_messages
        WHERE message_id = v_message;
        IF v_previous_id <> v_id THEN
            RAISE EXCEPTION 'Message ID reused for another order';
        END IF;
        RAISE NOTICE 'Message already processed';
        RETURN;
    END IF;
    SELECT * INTO v_order FROM orders WHERE order_id = v_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Missing order'; END IF;
    IF v_order.order_status = 'processing' THEN
        UPDATE orders SET order_status = 'shipped',
            shipped_at = COALESCE(shipped_at, CURRENT_TIMESTAMP)
        WHERE order_id = v_id;
        UPDATE processed_order_messages SET outcome = 'shipped'
        WHERE message_id = v_message;
        -- Insert a uniquely keyed transactional outbox event here for external
        -- effects; publish after commit and deduplicate at the consumer.
    ELSIF v_order.order_status = 'shipped' THEN
        UPDATE processed_order_messages SET outcome = 'already_shipped'
        WHERE message_id = v_message;
    ELSE
        RAISE EXCEPTION 'Order is not processing: %', v_order.order_status;
    END IF;
END;
$$;
COMMIT;
-- Supply IDs as parameters in the real handler. Receipt, lock, update and outbox
-- share one transaction. A failure rolls back the receipt so retry can succeed.
-- Acknowledge the broker only after commit; other workers serialize on the locks.

-- 50. Complete legacy migration challenge
-- Migrate legacy_employees into the production employee tables.
--
-- Your design must include:
-- legacy_employees
--         |
--         v
-- validation/staging
--         |
--         +------> rejected_employees
--         |
--         v
-- clean_employees
--         |
--         v
-- departments + employees
--
-- Requirements:
-- - Convert IDs safely.
-- - Clean salary values.
-- - Parse multiple date formats.
-- - Convert text booleans.
-- - Map department codes to department IDs.
-- - Reject unknown department codes or create departments according to an explicit rule.
-- - Preserve the original raw row for debugging.
-- - Record the rejection reason.
-- - Avoid importing the same employee twice.
-- - Make the process retry-safe.
-- - Produce counts for:
--   - Total source rows
--   - Valid rows
--   - Rejected rows
--   - Inserted rows
--   - Updated rows
-- - Run post-migration validation.
-- - Define a rollback strategy.
-- - Explain how you would test the migration before production.
-- This final problem should be solved as a small production migration project, not as one giant SQL statement.
-- Write your answer below:

-- Small production migration project: separate validation, import and recovery.
-- 1. Create migration_runs(run_id, status, timestamps, counts). Snapshot source
--    rows into immutable landing storage with run_id, generated source_row_id
--    and raw_row JSONB. Preserve duplicate/bad IDs; establish a stable source key.
-- 2. Build typed staging with rejection_reasons TEXT[]. For each value:
--    IDs: CASE WHEN pg_input_is_valid(employee_id_text, 'integer') THEN
--    employee_id_text::INTEGER END (PostgreSQL 16+). Reject invalid/missing IDs
--    and ambiguous duplicate source IDs rather than silently choosing a row.
--    Salary: trim, remove approved currency symbols and grouping commas only
--    after validating their format. Treat blank/N/A as NULL by explicit policy.
--    Check numeric syntax, NUMERIC(12,2) range and nonnegativity before casting;
--    reject unexpected characters/grouping instead of stripping arbitrary text.
--    Dates: accept YYYY-MM-DD and DD/MM/YYYY; rearrange the latter to ISO, then
--    validate with pg_input_is_valid(iso_text, 'date') before casting in CASE.
--    Reject impossible dates; do not rely on blind TO_DATE normalization.
--    Boolean: CASE LOWER(BTRIM(active_text)), accepting yes/y/1/true and
--    no/n/0/false; reject other values. Validate required names as well.
--    Map ENG/FIN/HR/SALES through a controlled department-code mapping table.
--    Explicit policy: reject UNKNOWN/unmapped codes; create no departments.
-- 3. Persist rejected_employees(run_id, source_row_id, raw_row, reasons) and
--    clean_employees with typed values plus source lineage. Use unique
--    (run_id, source_row_id) keys. Rebuild/upsert staging on retry; every source
--    row must have exactly one outcome. Do not trust question 26's conversions.
-- 4. Add source_system/source_employee_id to employees with a UNIQUE pair, or
--    use a mapping table with equivalent uniqueness and serialized allocation.
--    Preserve target generated IDs: legacy IDs may collide with existing IDs.
--    Import committed batches, upserting by source identity. Map departments
--    and active/inactive status, update only migration-owned changed fields,
--    increment version and provide the salary audit reason from questions 44/45.
--    Store inserted/updated/unchanged per-row receipts and checkpoint atomically
--    with each batch. Do not use xmax as a portable way to classify upsert results.
-- 5. Report total, valid, rejected, inserted, updated and unchanged counts:
--    total = valid + rejected; valid = inserted + updated + unchanged.
--    Reconcile each staged source key to exactly one target; check conversions,
--    salary aggregates, FK integrity, duplicates and representative samples.
-- 6. Store before-images, inserted target IDs and post-import versions per run.
--    Roll back updated rows only if versions still match; review concurrent
--    edits. Delete inserted rows only after checking dependencies. Preserve raw
--    rows, rejection records and audit history; mark the run rolled back.
-- 7. Test on a production-like disposable clone: overflow/malformed IDs,
--    currencies/blank/negative/overflow salaries, leap/impossible dates,
--    unknown booleans/codes, duplicate source IDs and existing target conflicts.
--    Inject crashes mid-batch and between commits; replay and verify no duplicate
--    imports. Test concurrency, audit failures, lock timeouts, counts, restore
--    from backup and rollback before deploying the migration.

