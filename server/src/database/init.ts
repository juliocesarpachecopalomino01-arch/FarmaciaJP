import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';

dotenv.config();

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../database/farmacia.db');
const DB_DIR = path.dirname(DB_PATH);

// Ensure directory exists before opening sqlite file
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

export const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('✅ Connected to SQLite database');
  }
});

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
          is_active INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

      // Products table
      db.run(`
        CREATE TABLE IF NOT EXISTS products (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          description TEXT,
          barcode TEXT UNIQUE,
          category_id INTEGER,
          unit_price REAL NOT NULL,
          cost_price REAL,
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
          changed_by INTEGER,
          notes TEXT,
          valid_from DATETIME DEFAULT CURRENT_TIMESTAMP,
          valid_until DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (product_id) REFERENCES products(id),
          FOREIGN KEY (changed_by) REFERENCES users(id)
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
          status TEXT DEFAULT 'completed',
          notes TEXT,
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
          unit_price REAL NOT NULL,
          discount REAL DEFAULT 0,
          subtotal REAL NOT NULL,
          FOREIGN KEY (sale_id) REFERENCES sales(id),
          FOREIGN KEY (product_id) REFERENCES products(id)
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
          unit_price REAL NOT NULL,
          cost_price REAL NOT NULL,
          subtotal REAL NOT NULL,
          FOREIGN KEY (purchase_id) REFERENCES purchases(id),
          FOREIGN KEY (product_id) REFERENCES products(id)
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
                  console.log('✅ Column cash_register_id added to sales table');
                }
              }
            );
          }
        }
      });

      // Ensure expiration_date column exists in products table for existing databases
      db.all('PRAGMA table_info(products)', (err, columns: any[]) => {
        if (err) {
          console.error('Error checking products table structure:', err);
        } else {
          const hasExpirationDate = (columns || []).some((col) => col.name === 'expiration_date');
          if (!hasExpirationDate) {
            db.run(
              'ALTER TABLE products ADD COLUMN expiration_date DATE',
              (alterErr) => {
                if (alterErr) {
                  console.error('Error adding expiration_date column to products table:', alterErr);
                } else {
                  console.log('✅ Column expiration_date added to products table');
                }
              }
            );
          }
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
              console.log(`✅ Column ${name} added to cash_registers`);
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
          const hasCashRegisterId = (columns || []).some((col) => col.name === 'cash_register_id');
          if (!hasCashRegisterId) {
            db.run('ALTER TABLE returns ADD COLUMN cash_register_id INTEGER', (alterErr) => {
              if (alterErr) {
                console.error('Error adding cash_register_id column to returns table:', alterErr);
              } else {
                console.log('✅ Column cash_register_id added to returns table');
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
          movement_type TEXT NOT NULL,
          amount REAL NOT NULL,
          reference_type TEXT,
          reference_id INTEGER,
          description TEXT,
          user_id INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (cash_register_id) REFERENCES cash_registers(id),
          FOREIGN KEY (user_id) REFERENCES users(id)
        )
      `);

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
            else console.log('✅ Column cash_register_id added to purchases');
          });
        }
        if (!colNames.includes('afecta_caja')) {
          db.run('ALTER TABLE purchases ADD COLUMN afecta_caja INTEGER DEFAULT 0', (alterErr) => {
            if (alterErr) console.error('Error adding afecta_caja to purchases:', alterErr);
            else console.log('✅ Column afecta_caja added to purchases');
          });
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
          console.log('✅ Default admin user created (username: admin, password: admin123)');
        }
      });

      // Categories are now created dynamically through the system, not automatically

      resolve();
    });
  });
}
