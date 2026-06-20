import express from 'express';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { db } from '../database/init';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = express.Router();

const mmToPoints = (mm: number) => mm * 2.83465;
const money = (value: number) => `$${Number(value || 0).toFixed(2)}`;
const amount = (value: number) => Number(value || 0).toFixed(2);

function imageBufferFromDataUrl(dataUrl?: string | null) {
  if (!dataUrl || !dataUrl.includes(',')) return null;
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

function line(doc: any, left: number, right: number) {
  doc.moveDown(0.15);
  doc.moveTo(left, doc.y).lineTo(right, doc.y).stroke();
  doc.moveDown(0.15);
}

function getSettings(): Promise<any> {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM company_settings WHERE id = 1', [], (err, row) => {
      if (err) return reject(err);
      resolve(row || {
        business_name: 'FARMACIA',
        trade_name: 'Sistema de Farmacia',
        receipt_title: 'COMPROBANTE DE VENTA',
        receipt_footer: 'Gracias por su compra',
        receipt_width_mm: 80,
        show_logo: 1,
        show_qr: 1,
      });
    });
  });
}

function getSale(saleId: string): Promise<any> {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT s.*, COALESCE(pm.name, s.payment_method) as payment_method_name, c.name as customer_name, c.email as customer_email, c.phone as customer_phone,
              u.username as user_name, u.full_name as user_full_name
       FROM sales s
       LEFT JOIN customers c ON s.customer_id = c.id
       LEFT JOIN payment_methods pm ON pm.value = s.payment_method
       INNER JOIN users u ON s.user_id = u.id
       WHERE s.id = ?`,
      [saleId],
      (err, sale) => {
        if (err) return reject(err);
        resolve(sale);
      }
    );
  });
}

function getItems(saleId: string): Promise<any[]> {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT si.*, p.name as product_name, p.barcode
       FROM sale_items si
       INNER JOIN products p ON si.product_id = p.id
       WHERE si.sale_id = ?`,
      [saleId],
      (err, items) => {
        if (err) return reject(err);
        resolve(items || []);
      }
    );
  });
}

