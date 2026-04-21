import express from 'express';
import PDFDocument from 'pdfkit';
import { db } from '../database/init';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = express.Router();

// Generate receipt PDF
router.get('/:saleId/pdf', authenticateToken, (req: AuthRequest, res) => {
  const { saleId } = req.params;

  db.get(
    `SELECT s.*, c.name as customer_name, c.email as customer_email, c.phone as customer_phone,
            u.username as user_name, u.full_name as user_full_name
     FROM sales s
     LEFT JOIN customers c ON s.customer_id = c.id
     INNER JOIN users u ON s.user_id = u.id
     WHERE s.id = ?`,
    [saleId],
    (err, sale: any) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      if (!sale) {
        return res.status(404).json({ error: 'Sale not found' });
      }

      // Get sale items
      db.all(
        `SELECT si.*, p.name as product_name, p.barcode
         FROM sale_items si
         INNER JOIN products p ON si.product_id = p.id
         WHERE si.sale_id = ?`,
        [saleId],
        (err, items: any[]) => {
          if (err) {
            return res.status(500).json({ error: 'Database error' });
          }

          // Generate PDF
          const doc = new PDFDocument({ margin: 50, size: [226.77, 841.89] }); // 80mm width (thermal printer size)
          
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', `inline; filename="ticket-${sale.sale_number}.pdf"`);
          
          doc.pipe(res);

          // Header
          doc.fontSize(20).text('FARMACIA', { align: 'center' });
          doc.moveDown(0.5);
          doc.fontSize(10).text('Sistema de Farmacia', { align: 'center' });
          doc.moveDown(1);
          doc.moveTo(50, doc.y).lineTo(176.77, doc.y).stroke();
          doc.moveDown(1);

          // Sale info
          doc.fontSize(12).text(`Ticket: ${sale.sale_number}`, { align: 'left' });
          doc.fontSize(10).text(`Fecha: ${new Date(sale.created_at).toLocaleString('es-ES')}`, { align: 'left' });
          if (sale.customer_name) {
            doc.text(`Cliente: ${sale.customer_name}`, { align: 'left' });
          }
          doc.text(`Vendedor: ${sale.user_full_name || sale.user_name}`, { align: 'left' });
          doc.moveDown(1);
          doc.moveTo(50, doc.y).lineTo(176.77, doc.y).stroke();
          doc.moveDown(1);

          // Items
          doc.fontSize(10).text('PRODUCTOS', { align: 'left' });
          doc.moveDown(0.5);
          
          items.forEach((item) => {
            doc.fontSize(9).text(`${item.product_name}`, { align: 'left' });
            if (item.product_id) {
              doc.fontSize(8).text(`  ${item.quantity} x $${item.unit_price.toFixed(2)}`, { align: 'left' });
            }
            if (item.discount > 0) {
              doc.fontSize(8).text(`  Descuento: $${item.discount.toFixed(2)}`, { align: 'left' });
            }
            doc.fontSize(9).text(`  Subtotal: $${item.subtotal.toFixed(2)}`, { align: 'right' });
            doc.moveDown(0.3);
          });

          doc.moveDown(1);
          doc.moveTo(50, doc.y).lineTo(176.77, doc.y).stroke();
          doc.moveDown(1);

          // Totals
          doc.fontSize(10).text(`Subtotal: $${sale.total_amount.toFixed(2)}`, { align: 'right' });
          if (sale.discount > 0) {
            doc.text(`Descuento: -$${sale.discount.toFixed(2)}`, { align: 'right' });
          }
          if (sale.tax_amount > 0) {
            doc.text(`Impuesto: $${sale.tax_amount.toFixed(2)}`, { align: 'right' });
          }
          doc.fontSize(12).font('Helvetica-Bold').text(`TOTAL: $${sale.final_amount.toFixed(2)}`, { align: 'right' });
          doc.moveDown(1);
          doc.moveTo(50, doc.y).lineTo(176.77, doc.y).stroke();
          doc.moveDown(1);

          // Payment method
          doc.fontSize(10).text(`Método de pago: ${sale.payment_method.toUpperCase()}`, { align: 'center' });
          doc.moveDown(2);

          // Footer
          doc.fontSize(8).text('Gracias por su compra', { align: 'center' });
          doc.text('Sistema de Farmacia - Open Source', { align: 'center' });

          doc.end();
        }
      );
    }
  );
});

export default router;
