import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';

dotenv.config();

const defaultDbPath = process.env.RENDER
  ? '/var/data/farmacia.db'
  : path.join(__dirname, '../../database/farmacia.db');
const DB_PATH = process.env.DB_PATH || defaultDbPath;
const DB_DIR = path.dirname(DB_PATH);

// Ensure directory exists before opening sqlite file
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

export const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
    console.log(`SQLite path: ${DB_PATH}`);
  }
});

function runDb(sql: string, params: any[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function allDb<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve((rows || []) as T[]);
    });
  });
}

async function ensureColumn(table: string, column: string, definition: string): Promise<void> {
  const columns = await allDb<{ name: string }>(`PRAGMA table_info(${table})`);
  if (columns.some((col) => col.name === column)) return;
  await runDb(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  console.log(`Column ${column} added to ${table}`);
}

async function ensureColumns(table: string, columns: Array<[string, string]>): Promise<void> {
  for (const [column, definition] of columns) {
    await ensureColumn(table, column, definition);
  }
}

async function runCriticalMigrations(): Promise<void> {
  await runDb(`
    CREATE TABLE IF NOT EXISTS app_license (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      license_key TEXT NOT NULL,
      customer TEXT,
      expires_at TEXT,
      machine_id TEXT,
      activated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await ensureColumns('users', [
    ['worker_id', 'INTEGER'],
    ['profile_id', 'INTEGER']
  ]);

  await ensureColumns('company_settings', [
    ['trade_name', 'TEXT'],
    ['ruc', 'TEXT'],
    ['address', 'TEXT'],
    ['phone', 'TEXT'],
    ['email', 'TEXT'],
    ['website', 'TEXT'],
    ['logo_data_url', 'TEXT'],
    ['receipt_title', "TEXT DEFAULT 'COMPROBANTE DE VENTA'"],
    ['receipt_footer', "TEXT DEFAULT 'Gracias por su compra'"],
    ['receipt_width_mm', 'INTEGER DEFAULT 80'],
    ['show_logo', 'INTEGER DEFAULT 1'],
    ['show_qr', 'INTEGER DEFAULT 1'],
    ['non_admin_history_days', 'INTEGER DEFAULT 5'],
    ['cash_reopen_password', "TEXT DEFAULT 'admin123'"],
    ['return_password', "TEXT DEFAULT 'd3v0luc10n$2026$*'"],
    ['purchase_cancel_password', "TEXT DEFAULT 'admin123'"]
  ]);

  await ensureColumns('products', [
    ['expiration_date', 'DATE'],
    ['has_sales_bonus', 'INTEGER DEFAULT 0'],
    ['sales_bonus_per_unit', 'REAL DEFAULT 0'],
    ['sanitary_registration', 'TEXT'],
    ['lot_number', 'TEXT'],
    ['presentation', 'TEXT'],
    ['laboratory', 'TEXT']
  ]);

  await runDb(`
    CREATE TABLE IF NOT EXISTS presentation_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await runDb(`
    CREATE TABLE IF NOT EXISTS product_presentations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      presentation_type_id INTEGER,
      name TEXT NOT NULL,
      barcode TEXT,
      conversion_factor INTEGER NOT NULL DEFAULT 1,
      unit_price REAL NOT NULL DEFAULT 0,
      cost_price REAL,
      is_default INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      FOREIGN KEY (presentation_type_id) REFERENCES presentation_types(id)
    )
  `);

  await ensureColumns('product_presentations', [
    ['presentation_type_id', 'INTEGER'],
    ['name', "TEXT DEFAULT 'Unidad'"],
    ['barcode', 'TEXT'],
    ['conversion_factor', 'INTEGER DEFAULT 1'],
    ['unit_price', 'REAL DEFAULT 0'],
    ['cost_price', 'REAL'],
    ['is_default', 'INTEGER DEFAULT 0'],
    ['is_active', 'INTEGER DEFAULT 1'],
    ['created_at', 'DATETIME'],
    ['updated_at', 'DATETIME']
  ]);

  await runDb(`
    INSERT OR IGNORE INTO presentation_types (name, description)
    VALUES
      ('Unidad', 'Venta por unidad base'),
      ('Tableta', 'Venta por tableta'),
      ('Blister', 'Venta por blister'),
      ('Frasco', 'Venta por frasco'),
      ('Caja', 'Venta por caja'),
      ('Ampolla', 'Venta por ampolla'),
      ('Sobre', 'Venta por sobre')
  `);

  await ensureColumns('sale_items', [
    ['sales_bonus_per_unit', 'REAL DEFAULT 0'],
    ['sales_bonus_total', 'REAL DEFAULT 0'],
    ['cost_price', 'REAL'],
    ['presentation_id', 'INTEGER'],
    ['presentation_name', 'TEXT'],
    ['conversion_factor', 'INTEGER DEFAULT 1'],
    ['stock_quantity', 'INTEGER']
  ]);

  await ensureColumns('purchase_items', [
    ['presentation_id', 'INTEGER'],
    ['presentation_name', 'TEXT'],
    ['conversion_factor', 'INTEGER DEFAULT 1'],
    ['stock_quantity', 'INTEGER']
  ]);

  await ensureColumns('product_price_history', [
    ['presentation_id', 'INTEGER'],
    ['presentation_name', 'TEXT'],
    ['change_source', 'TEXT']
  ]);

  await runDb(`
    INSERT INTO product_presentations (product_id, presentation_type_id, name, barcode, conversion_factor, unit_price, cost_price, is_default, is_active)
    SELECT
      p.id,
      (SELECT id FROM presentation_types WHERE name IN ('Unidad') LIMIT 1),
      COALESCE(NULLIF(p.presentation, ''), 'Unidad'),
      p.barcode,
      1,
      COALESCE(p.unit_price, 0),
      p.cost_price,
      1,
      1
    FROM products p
    WHERE NOT EXISTS (
      SELECT 1 FROM product_presentations pp WHERE pp.product_id = p.id
    )
  `);

  await runDb(`
    UPDATE product_presentations
    SET
      unit_price = COALESCE((SELECT p.unit_price FROM products p WHERE p.id = product_presentations.product_id), unit_price),
      cost_price = (SELECT p.cost_price FROM products p WHERE p.id = product_presentations.product_id),
      name = COALESCE(NULLIF((SELECT p.presentation FROM products p WHERE p.id = product_presentations.product_id), ''), name),
      updated_at = CURRENT_TIMESTAMP
    WHERE is_default = 1
      AND EXISTS (
        SELECT 1
        FROM products p
        WHERE p.id = product_presentations.product_id
          AND (
            COALESCE(p.unit_price, 0) != COALESCE(product_presentations.unit_price, 0)
            OR COALESCE(p.cost_price, -1) != COALESCE(product_presentations.cost_price, -1)
          )
      )
  `);

  await runDb(`
    INSERT INTO product_price_history
      (product_id, presentation_id, presentation_name, old_unit_price, new_unit_price, old_cost_price, new_cost_price, changed_by, notes, change_source, valid_from)
    SELECT
      pp.product_id,
      pp.id,
      pp.name,
      NULL,
      COALESCE(pp.unit_price, 0),
      NULL,
      pp.cost_price,
      NULL,
      'Registro inicial de presentacion existente',
      'presentation',
      COALESCE(pp.created_at, CURRENT_TIMESTAMP)
    FROM product_presentations pp
    WHERE NOT EXISTS (
      SELECT 1
      FROM product_price_history ph
      WHERE ph.presentation_id = pp.id
    )
  `);

  await runDb(`
    UPDATE sale_items
    SET
      conversion_factor = COALESCE(conversion_factor, 1),
      stock_quantity = COALESCE(stock_quantity, quantity),
      presentation_name = COALESCE(presentation_name, 'Unidad')
    WHERE stock_quantity IS NULL OR presentation_name IS NULL OR conversion_factor IS NULL
  `);

  await runDb(`
    UPDATE purchase_items
    SET
      conversion_factor = COALESCE(conversion_factor, 1),
      stock_quantity = COALESCE(stock_quantity, quantity),
      presentation_name = COALESCE(presentation_name, 'Unidad')
    WHERE stock_quantity IS NULL OR presentation_name IS NULL OR conversion_factor IS NULL
  `);

  await ensureColumns('cash_registers', [
    ['previous_closed_at', 'DATETIME'],
    ['previous_closing_balance', 'REAL'],
    ['reopened_at', 'DATETIME'],
    ['reopened_by_user_id', 'INTEGER'],
    ['reopen_notes', 'TEXT'],
    ['cash_count_total', 'REAL DEFAULT 0'],
    ['cash_count_difference', 'REAL DEFAULT 0']
  ]);

  await ensureColumns('returns', [
    ['cash_register_id', 'INTEGER'],
    ['refund_payment_method', "TEXT DEFAULT 'cash'"]
  ]);

  await runDb(`
    UPDATE returns
    SET refund_payment_method = COALESCE(
      (
        SELECT cm.payment_method
        FROM cash_movements cm
        WHERE cm.reference_type = 'return'
          AND cm.reference_id = returns.id
          AND cm.payment_method IS NOT NULL
        ORDER BY cm.id DESC
        LIMIT 1
      ),
      (
        SELECT s.payment_method
        FROM sales s
        WHERE s.id = returns.sale_id
      ),
      'cash'
    )
    WHERE refund_payment_method IS NULL OR refund_payment_method = '' OR refund_payment_method = 'cash'
  `);

  await runDb(`
    CREATE TABLE IF NOT EXISTS sale_payment_details (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      payment_method TEXT NOT NULL,
      amount REAL NOT NULL,
      payment_reference TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (sale_id) REFERENCES sales(id),
      FOREIGN KEY (payment_method) REFERENCES payment_methods(value)
    )
  `);

  await runDb(`
    CREATE TABLE IF NOT EXISTS return_refund_details (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      return_id INTEGER NOT NULL,
      payment_method TEXT NOT NULL,
      amount REAL NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (return_id) REFERENCES returns(id),
      FOREIGN KEY (payment_method) REFERENCES payment_methods(value)
    )
  `);

  await runDb(`
    INSERT INTO return_refund_details (return_id, payment_method, amount, created_at)
    SELECT r.id,
           COALESCE(cm.payment_method, r.refund_payment_method, 'cash'),
           ABS(COALESCE(cm.amount, r.total_amount)),
           r.created_at
    FROM returns r
    LEFT JOIN cash_movements cm ON cm.reference_type = 'return' AND cm.reference_id = r.id
    WHERE NOT EXISTS (
      SELECT 1
      FROM return_refund_details rrd
      WHERE rrd.return_id = r.id
    )
  `);

  await runDb(`
    INSERT INTO sale_payment_details (sale_id, payment_method, amount, payment_reference, created_at)
    SELECT s.id, s.payment_method, s.final_amount, s.payment_reference, s.created_at
    FROM sales s
    WHERE NOT EXISTS (
      SELECT 1
      FROM sale_payment_details spd
      WHERE spd.sale_id = s.id
    )
  `);

  await runDb(`
    CREATE TABLE IF NOT EXISTS cash_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      account_type TEXT NOT NULL DEFAULT 'both',
      description TEXT,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await ensureColumns('cash_accounts', [
    ['account_type', "TEXT DEFAULT 'both'"],
    ['description', 'TEXT'],
    ['is_active', 'INTEGER DEFAULT 1'],
    ['created_at', 'DATETIME'],
    ['updated_at', 'DATETIME']
  ]);

  await runDb(`
    INSERT OR IGNORE INTO cash_accounts (id, name, account_type, description, is_active)
    VALUES
      (1, 'Otros', 'both', 'Cuenta general para ingresos o salidas varias', 1),
      (2, 'Almuerzo', 'expense', 'Gastos de alimentacion del turno', 1),
      (3, 'Movilidad', 'expense', 'Gastos de movilidad o transporte', 1),
      (4, 'Ingreso extra', 'income', 'Ingreso manual adicional a caja', 1),
      (5, 'Compra menor', 'expense', 'Salida menor no registrada como compra a proveedor', 1)
  `);

  await runDb(`
    CREATE TABLE IF NOT EXISTS cash_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cash_register_id INTEGER NOT NULL,
      movement_type TEXT NOT NULL,
      amount REAL NOT NULL,
      payment_method TEXT DEFAULT 'cash',
      cash_account_id INTEGER,
      reference_type TEXT,
      reference_id INTEGER,
      description TEXT,
      user_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (cash_register_id) REFERENCES cash_registers(id),
      FOREIGN KEY (cash_account_id) REFERENCES cash_accounts(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  await ensureColumns('cash_movements', [
    ['payment_method', "TEXT DEFAULT 'cash'"],
    ['cash_account_id', 'INTEGER']
  ]);

  await runDb(`
    CREATE TABLE IF NOT EXISTS cash_denominations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      value REAL NOT NULL UNIQUE,
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await ensureColumns('cash_denominations', [
    ['name', 'TEXT'],
    ['value', 'REAL'],
    ['sort_order', 'INTEGER DEFAULT 0'],
    ['is_active', 'INTEGER DEFAULT 1'],
    ['created_at', 'DATETIME'],
    ['updated_at', 'DATETIME']
  ]);

  await runDb(`
    INSERT OR IGNORE INTO cash_denominations (id, name, value, sort_order, is_active)
    VALUES
      (1, 'S/ 0.10', 0.10, 1, 1),
      (2, 'S/ 0.20', 0.20, 2, 1),
      (3, 'S/ 0.50', 0.50, 3, 1),
      (4, 'S/ 1.00', 1.00, 4, 1),
      (5, 'S/ 2.00', 2.00, 5, 1),
      (6, 'S/ 5.00', 5.00, 6, 1),
      (7, 'S/ 10.00', 10.00, 7, 1),
      (8, 'S/ 20.00', 20.00, 8, 1),
      (9, 'S/ 50.00', 50.00, 9, 1),
      (10, 'S/ 100.00', 100.00, 10, 1),
      (11, 'S/ 200.00', 200.00, 11, 1)
  `);

  await runDb(`
    CREATE TABLE IF NOT EXISTS cash_register_cash_counts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cash_register_id INTEGER NOT NULL,
      denomination_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0,
      amount REAL NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (cash_register_id) REFERENCES cash_registers(id),
      FOREIGN KEY (denomination_id) REFERENCES cash_denominations(id)
    )
  `);

  await ensureColumns('purchases', [
    ['cash_register_id', 'INTEGER'],
    ['afecta_caja', 'INTEGER DEFAULT 0'],
    ['cash_payment_method', 'TEXT'],
    ['status', "TEXT DEFAULT 'completed'"],
    ['cancelled_at', 'DATETIME'],
    ['cancelled_by_user_id', 'INTEGER'],
    ['cancellation_number', 'TEXT'],
    ['cancellation_reason', 'TEXT']
  ]);

  await runDb(`
    CREATE TABLE IF NOT EXISTS purchase_cancellations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cancellation_number TEXT UNIQUE NOT NULL,
      purchase_id INTEGER NOT NULL,
      purchase_number TEXT NOT NULL,
      cash_register_id INTEGER,
      user_id INTEGER NOT NULL,
      reason TEXT,
      total_amount REAL NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (purchase_id) REFERENCES purchases(id),
      FOREIGN KEY (cash_register_id) REFERENCES cash_registers(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
}

export function initializeDatabase(): Promise<void> {
  return new Promise(async (resolve, reject) => {
    // Ensure database directory exists
    const dbDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    // Generate admin password hash before database operations
    let adminPassword: string;
    try {
      adminPassword = await bcrypt.hash('admin123', 10);
    } catch (error) {
      console.error('Error hashing admin password:', error);
      adminPassword = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy'; // Fallback hash
    }

    db.serialize(() => {
      // Users table
      db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          email TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL,
          full_name TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'employee',
          worker_id INTEGER,
          profile_id INTEGER,
          is_active INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS workers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          document_type TEXT DEFAULT 'DNI',
          document_number TEXT UNIQUE,
          full_name TEXT NOT NULL,
          email TEXT,
          phone TEXT,
          address TEXT,
          position TEXT,
          hire_date DATE,
          is_active INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS user_profiles (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          description TEXT,
          role TEXT NOT NULL DEFAULT 'employee',
          is_active INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS profile_module_permissions (
          profile_id INTEGER NOT NULL,
          module_key TEXT NOT NULL,
          can_access INTEGER DEFAULT 1,
          PRIMARY KEY (profile_id, module_key),
          FOREIGN KEY (profile_id) REFERENCES user_profiles(id)
        )
      `);

      // Categories table
      db.run(`
        CREATE TABLE IF NOT EXISTS categories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          description TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Payment methods table
      db.run(`
        CREATE TABLE IF NOT EXISTS payment_methods (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          value TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL UNIQUE,
          description TEXT,
          is_cash INTEGER DEFAULT 0,
          requires_reference INTEGER DEFAULT 0,
          reference_required INTEGER DEFAULT 0,
          reference_label TEXT DEFAULT 'Código / Referencia',
          is_active INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Company and receipt settings (single-row configuration)
      db.run(`
        CREATE TABLE IF NOT EXISTS company_settings (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          business_name TEXT DEFAULT 'FARMACIA',
          trade_name TEXT DEFAULT 'Sistema de Farmacia',
          tax_id TEXT,
          address TEXT,
          phone TEXT,
          email TEXT,
          website TEXT,
          logo_data_url TEXT,
          receipt_title TEXT DEFAULT 'COMPROBANTE DE VENTA',
          receipt_footer TEXT DEFAULT 'Gracias por su compra',
          receipt_width_mm INTEGER DEFAULT 80,
          show_logo INTEGER DEFAULT 1,
          show_qr INTEGER DEFAULT 1,
          non_admin_history_days INTEGER DEFAULT 5,
          cash_reopen_password TEXT DEFAULT 'admin123',
          return_password TEXT DEFAULT 'd3v0luc10n$2026$*',
          purchase_cancel_password TEXT DEFAULT 'admin123',
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Products table
      db.run(`
        CREATE TABLE IF NOT EXISTS products (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          description TEXT,
          barcode TEXT UNIQUE,
          sanitary_registration TEXT,
          lot_number TEXT,
          presentation TEXT,
          laboratory TEXT,
          category_id INTEGER,
          unit_price REAL NOT NULL,
          cost_price REAL,
          has_sales_bonus INTEGER DEFAULT 0,
          sales_bonus_per_unit REAL DEFAULT 0,
          requires_prescription INTEGER DEFAULT 0,
          expiration_date DATE,
          is_active INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (category_id) REFERENCES categories(id)
        )
      `);

      // Product price history table
      db.run(`
        CREATE TABLE IF NOT EXISTS product_price_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          product_id INTEGER NOT NULL,
          old_unit_price REAL,
          new_unit_price REAL NOT NULL,
          old_cost_price REAL,
          new_cost_price REAL,
          presentation_id INTEGER,
          presentation_name TEXT,
          change_source TEXT,
          changed_by INTEGER,
          notes TEXT,
          valid_from DATETIME DEFAULT CURRENT_TIMESTAMP,
          valid_until DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (product_id) REFERENCES products(id),
          FOREIGN KEY (changed_by) REFERENCES users(id)
        )
      `);

      // Presentation types catalogue. A type is reusable: Unidad, Tableta, Frasco, Caja, etc.
      db.run(`
        CREATE TABLE IF NOT EXISTS presentation_types (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT UNIQUE NOT NULL,
          description TEXT,
          is_active INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Product-specific sale presentations. Inventory remains stored in base units.
      db.run(`
        CREATE TABLE IF NOT EXISTS product_presentations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          product_id INTEGER NOT NULL,
          presentation_type_id INTEGER,
          name TEXT NOT NULL,
          barcode TEXT,
          conversion_factor INTEGER NOT NULL DEFAULT 1,
          unit_price REAL NOT NULL,
          cost_price REAL,
          is_default INTEGER DEFAULT 0,
          is_active INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (product_id) REFERENCES products(id),
          FOREIGN KEY (presentation_type_id) REFERENCES presentation_types(id)
        )
      `);

      // Inventory table
      db.run(`
        CREATE TABLE IF NOT EXISTS inventory (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          product_id INTEGER NOT NULL,
          quantity INTEGER NOT NULL DEFAULT 0,
          min_stock INTEGER DEFAULT 0,
          max_stock INTEGER DEFAULT 0,
          location TEXT,
          last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (product_id) REFERENCES products(id)
        )
      `);

      // Inventory movements table
      db.run(`
        CREATE TABLE IF NOT EXISTS inventory_movements (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          product_id INTEGER NOT NULL,
          movement_type TEXT NOT NULL,
          quantity INTEGER NOT NULL,
          reference_number TEXT,
          notes TEXT,
          user_id INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (product_id) REFERENCES products(id),
          FOREIGN KEY (user_id) REFERENCES users(id)
        )
      `);

      // Customers table
      db.run(`
        CREATE TABLE IF NOT EXISTS customers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT,
          phone TEXT,
          address TEXT,
          document_type TEXT,
          document_number TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Cash registers (cajas) table
      db.run(`
        CREATE TABLE IF NOT EXISTS cash_registers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          accounting_date DATE NOT NULL,
          opened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          closed_at DATETIME,
          opening_balance REAL DEFAULT 0,
          closing_balance REAL,
          previous_closed_at DATETIME,
          previous_closing_balance REAL,
          reopened_at DATETIME,
          reopened_by_user_id INTEGER,
          reopen_notes TEXT,
          status TEXT NOT NULL DEFAULT 'open',
          total_sales INTEGER DEFAULT 0,
          total_amount REAL DEFAULT 0,
          notes TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id),
          FOREIGN KEY (reopened_by_user_id) REFERENCES users(id)
        )
      `);

      // Sales table
      db.run(`
        CREATE TABLE IF NOT EXISTS sales (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          sale_number TEXT UNIQUE NOT NULL,
          customer_id INTEGER,
          user_id INTEGER NOT NULL,
          cash_register_id INTEGER,
          total_amount REAL NOT NULL,
          discount REAL DEFAULT 0,
          tax_amount REAL DEFAULT 0,
          final_amount REAL NOT NULL,
          payment_method TEXT NOT NULL,
          payment_reference TEXT,
          status TEXT DEFAULT 'completed',
          notes TEXT,
          afecta_caja INTEGER DEFAULT 0,
          cash_payment_method TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (customer_id) REFERENCES customers(id),
          FOREIGN KEY (user_id) REFERENCES users(id),
          FOREIGN KEY (cash_register_id) REFERENCES cash_registers(id)
        )
      `);

      // Sale items table
      db.run(`
        CREATE TABLE IF NOT EXISTS sale_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          sale_id INTEGER NOT NULL,
          product_id INTEGER NOT NULL,
          quantity INTEGER NOT NULL,
          presentation_id INTEGER,
          presentation_name TEXT,
          conversion_factor INTEGER DEFAULT 1,
          stock_quantity INTEGER,
          unit_price REAL NOT NULL,
          cost_price REAL,
          discount REAL DEFAULT 0,
          sales_bonus_per_unit REAL DEFAULT 0,
          sales_bonus_total REAL DEFAULT 0,
          subtotal REAL NOT NULL,
          FOREIGN KEY (sale_id) REFERENCES sales(id),
          FOREIGN KEY (product_id) REFERENCES products(id),
          FOREIGN KEY (presentation_id) REFERENCES product_presentations(id)
        )
      `);

      // Detailed payments per sale (supports mixed payments)
      db.run(`
        CREATE TABLE IF NOT EXISTS sale_payment_details (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          sale_id INTEGER NOT NULL,
          payment_method TEXT NOT NULL,
          amount REAL NOT NULL,
          payment_reference TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (sale_id) REFERENCES sales(id),
          FOREIGN KEY (payment_method) REFERENCES payment_methods(value)
        )
      `);

      // Returns/Refunds table
      db.run(`
        CREATE TABLE IF NOT EXISTS returns (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          return_number TEXT UNIQUE NOT NULL,
          sale_id INTEGER NOT NULL,
          customer_id INTEGER,
          user_id INTEGER NOT NULL,
          cash_register_id INTEGER,
          refund_payment_method TEXT DEFAULT 'cash',
          total_amount REAL NOT NULL,
          reason TEXT,
          status TEXT DEFAULT 'completed',
          notes TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (sale_id) REFERENCES sales(id),
          FOREIGN KEY (customer_id) REFERENCES customers(id),
          FOREIGN KEY (user_id) REFERENCES users(id),
          FOREIGN KEY (cash_register_id) REFERENCES cash_registers(id)
        )
      `);

      // Detailed refunds per return (supports mixed refunds)
      db.run(`
        CREATE TABLE IF NOT EXISTS return_refund_details (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          return_id INTEGER NOT NULL,
          payment_method TEXT NOT NULL,
          amount REAL NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (return_id) REFERENCES returns(id),
          FOREIGN KEY (payment_method) REFERENCES payment_methods(value)
        )
      `);

      // Return items table
      db.run(`
        CREATE TABLE IF NOT EXISTS return_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          return_id INTEGER NOT NULL,
          sale_item_id INTEGER NOT NULL,
          product_id INTEGER NOT NULL,
          quantity INTEGER NOT NULL,
          unit_price REAL NOT NULL,
          refund_amount REAL NOT NULL,
          FOREIGN KEY (return_id) REFERENCES returns(id),
          FOREIGN KEY (sale_item_id) REFERENCES sale_items(id),
          FOREIGN KEY (product_id) REFERENCES products(id)
        )
      `);

      // Suppliers table
      db.run(`
        CREATE TABLE IF NOT EXISTS suppliers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          contact_name TEXT,
          email TEXT,
          phone TEXT,
          address TEXT,
          tax_id TEXT,
          notes TEXT,
          is_active INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Purchases table
      db.run(`
        CREATE TABLE IF NOT EXISTS purchases (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          purchase_number TEXT UNIQUE NOT NULL,
          supplier_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          total_amount REAL NOT NULL,
          discount REAL DEFAULT 0,
          tax_amount REAL DEFAULT 0,
          final_amount REAL NOT NULL,
          status TEXT DEFAULT 'completed',
          notes TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
          FOREIGN KEY (user_id) REFERENCES users(id)
        )
      `);

      // Purchase items table
      db.run(`
        CREATE TABLE IF NOT EXISTS purchase_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          purchase_id INTEGER NOT NULL,
          product_id INTEGER NOT NULL,
          quantity INTEGER NOT NULL,
          presentation_id INTEGER,
          presentation_name TEXT,
          conversion_factor INTEGER DEFAULT 1,
          stock_quantity INTEGER,
          unit_price REAL NOT NULL,
          cost_price REAL NOT NULL,
          subtotal REAL NOT NULL,
          FOREIGN KEY (purchase_id) REFERENCES purchases(id),
          FOREIGN KEY (product_id) REFERENCES products(id),
          FOREIGN KEY (presentation_id) REFERENCES product_presentations(id)
        )
      `);

      // Ensure cash_register_id column exists in sales table for existing databases
      db.all('PRAGMA table_info(sales)', (err, columns: any[]) => {
        if (err) {
          console.error('Error checking sales table structure:', err);
        } else {
          const hasCashRegisterId = columns.some((col) => col.name === 'cash_register_id');
          if (!hasCashRegisterId) {
            db.run(
              'ALTER TABLE sales ADD COLUMN cash_register_id INTEGER',
              (alterErr) => {
                if (alterErr) {
                  console.error('Error adding cash_register_id column to sales table:', alterErr);
                } else {
                  console.log('Column cash_register_id added to sales table');
                }
              }
            );
          }
          const hasPaymentReference = columns.some((col) => col.name === 'payment_reference');
          if (!hasPaymentReference) {
            db.run(
              'ALTER TABLE sales ADD COLUMN payment_reference TEXT',
              (alterErr) => {
                if (alterErr) {
                  console.error('Error adding payment_reference column to sales table:', alterErr);
                } else {
                  console.log('Column payment_reference added to sales table');
                }
              }
            );
          }
        }
      });

      db.all('PRAGMA table_info(payment_methods)', (err, columns: any[]) => {
        if (err) {
          console.error('Error checking payment_methods table structure:', err);
          return;
        }

        const colNames = (columns || []).map((c) => c.name);
        const addColumn = (name: string, type: string) => {
          if (colNames.includes(name)) return;
          db.run(`ALTER TABLE payment_methods ADD COLUMN ${name} ${type}`, (alterErr) => {
            if (alterErr) {
              console.error(`Error adding ${name} to payment_methods:`, alterErr);
            } else {
              console.log(`Column ${name} added to payment_methods`);
            }
          });
        };

        addColumn('requires_reference', 'INTEGER DEFAULT 0');
        addColumn('reference_required', 'INTEGER DEFAULT 0');
        addColumn('reference_label', "TEXT DEFAULT 'Código / Referencia'");

        db.run(`
          INSERT OR IGNORE INTO payment_methods (value, name, description, is_cash, is_active)
          VALUES
            ('cash', 'Efectivo', 'Pago en dinero en efectivo', 1, 1),
            ('card', 'Tarjeta', 'Pago con tarjeta', 0, 1),
            ('transfer', 'Transferencia', 'Pago por transferencia bancaria', 0, 1),
            ('check', 'Cheque', 'Pago con cheque', 0, 1)
        `);
        db.run(
          `UPDATE payment_methods
           SET requires_reference = 1, reference_required = 0, reference_label = 'Voucher / operación'
           WHERE value = 'card' AND COALESCE(requires_reference, 0) = 0`
        );
        db.run(
          `UPDATE payment_methods
           SET requires_reference = 1, reference_required = 1, reference_label = 'N° de operación'
           WHERE value = 'transfer' AND COALESCE(requires_reference, 0) = 0`
        );
        db.run(
          `UPDATE payment_methods
           SET requires_reference = 1, reference_required = 0, reference_label = 'N° de cheque'
           WHERE value = 'check' AND COALESCE(requires_reference, 0) = 0`
        );
      });

      db.all('PRAGMA table_info(users)', (err, columns: any[]) => {
        if (err) {
          console.error('Error checking users table structure:', err);
          return;
        }

        const seedUserAccessData = () => {
          db.run(`
            INSERT OR IGNORE INTO user_profiles (id, name, description, role, is_active)
            VALUES
              (1, 'Administrador', 'Acceso completo al sistema', 'admin', 1),
              (2, 'Vendedor', 'Operación de ventas, caja y consultas principales', 'employee', 1)
          `);

          const profileStmt = db.prepare(
            'INSERT OR IGNORE INTO profile_module_permissions (profile_id, module_key, can_access) VALUES (?, ?, ?)'
          );
          const modules = [
            'dashboard', 'products', 'categories', 'payment-methods', 'company-settings', 'inventory',
            'sales', 'cash-register', 'cash-movements', 'cash-reports', 'product-movements', 'alerts', 'customers',
            'reports', 'returns', 'suppliers', 'purchases', 'users', 'scan-qr',
          ];
          modules.forEach((moduleKey) => {
            profileStmt.run(1, moduleKey, 1);
            profileStmt.run(2, moduleKey, moduleKey === 'users' || moduleKey === 'company-settings' ? 0 : 1);
          });
          profileStmt.finalize();

          db.run(`
            INSERT OR IGNORE INTO workers (document_number, full_name, email, position, is_active)
            SELECT 'USER-' || id, full_name, email, CASE WHEN role = 'admin' THEN 'Administrador' ELSE 'Trabajador' END, is_active
            FROM users
            WHERE worker_id IS NULL
          `);
          db.run(`
            UPDATE users
            SET worker_id = (
              SELECT w.id FROM workers w WHERE w.document_number = 'USER-' || users.id LIMIT 1
            )
            WHERE worker_id IS NULL
          `);
          db.run(`
            UPDATE users
            SET profile_id = CASE WHEN role = 'admin' THEN 1 ELSE 2 END
            WHERE profile_id IS NULL
          `);
          db.run(`
            UPDATE users
            SET full_name = (
              SELECT w.full_name FROM workers w WHERE w.id = users.worker_id LIMIT 1
            ),
            email = COALESCE(
              NULLIF((SELECT w.email FROM workers w WHERE w.id = users.worker_id LIMIT 1), ''),
              users.email
            ),
            updated_at = CURRENT_TIMESTAMP
            WHERE worker_id IS NOT NULL
              AND EXISTS (
                SELECT 1 FROM workers w
                WHERE w.id = users.worker_id
                  AND (
                    COALESCE(users.full_name, '') != COALESCE(w.full_name, '')
                    OR (
                      w.email IS NOT NULL
                      AND w.email != ''
                      AND COALESCE(users.email, '') != w.email
                    )
                  )
              )
          `);
        };

        const colNames = (columns || []).map((c) => c.name);
        const pendingColumns = [
          ['worker_id', 'INTEGER'],
          ['profile_id', 'INTEGER'],
        ].filter(([name]) => !colNames.includes(name));

        const addNextColumn = () => {
          const next = pendingColumns.shift();
          if (!next) {
            seedUserAccessData();
            return;
          }
          const [name, type] = next;
          db.run(`ALTER TABLE users ADD COLUMN ${name} ${type}`, (alterErr) => {
            if (alterErr) {
              console.error(`Error adding ${name} to users:`, alterErr);
            } else {
              console.log(`Column ${name} added to users`);
            }
            addNextColumn();
          });
        };

        addNextColumn();
      });

      db.all('PRAGMA table_info(company_settings)', (err, columns: any[]) => {
        if (err) {
          console.error('Error checking company_settings table structure:', err);
          return;
        }

        const colNames = (columns || []).map((c) => c.name);
        const addColumn = (name: string, type: string) => {
          if (colNames.includes(name)) return;
          db.run(`ALTER TABLE company_settings ADD COLUMN ${name} ${type}`, (alterErr) => {
            if (alterErr) {
              console.error(`Error adding ${name} to company_settings:`, alterErr);
            } else {
              console.log(`Column ${name} added to company_settings`);
            }
          });
        };

        addColumn('business_name', "TEXT DEFAULT 'FARMACIA'");
        addColumn('trade_name', "TEXT DEFAULT 'Sistema de Farmacia'");
        addColumn('tax_id', 'TEXT');
        addColumn('address', 'TEXT');
        addColumn('phone', 'TEXT');
        addColumn('email', 'TEXT');
        addColumn('website', 'TEXT');
        addColumn('logo_data_url', 'TEXT');
        addColumn('receipt_title', "TEXT DEFAULT 'COMPROBANTE DE VENTA'");
        addColumn('receipt_footer', "TEXT DEFAULT 'Gracias por su compra'");
        addColumn('receipt_width_mm', 'INTEGER DEFAULT 80');
        addColumn('show_logo', 'INTEGER DEFAULT 1');
        addColumn('show_qr', 'INTEGER DEFAULT 1');
        addColumn('non_admin_history_days', 'INTEGER DEFAULT 5');
        addColumn('cash_reopen_password', "TEXT DEFAULT 'admin123'");
        addColumn('return_password', "TEXT DEFAULT 'd3v0luc10n$2026$*'");
        addColumn('purchase_cancel_password', "TEXT DEFAULT 'admin123'");
      });

      // Ensure product bonus/expiration columns exist in products table for existing databases
      db.all('PRAGMA table_info(products)', (err, columns: any[]) => {
        if (err) {
          console.error('Error checking products table structure:', err);
        } else {
          const colNames = (columns || []).map((col) => col.name);
          const addColumn = (name: string, type: string) => {
            if (colNames.includes(name)) return;
            db.run(`ALTER TABLE products ADD COLUMN ${name} ${type}`, (alterErr) => {
              if (alterErr) {
                console.error(`Error adding ${name} column to products table:`, alterErr);
              } else {
                console.log(`Column ${name} added to products table`);
              }
            });
          };

          addColumn('expiration_date', 'DATE');
          addColumn('has_sales_bonus', 'INTEGER DEFAULT 0');
          addColumn('sales_bonus_per_unit', 'REAL DEFAULT 0');
          addColumn('sanitary_registration', 'TEXT');
          addColumn('lot_number', 'TEXT');
          addColumn('presentation', 'TEXT');
          addColumn('laboratory', 'TEXT');
        }
      });

      db.run(`
        INSERT OR IGNORE INTO presentation_types (name, description)
        VALUES
          ('Unidad', 'Venta por unidad base'),
          ('Tableta', 'Venta por tableta'),
          ('Blíster', 'Venta por blíster'),
          ('Frasco', 'Venta por frasco'),
          ('Caja', 'Venta por caja'),
          ('Ampolla', 'Venta por ampolla'),
          ('Sobre', 'Venta por sobre')
      `);

      db.run(`
        INSERT INTO product_presentations (product_id, presentation_type_id, name, barcode, conversion_factor, unit_price, cost_price, is_default, is_active)
        SELECT
          p.id,
          (SELECT id FROM presentation_types WHERE name = 'Unidad' LIMIT 1),
          COALESCE(NULLIF(p.presentation, ''), 'Unidad'),
          p.barcode,
          1,
          p.unit_price,
          p.cost_price,
          1,
          1
        FROM products p
        WHERE NOT EXISTS (
          SELECT 1
          FROM product_presentations pp
          WHERE pp.product_id = p.id
        )
      `, (err) => {
        if (err) {
          console.error('Error backfilling product presentations before critical migration:', err);
        }
      });

      // Ensure audit columns exist in cash_registers table (for existing databases)
      db.all('PRAGMA table_info(cash_registers)', (err, columns: any[]) => {
        if (err) {
          console.error('Error checking cash_registers table structure:', err);
          return;
        }

        const colNames = (columns || []).map((c) => c.name);
        const addColumn = (name: string, type: string) => {
          if (colNames.includes(name)) return;
          db.run(`ALTER TABLE cash_registers ADD COLUMN ${name} ${type}`, (alterErr) => {
            if (alterErr) {
              console.error(`Error adding ${name} to cash_registers:`, alterErr);
            } else {
              console.log(`Column ${name} added to cash_registers`);
            }
          });
        };

        addColumn('previous_closed_at', 'DATETIME');
        addColumn('previous_closing_balance', 'REAL');
        addColumn('reopened_at', 'DATETIME');
        addColumn('reopened_by_user_id', 'INTEGER');
        addColumn('reopen_notes', 'TEXT');
      });

      // Ensure cash_register_id column exists in returns table (for existing databases)
      db.all('PRAGMA table_info(returns)', (err, columns: any[]) => {
        if (err) {
          console.error('Error checking returns table structure:', err);
        } else {
          const colNames = (columns || []).map((col) => col.name);
          const hasCashRegisterId = colNames.includes('cash_register_id');
          if (!hasCashRegisterId) {
            db.run('ALTER TABLE returns ADD COLUMN cash_register_id INTEGER', (alterErr) => {
              if (alterErr) {
                console.error('Error adding cash_register_id column to returns table:', alterErr);
              } else {
                console.log('Column cash_register_id added to returns table');
              }
            });
          }
          if (!colNames.includes('refund_payment_method')) {
            db.run("ALTER TABLE returns ADD COLUMN refund_payment_method TEXT DEFAULT 'cash'", (alterErr) => {
              if (alterErr) {
                console.error('Error adding refund_payment_method column to returns table:', alterErr);
              } else {
                console.log('Column refund_payment_method added to returns table');
              }
            });
          }
        }
      });

      // Cash movements table (for purchases affecting cash, expenses, etc.)
      db.run(`
        CREATE TABLE IF NOT EXISTS cash_movements (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          cash_register_id INTEGER NOT NULL,
          cash_account_id INTEGER,
          movement_type TEXT NOT NULL,
          amount REAL NOT NULL,
          payment_method TEXT,
          reference_type TEXT,
          reference_id INTEGER,
          description TEXT,
          user_id INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (cash_register_id) REFERENCES cash_registers(id),
          FOREIGN KEY (user_id) REFERENCES users(id)
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS cash_accounts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          account_type TEXT NOT NULL DEFAULT 'both',
          description TEXT,
          is_active INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (accountErr) => {
        if (accountErr) {
          console.error('Error creating cash_accounts table:', accountErr);
          return;
        }

        const defaultAccounts = [
          ['Almuerzo', 'expense', 'Gastos de alimentacion del turno'],
          ['Movilidad', 'expense', 'Gastos de movilidad o transporte'],
          ['Compra menor', 'expense', 'Salida menor no registrada como compra a proveedor'],
          ['Ingreso extra', 'income', 'Ingreso manual adicional a caja'],
          ['Otros', 'both', 'Cuenta general para ingresos o salidas varias'],
        ];

        defaultAccounts.forEach(([name, accountType, description]) => {
          db.run(
            `INSERT OR IGNORE INTO cash_accounts (name, account_type, description, is_active)
             VALUES (?, ?, ?, 1)`,
            [name, accountType, description]
          );
        });
      });

      db.run(`
        CREATE TABLE IF NOT EXISTS cash_denominations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          value REAL NOT NULL UNIQUE,
          sort_order INTEGER DEFAULT 0,
          is_active INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (denominationErr) => {
        if (denominationErr) {
          console.error('Error creating cash_denominations table:', denominationErr);
          return;
        }

        const defaultDenominations = [
          ['S/ 0.10', 0.10, 10],
          ['S/ 0.20', 0.20, 20],
          ['S/ 0.50', 0.50, 50],
          ['S/ 1.00', 1.00, 100],
          ['S/ 2.00', 2.00, 200],
          ['S/ 5.00', 5.00, 500],
          ['S/ 10.00', 10.00, 1000],
          ['S/ 20.00', 20.00, 2000],
          ['S/ 50.00', 50.00, 5000],
          ['S/ 100.00', 100.00, 10000],
          ['S/ 200.00', 200.00, 20000],
        ];

        defaultDenominations.forEach(([name, value, sortOrder]) => {
          db.run(
            `INSERT OR IGNORE INTO cash_denominations (name, value, sort_order, is_active)
             VALUES (?, ?, ?, 1)`,
            [name, value, sortOrder]
          );
        });
      });

      db.run(`
        CREATE TABLE IF NOT EXISTS cash_register_cash_counts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          cash_register_id INTEGER NOT NULL,
          denomination_id INTEGER,
          denomination_name TEXT NOT NULL,
          denomination_value REAL NOT NULL,
          quantity INTEGER NOT NULL DEFAULT 0,
          total REAL NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (cash_register_id) REFERENCES cash_registers(id),
          FOREIGN KEY (denomination_id) REFERENCES cash_denominations(id)
        )
      `);

      db.all('PRAGMA table_info(cash_movements)', (err, columns: any[]) => {
        if (err) {
          console.error('Error checking cash_movements table structure:', err);
          return;
        }
        const colNames = (columns || []).map((c) => c.name);
        if (!colNames.includes('cash_account_id')) {
          db.run('ALTER TABLE cash_movements ADD COLUMN cash_account_id INTEGER', (alterErr) => {
            if (alterErr) {
              console.error('Error adding cash_account_id to cash_movements:', alterErr);
            } else {
              console.log('Column cash_account_id added to cash_movements');
            }
          });
        }
        if (!colNames.includes('payment_method')) {
          db.run('ALTER TABLE cash_movements ADD COLUMN payment_method TEXT', (alterErr) => {
            if (alterErr) {
              console.error('Error adding payment_method to cash_movements:', alterErr);
            } else {
              console.log('Column payment_method added to cash_movements');
              db.run("UPDATE cash_movements SET payment_method = 'cash' WHERE payment_method IS NULL");
            }
          });
        } else {
          db.run("UPDATE cash_movements SET payment_method = 'cash' WHERE payment_method IS NULL");
        }
      });

      // User module permissions (per-module access for employees)
      db.run(`
        CREATE TABLE IF NOT EXISTS user_module_permissions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          module_key TEXT NOT NULL,
          can_access INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, module_key),
          FOREIGN KEY (user_id) REFERENCES users(id)
        )
      `);

      // Ensure cash_register_id and afecta_caja exist in purchases table
      db.all('PRAGMA table_info(purchases)', (err, columns: any[]) => {
        if (err) {
          console.error('Error checking purchases table structure:', err);
          return;
        }
        const colNames = (columns || []).map((c) => c.name);
        if (!colNames.includes('cash_register_id')) {
          db.run('ALTER TABLE purchases ADD COLUMN cash_register_id INTEGER', (alterErr) => {
            if (alterErr) console.error('Error adding cash_register_id to purchases:', alterErr);
            else console.log('Column cash_register_id added to purchases');
          });
        }
        if (!colNames.includes('afecta_caja')) {
          db.run('ALTER TABLE purchases ADD COLUMN afecta_caja INTEGER DEFAULT 0', (alterErr) => {
            if (alterErr) console.error('Error adding afecta_caja to purchases:', alterErr);
            else console.log('Column afecta_caja added to purchases');
          });
        }
        if (!colNames.includes('cash_payment_method')) {
          db.run('ALTER TABLE purchases ADD COLUMN cash_payment_method TEXT', (alterErr) => {
            if (alterErr) console.error('Error adding cash_payment_method to purchases:', alterErr);
            else console.log('Column cash_payment_method added to purchases');
          });
        }

        if (colNames.includes('cash_register_id') && colNames.includes('afecta_caja')) {
          const paymentMethodExpression = colNames.includes('cash_payment_method')
            ? "COALESCE(p.cash_payment_method, 'cash')"
            : "'cash'";
          db.run(
            `INSERT INTO cash_movements (cash_register_id, movement_type, amount, payment_method, reference_type, reference_id, description, user_id)
             SELECT
               p.cash_register_id,
               'purchase',
               -p.final_amount,
               ${paymentMethodExpression},
               'purchase',
               p.id,
               'Compra ' || p.purchase_number,
               p.user_id
             FROM purchases p
             WHERE COALESCE(p.afecta_caja, 0) = 1
               AND p.cash_register_id IS NOT NULL
               AND NOT EXISTS (
                 SELECT 1
                 FROM cash_movements cm
                 WHERE cm.reference_type = 'purchase'
                   AND cm.reference_id = p.id
               )`,
            (backfillErr) => {
              if (backfillErr) {
                console.error('Error backfilling purchase cash movements:', backfillErr);
              }
            }
          );
        }
      });

      // Create default admin user (password: admin123)
      db.run(`
        INSERT OR IGNORE INTO users (username, email, password, full_name, role)
        VALUES ('admin', 'admin@farmacia.com', ?, 'Administrador', 'admin')
      `, [adminPassword], (err) => {
        if (err) {
          console.error('Error creating default admin:', err);
        } else {
          console.log('Default admin user created (username: admin, password: admin123)');
          db.all('PRAGMA table_info(users)', (userInfoErr, userColumns: any[]) => {
            if (userInfoErr) return;
            const userColNames = (userColumns || []).map((column) => column.name);
            if (!userColNames.includes('worker_id') || !userColNames.includes('profile_id')) return;
            db.run(`
              INSERT OR IGNORE INTO workers (document_number, full_name, email, position, is_active)
              SELECT 'USER-' || id, full_name, email, 'Administrador', is_active
              FROM users
              WHERE username = 'admin'
            `);
            db.run(`
              UPDATE users
              SET worker_id = (
                SELECT w.id FROM workers w WHERE w.document_number = 'USER-' || users.id LIMIT 1
              ),
              profile_id = 1
              WHERE username = 'admin' AND (worker_id IS NULL OR profile_id IS NULL)
            `);
          });
        }
      });

      // Categories are now created dynamically through the system, not automatically

      db.run(`
        INSERT OR IGNORE INTO company_settings (
          id, business_name, trade_name, receipt_title, receipt_footer, receipt_width_mm, show_logo, show_qr
        )
        VALUES (1, 'FARMACIA', 'Sistema de Farmacia', 'COMPROBANTE DE VENTA', 'Gracias por su compra', 80, 1, 1)
      `);

      runCriticalMigrations()
        .then(() => resolve())
        .catch((migrationErr) => {
          console.error('Error running critical database migrations:', migrationErr);
          reject(migrationErr);
        });
    });
  });
}