function getInventoryMovement(movementId: string): Promise<any> {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT im.*, p.name as product_name, p.barcode, COALESCE(i.quantity, 0) as current_stock,
              u.username as user_name, u.full_name as user_full_name
       FROM inventory_movements im
       INNER JOIN products p ON im.product_id = p.id
       LEFT JOIN inventory i ON p.id = i.product_id
       LEFT JOIN users u ON im.user_id = u.id
       WHERE im.id = ?`,
      [movementId],
      (err, movement) => {
        if (err) return reject(err);
        resolve(movement);
      }
    );
  });
}

router.get('/inventory-adjustments/:movementId/pdf', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { movementId } = req.params;
    const [settings, movement] = await Promise.all([
      getSettings(),
      getInventoryMovement(movementId),
    ]);

    if (!movement) {
      return res.status(404).json({ error: 'Movement not found' });
    }
    if (movement.movement_type !== 'adjustment') {
      return res.status(400).json({ error: 'Only adjustment movements have this voucher' });
    }

    const width = mmToPoints(Number(settings.receipt_width_mm || 80));
    const margin = 14;
    const contentRight = width - margin;
    const quantity = Number(movement.quantity) || 0;
    const currentStock = Number(movement.current_stock) || 0;
    const previousStock = currentStock + quantity;
    const hasLogo = Boolean(settings.logo_data_url && settings.show_logo);
    const estimatedHeight = margin * 2 + (hasLogo ? 36 : 20) + 170 + (settings.show_qr ? 60 : 0);

    const doc = new PDFDocument({
      margin,
      size: [width, Math.max(estimatedHeight, 260)],
      bufferPages: false,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="ajuste-${movement.reference_number || movement.id}.pdf"`);
    doc.pipe(res);

    const logo = imageBufferFromDataUrl(settings.logo_data_url);
    if (hasLogo && logo) {
      try {
        const image = (doc as any).openImage(logo);
        const availableWidth = contentRight - margin;
        const scaledHeight = Math.min(30, availableWidth * (image.height / image.width));
        const scaledWidth = Math.min(availableWidth, scaledHeight * (image.width / image.height));
        doc.image(logo, margin + (availableWidth - scaledWidth) / 2, doc.y, { width: scaledWidth, height: scaledHeight });
        doc.y += scaledHeight + 1;
      } catch {
        doc.y += 2;
      }
    } else {
      doc.font('Helvetica-Bold').fontSize(12).text(settings.business_name || 'FARMACIA', { align: 'center' });
    }

    doc.font('Helvetica').fontSize(7);
    if (settings.tax_id) doc.text(`RUC/NIT: ${settings.tax_id}`, { align: 'center' });
    if (settings.address) doc.text(settings.address, { align: 'center' });
    if (settings.phone) doc.text(`Tel: ${settings.phone}`, { align: 'center' });
    line(doc, margin, contentRight);

    doc.font('Helvetica-Bold').fontSize(8).text('COMPROBANTE DE AJUSTE DE INVENTARIO', { align: 'center' });
    doc.moveDown(0.2);
    doc.font('Helvetica').fontSize(7);
    doc.text(`Comprobante: ${movement.reference_number || `AJU-${movement.id}`}`);
    doc.text(`Fecha: ${new Date(movement.created_at).toLocaleString('es-ES')}`);
    doc.text(`Usuario: ${movement.user_full_name || movement.user_name || '-'}`);
    line(doc, margin, contentRight);

    doc.font('Helvetica-Bold').fontSize(7).text('PRODUCTO');
    doc.font('Helvetica').fontSize(7).text(movement.product_name || '-');
    if (movement.barcode) doc.text(`Codigo: ${movement.barcode}`);
    doc.moveDown(0.2);
    doc.font('Helvetica-Bold').text('AJUSTE POR FALTANTE');
    doc.font('Helvetica').text(`Stock sistema anterior: ${previousStock}`);
    doc.text(`Cantidad descontada: ${quantity}`);
    doc.text(`Stock final: ${currentStock}`);
    if (movement.notes) {
      doc.moveDown(0.2);
      doc.font('Helvetica-Bold').text('Motivo');
      doc.font('Helvetica').text(movement.notes, { width: contentRight - margin });
    }
    line(doc, margin, contentRight);

    if (settings.show_qr) {
      const qrPayload = JSON.stringify({
        tipo: 'ajuste_inventario',
        comprobante: movement.reference_number || `AJU-${movement.id}`,
        producto: movement.product_name,
        cantidad_descontada: quantity,
        stock_final: currentStock,
        fecha: movement.created_at,
      });
      const qrDataUrl = await QRCode.toDataURL(qrPayload, { margin: 1, width: 140 });
      const qrBuffer = imageBufferFromDataUrl(qrDataUrl);
      if (qrBuffer) {
        const qrSize = 52;
        const qrY = doc.y;
        doc.image(qrBuffer, width / 2 - qrSize / 2, qrY, { fit: [qrSize, qrSize] });
        doc.y = qrY + qrSize + 1;
      }
    }

    doc.font('Helvetica').fontSize(7).text('Documento interno de control de inventario', { align: 'center' });
    doc.end();
  } catch (error) {
    console.error('Error generating inventory adjustment receipt:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

router.get('/inventory-loads/:reference/pdf', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { reference } = req.params;
    const settings = await getSettings();
    const movements: any[] = await new Promise((resolve, reject) => {
      db.all(
        `SELECT im.*, p.name as product_name, p.barcode, u.username as user_name, u.full_name as user_full_name
         FROM inventory_movements im
         INNER JOIN products p ON im.product_id = p.id
         LEFT JOIN users u ON im.user_id = u.id
         WHERE im.reference_number = ? AND im.movement_type = 'entry'
         ORDER BY im.id ASC`,
        [reference],
        (err, rows) => err ? reject(err) : resolve(rows || [])
      );
    });

    if (movements.length === 0) {
      return res.status(404).json({ error: 'Initial load not found' });
    }

    const width = mmToPoints(Number(settings.receipt_width_mm || 80));
    const margin = 14;
    const contentRight = width - margin;
    const hasLogo = Boolean(settings.logo_data_url && settings.show_logo);
    const itemLines = movements.reduce((sum, item) => sum + Math.max(1, Math.ceil(String(item.product_name || '').length / 24)), 0);
    const estimatedHeight = margin * 2 + (hasLogo ? 36 : 20) + 120 + itemLines * 10 + (settings.show_qr ? 58 : 0);

    const doc = new PDFDocument({
      margin,
      size: [width, Math.max(estimatedHeight, 280)],
      bufferPages: false,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="carga-inicial-${reference}.pdf"`);
    doc.pipe(res);

    const logo = imageBufferFromDataUrl(settings.logo_data_url);
    if (hasLogo && logo) {
      try {
        const image = (doc as any).openImage(logo);
        const availableWidth = contentRight - margin;
        const scaledHeight = Math.min(30, availableWidth * (image.height / image.width));
        const scaledWidth = Math.min(availableWidth, scaledHeight * (image.width / image.height));
        doc.image(logo, margin + (availableWidth - scaledWidth) / 2, doc.y, { width: scaledWidth, height: scaledHeight });
        doc.y += scaledHeight + 1;
      } catch {
        doc.y += 2;
      }
    } else {
      doc.font('Helvetica-Bold').fontSize(12).text(settings.business_name || 'FARMACIA', { align: 'center' });
    }

    doc.font('Helvetica').fontSize(7);
    if (settings.tax_id) doc.text(`RUC/NIT: ${settings.tax_id}`, { align: 'center' });
    if (settings.address) doc.text(settings.address, { align: 'center' });
    if (settings.phone) doc.text(`Tel: ${settings.phone}`, { align: 'center' });
    line(doc, margin, contentRight);

    const first = movements[0];
    const totalQuantity = movements.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);

    doc.font('Helvetica-Bold').fontSize(8).text('COMPROBANTE DE CARGA INICIAL', { align: 'center' });
    doc.moveDown(0.2);
    doc.font('Helvetica').fontSize(7);
    doc.text(`Comprobante: ${reference}`);
    doc.text(`Fecha: ${new Date(first.created_at).toLocaleString('es-ES')}`);
    doc.text(`Usuario: ${first.user_full_name || first.user_name || '-'}`);
    doc.text(`Productos: ${movements.length}`);
    doc.text(`Cantidad total: ${totalQuantity}`);
    line(doc, margin, contentRight);

    const qtyW = 30;
    const descX = margin + qtyW;
    const qtyX = margin;
    doc.font('Helvetica-Bold').fontSize(7);
    doc.text('CANT.', qtyX, doc.y, { width: qtyW });
    doc.text('PRODUCTO', descX, doc.y - 8, { width: contentRight - descX });
    line(doc, margin, contentRight);

    movements.forEach((item) => {
      const y = doc.y;
      doc.font('Helvetica').fontSize(7);
      doc.text(String(Number(item.quantity) || 0), qtyX, y, { width: qtyW });
      doc.text(item.product_name || '-', descX, y, { width: contentRight - descX });
      const nameHeight = doc.heightOfString(item.product_name || '-', { width: contentRight - descX });
      doc.y = Math.max(y + nameHeight, y + 9);
    });
    line(doc, margin, contentRight);

    if (settings.show_qr) {
      const qrPayload = JSON.stringify({
        tipo: 'carga_inicial',
        comprobante: reference,
        productos: movements.length,
        cantidad_total: totalQuantity,
        fecha: first.created_at,
      });
      const qrDataUrl = await QRCode.toDataURL(qrPayload, { margin: 1, width: 140 });
      const qrBuffer = imageBufferFromDataUrl(qrDataUrl);
      if (qrBuffer) {
        const qrSize = 52;
        const qrY = doc.y;
        doc.image(qrBuffer, width / 2 - qrSize / 2, qrY, { fit: [qrSize, qrSize] });
        doc.y = qrY + qrSize + 1;
      }
    }

    doc.font('Helvetica').fontSize(7).text('Documento interno de carga de inventario', { align: 'center' });
    doc.end();
  } catch (error) {
    console.error('Error generating inventory load receipt:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

router.get('/:saleId/pdf', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { saleId } = req.params;
    const [settings, sale, items] = await Promise.all([
      getSettings(),
      getSale(saleId),
      getItems(saleId),
    ]);

    if (!sale) {
      return res.status(404).json({ error: 'Sale not found' });
    }

    const width = mmToPoints(Number(settings.receipt_width_mm || 80));
    const margin = 14;
    const contentRight = width - margin;
    const hasLogo = Boolean(settings.logo_data_url && settings.show_logo);
    const companyLineCount = [
      !hasLogo && settings.trade_name,
      settings.tax_id,
      settings.address,
      settings.phone,
      settings.email,
    ].filter(Boolean).length;
    const saleLineCount = 3 + (sale.customer_name ? 1 : 0);
    const itemLineCount = items.reduce((sum, item) => {
      const nameLines = Math.max(1, Math.ceil(String(item.product_name || '').length / 22));
      return sum + nameLines + (item.discount > 0 ? 1 : 0);
    }, 0);
    const totalsLineCount = 2 + (sale.discount > 0 ? 1 : 0) + (sale.tax_amount > 0 ? 1 : 0);
    const paymentLineCount = 1 + (sale.payment_reference ? 1 : 0);
    const footerLineCount = 1 + (settings.website ? 1 : 0);
    const estimatedHeight =
      margin * 2 +
      (hasLogo ? 36 : 20) +
      companyLineCount * 8 +
      8 +
      saleLineCount * 8 +
      8 +
      itemLineCount * 8 +
      8 +
      totalsLineCount * 9 +
      8 +
      paymentLineCount * 8 +
      (settings.show_qr ? 60 : 0) +
      footerLineCount * 8 +
      18;

    const doc = new PDFDocument({
      margin,
      size: [width, Math.max(estimatedHeight, 300)],
      bufferPages: false,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="ticket-${sale.sale_number}.pdf"`);
    doc.pipe(res);

    const logo = imageBufferFromDataUrl(settings.logo_data_url);
    if (hasLogo && logo) {
      try {
        const image = (doc as any).openImage(logo);
        const maxLogoHeight = Number(settings.receipt_width_mm || 80) <= 58 ? 28 : 34;
        const availableWidth = contentRight - margin;
        const scaledHeight = Math.min(maxLogoHeight, availableWidth * (image.height / image.width));
        const scaledWidth = Math.min(availableWidth, scaledHeight * (image.width / image.height));
        const x = margin + (availableWidth - scaledWidth) / 2;
        const logoY = doc.y;
        doc.image(logo, x, logoY, {
          width: scaledWidth,
          height: scaledHeight,
        });
        doc.y = logoY + scaledHeight + 1;
      } catch {
        doc.y += 2;
      }
    }

    if (!hasLogo) {
      doc.font('Helvetica-Bold').fontSize(12).text(settings.business_name || 'FARMACIA', { align: 'center' });
      if (settings.trade_name) doc.font('Helvetica').fontSize(7).text(settings.trade_name, { align: 'center' });
    }
    doc.font('Helvetica').fontSize(7);
    if (settings.tax_id) doc.text(`RUC/NIT: ${settings.tax_id}`, { align: 'center' });
    if (settings.address) doc.text(settings.address, { align: 'center' });
    if (settings.phone) doc.text(`Tel: ${settings.phone}`, { align: 'center' });
    if (settings.email) doc.text(settings.email, { align: 'center' });
    line(doc, margin, contentRight);

    doc.font('Helvetica-Bold').fontSize(8).text(settings.receipt_title || 'COMPROBANTE DE VENTA', { align: 'center' });
    doc.moveDown(0.15);
    doc.font('Helvetica').fontSize(7);
    doc.text(`Ticket: ${sale.sale_number}`);
    doc.text(`Fecha: ${new Date(sale.created_at).toLocaleString('es-ES')}`);
    if (sale.customer_name) doc.text(`Cliente: ${sale.customer_name}`);
    doc.text(`Vendedor: ${sale.user_full_name || sale.user_name}`);
    line(doc, margin, contentRight);

    const qtyW = 24;
    const amountW = 40;
    const unitW = 40;
    const qtyX = margin;
    const amountX = contentRight - amountW;
    const unitX = amountX - unitW - 4;
    const descX = margin + qtyW;
    const descWidth = unitX - descX - 4;

    doc.font('Helvetica-Bold').fontSize(7);
    const headerY = doc.y;
    doc.text('CANT.', qtyX, headerY, { width: qtyW });
    doc.text('PRODUCTO', descX, headerY, { width: descWidth });
    doc.text('P.UNIT', unitX, headerY, { width: unitW, align: 'right' });
    doc.text('IMP.', amountX, headerY, { width: amountW, align: 'right' });
    doc.y = headerY + 9;
    line(doc, margin, contentRight);

    items.forEach((item) => {
      const rowY = doc.y;
      doc.font('Helvetica').fontSize(7);
      doc.text(String(item.quantity), qtyX, rowY, { width: qtyW });
      doc.text(item.product_name, descX, rowY, { width: descWidth });
      doc.text(amount(item.unit_price), unitX, rowY, { width: unitW, align: 'right' });
      doc.font('Helvetica-Bold').text(amount(item.subtotal), amountX, rowY, { width: amountW, align: 'right' });

      const nameHeight = doc.heightOfString(item.product_name, { width: descWidth });
      doc.y = Math.max(rowY + nameHeight, rowY + 9);

      if (item.discount > 0) {
        doc.font('Helvetica').fontSize(6).text(`Desc: ${money(item.discount)}`, descX, doc.y, { width: descWidth });
      }
      doc.moveDown(0.08);
    });
    line(doc, margin, contentRight);

    const totalLabelX = contentRight - 88;
    const totalValueX = contentRight - 44;
    const totalRow = (label: string, value: string, bold = false) => {
      const y = doc.y;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 10 : 7);
      doc.text(label, totalLabelX, y, { width: 42, align: 'right' });
      doc.text(value, totalValueX, y, { width: 44, align: 'right' });
      doc.y = y + (bold ? 12 : 9);
    };

    totalRow('Subtotal:', money(sale.total_amount));
    if (sale.discount > 0) totalRow('Descuento:', `-${money(sale.discount)}`);
    if (sale.tax_amount > 0) totalRow('Impuesto:', money(sale.tax_amount));
    totalRow('TOTAL:', money(sale.final_amount), true);
    line(doc, margin, contentRight);

    doc.font('Helvetica-Bold').fontSize(7).text(`Metodo de pago: ${(sale.payment_method_name || sale.payment_method).toUpperCase()}`, margin, doc.y, { width: contentRight - margin, align: 'center' });
    if (sale.payment_reference) {
      doc.text(`Referencia: ${sale.payment_reference}`, margin, doc.y, { width: contentRight - margin, align: 'center' });
    }

    if (settings.show_qr) {
      doc.moveDown(0.25);
      const qrPayload = JSON.stringify({
        venta: sale.sale_number,
        fecha: sale.created_at,
        total: sale.final_amount,
        metodo: sale.payment_method_name || sale.payment_method,
        referencia: sale.payment_reference || '',
      });
      const qrDataUrl = await QRCode.toDataURL(qrPayload, { margin: 1, width: 140 });
      const qrBuffer = imageBufferFromDataUrl(qrDataUrl);
      if (qrBuffer) {
        const qrSize = 54;
        const qrY = doc.y;
        doc.image(qrBuffer, width / 2 - qrSize / 2, qrY, { fit: [qrSize, qrSize] });
        doc.y = qrY + qrSize + 1;
      }
    }

    doc.font('Helvetica').fontSize(7).text(settings.receipt_footer || 'Gracias por su compra', { align: 'center' });
    if (settings.website) doc.text(settings.website, { align: 'center' });

    doc.end();
  } catch (error) {
    console.error('Error generating receipt:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

export default router;

