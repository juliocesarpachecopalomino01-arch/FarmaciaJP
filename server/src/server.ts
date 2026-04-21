import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import os from 'os';
import { initializeDatabase } from './database/init';
import authRoutes from './routes/auth';
import productRoutes from './routes/products';
import categoryRoutes from './routes/categories';
import inventoryRoutes from './routes/inventory';
import saleRoutes from './routes/sales';
import customerRoutes from './routes/customers';
import userRoutes from './routes/users';
import reportRoutes from './routes/reports';
import priceHistoryRoutes from './routes/price-history';
import receiptRoutes from './routes/receipts';
import expirationAlertRoutes from './routes/expiration-alerts';
import auditRoutes from './routes/audit';
import exportRoutes from './routes/export';
import draftSalesRoutes from './routes/draft-sales';
import returnsRoutes from './routes/returns';
import suppliersRoutes from './routes/suppliers';
import purchasesRoutes from './routes/purchases';
import lotsRoutes from './routes/lots';
import dashboardRoutes from './routes/dashboard';
import cashRegisterRoutes from './routes/cash-registers';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3001);

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/sales', saleRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/users', userRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/price-history', priceHistoryRoutes);
app.use('/api/receipts', receiptRoutes);
app.use('/api/alerts', expirationAlertRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/draft-sales', draftSalesRoutes);
app.use('/api/returns', returnsRoutes);
app.use('/api/suppliers', suppliersRoutes);
app.use('/api/purchases', purchasesRoutes);
app.use('/api/lots', lotsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/cash-registers', cashRegisterRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Farmacia API is running' });
});

// Helper function to get local IP addresses
function getLocalIPs(): string[] {
  const interfaces = os.networkInterfaces();
  const ips: string[] = [];
  
  for (const name of Object.keys(interfaces)) {
    const nets = interfaces[name];
    if (!nets) continue;
    
    for (const net of nets) {
      // Skip internal (loopback) and non-IPv4 addresses
      if (net.family === 'IPv4' && !net.internal) {
        ips.push(net.address);
      }
    }
  }
  
  return ips;
}

// Initialize database and start server
initializeDatabase()
  .then(() => {
    const HOST = process.env.HOST || '0.0.0.0';
    app.listen(PORT, HOST, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
      
      if (HOST === '0.0.0.0') {
        const localIPs = getLocalIPs();
        console.log(`\n🌐 Acceso desde la red local (LAN):`);
        if (localIPs.length > 0) {
          localIPs.forEach((ip) => {
            console.log(`   • Frontend: http://${ip}:3000`);
            console.log(`   • Backend API: http://${ip}:${PORT}`);
          });
        } else {
          console.log(`   • Ejecuta 'ipconfig' (Windows) para ver tu IP local`);
          console.log(`   • Luego accede desde otros equipos: http://<TU_IP>:3000`);
        }
        console.log(``);
      }
    });
  })
  .catch((error) => {
    console.error('Failed to initialize database:', error);
    process.exit(1);
  });
