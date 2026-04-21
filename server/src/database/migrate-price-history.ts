import { db } from './init';
import dotenv from 'dotenv';

dotenv.config();

async function migratePriceHistory() {
  return new Promise<void>((resolve, reject) => {
    db.serialize(() => {
      // Check if columns already exist
      db.get("PRAGMA table_info(product_price_history)", (err, result: any) => {
        if (err) {
          console.error('Error checking table structure:', err);
          return reject(err);
        }

        // Get all columns
        db.all("PRAGMA table_info(product_price_history)", (err, columns: any[]) => {
          if (err) {
            console.error('Error getting columns:', err);
            return reject(err);
          }

          const columnNames = columns.map(col => col.name);
          const needsValidFrom = !columnNames.includes('valid_from');
          const needsValidUntil = !columnNames.includes('valid_until');

          if (!needsValidFrom && !needsValidUntil) {
            console.log('✅ Campos valid_from y valid_until ya existen');
            // Update existing records
            updateExistingRecords().then(resolve).catch(reject);
            return;
          }

          // Add missing columns
          if (needsValidFrom) {
            db.run(`
              ALTER TABLE product_price_history 
              ADD COLUMN valid_from DATETIME DEFAULT CURRENT_TIMESTAMP
            `, (err) => {
              if (err) {
                console.error('Error adding valid_from column:', err);
                return reject(err);
              }
              console.log('✅ Columna valid_from agregada');
            });
          }

          if (needsValidUntil) {
            db.run(`
              ALTER TABLE product_price_history 
              ADD COLUMN valid_until DATETIME
            `, (err) => {
              if (err) {
                console.error('Error adding valid_until column:', err);
                return reject(err);
              }
              console.log('✅ Columna valid_until agregada');
              
              // Update existing records
              updateExistingRecords().then(resolve).catch(reject);
            });
          }
        });
      });
    });
  });
}

function updateExistingRecords(): Promise<void> {
  return new Promise((resolve, reject) => {
    // Update existing records: set valid_from = created_at and valid_until = NULL for the latest price
    db.run(`
      UPDATE product_price_history 
      SET valid_from = created_at 
      WHERE valid_from IS NULL
    `, (err) => {
      if (err) {
        console.error('Error updating valid_from:', err);
        return reject(err);
      }

      // For each product, set valid_until = NULL for the most recent price, and set valid_until for older ones
      db.run(`
        UPDATE product_price_history
        SET valid_until = (
          SELECT MIN(ph2.created_at)
          FROM product_price_history ph2
          WHERE ph2.product_id = product_price_history.product_id
          AND ph2.created_at > product_price_history.created_at
        )
        WHERE valid_until IS NULL
        AND EXISTS (
          SELECT 1
          FROM product_price_history ph2
          WHERE ph2.product_id = product_price_history.product_id
          AND ph2.created_at > product_price_history.created_at
        )
      `, (err) => {
        if (err) {
          console.error('Error updating valid_until:', err);
          return reject(err);
        }

        console.log('✅ Registros existentes actualizados');
        resolve();
      });
    });
  });
}

// Also create initial price history for products that don't have any history
function createInitialHistoryForProducts(): Promise<void> {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT p.id, p.unit_price, p.cost_price, p.created_at
      FROM products p
      WHERE p.is_active = 1
      AND NOT EXISTS (
        SELECT 1
        FROM product_price_history ph
        WHERE ph.product_id = p.id
      )
    `, [], (err, products: any[]) => {
      if (err) {
        console.error('Error finding products without history:', err);
        return reject(err);
      }

      if (products.length === 0) {
        console.log('✅ Todos los productos tienen historial');
        resolve();
        return;
      }

      let processed = 0;
      products.forEach((product) => {
        db.run(`
          INSERT INTO product_price_history 
          (product_id, old_unit_price, new_unit_price, old_cost_price, new_cost_price, changed_by, notes, valid_from, valid_until)
          VALUES (?, NULL, ?, NULL, ?, NULL, 'Precio inicial (migración)', ?, NULL)
        `, [
          product.id,
          product.unit_price,
          product.cost_price || null,
          product.created_at || new Date().toISOString()
        ], (err) => {
          if (err) {
            console.error(`Error creating history for product ${product.id}:`, err);
          }
          processed++;
          if (processed === products.length) {
            console.log(`✅ Historial inicial creado para ${products.length} producto(s)`);
            resolve();
          }
        });
      });
    });
  });
}

// Run migration
migratePriceHistory()
  .then(() => createInitialHistoryForProducts())
  .then(() => {
    console.log('✅ Migración completada exitosamente');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Error en la migración:', error);
    process.exit(1);
  });
