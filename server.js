const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_PRIVATE_URL || process.env.DATABASE_URL,
  ssl: process.env.DATABASE_PRIVATE_URL ? false : { rejectUnauthorized: false }
});

// Create tables
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      "customerName" TEXT,
      "phoneNumber" TEXT,
      address TEXT,
      quantity INTEGER,
      "productPrice" REAL,
      "deliveryCharge" REAL,
      "totalAmount" REAL,
      "productName" TEXT,
      "orderDate" TEXT,
      source TEXT,
      status TEXT DEFAULT 'Pending',
      "createdAt" TEXT
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // Insert default price settings if not exists
  await pool.query(`
    INSERT INTO settings (key, value) VALUES
      ('price', '999'),
      ('originalPrice', '1200'),
      ('deliveryCharge', '100'),
      ('productName', '৪৮ পিসের ১ সেট + ফ্রি ঢেঁকি')
    ON CONFLICT (key) DO NOTHING;
  `);

  console.log('Database initialized');
}

// Helper: get price settings
async function getPriceSettings() {
  const result = await pool.query("SELECT key, value FROM settings");
  const s = {};
  result.rows.forEach(r => { s[r.key] = r.value; });
  return {
    price: Number(s.price) || 999,
    originalPrice: Number(s.originalPrice) || 1200,
    deliveryCharge: Number(s.deliveryCharge) || 100,
    productName: s.productName || '৪৮ পিসের ১ সেট + ফ্রি ঢেঁকি'
  };
}

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, 'hero-' + Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname));
  }
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) cb(null, true);
  else cb(new Error('Only images allowed'), false);
}});

// Middleware
app.use(cors({ origin: '*', methods: ['GET','POST','DELETE','PATCH','OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── Price API ──────────────────────────
app.get('/api/price', async (req, res) => {
  try { res.json({ success: true, ...(await getPriceSettings()) }); }
  catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/price', async (req, res) => {
  try {
    const { price, originalPrice, deliveryCharge, productName } = req.body;
    const upsert = `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2`;
    if (price) await pool.query(upsert, ['price', String(price)]);
    if (originalPrice) await pool.query(upsert, ['originalPrice', String(originalPrice)]);
    if (deliveryCharge) await pool.query(upsert, ['deliveryCharge', String(deliveryCharge)]);
    if (productName) await pool.query(upsert, ['productName', productName]);
    res.json({ success: true, message: 'Price updated', ...(await getPriceSettings()) });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// ── Orders API ─────────────────────────
app.post('/api/orders', async (req, res) => {
  try {
    const o = {
      id: Date.now().toString(),
      customerName: req.body.customerName || '',
      phoneNumber: req.body.phoneNumber || '',
      address: req.body.address || '',
      quantity: req.body.quantity || 1,
      productPrice: req.body.productPrice || 0,
      deliveryCharge: req.body.deliveryCharge || 100,
      totalAmount: req.body.totalAmount || 0,
      productName: req.body.productName || '',
      orderDate: req.body.orderDate || new Date().toISOString(),
      source: req.body.source || '',
      status: 'Pending',
      createdAt: new Date().toISOString()
    };
    await pool.query(
      `INSERT INTO orders (id,"customerName","phoneNumber",address,quantity,"productPrice","deliveryCharge","totalAmount","productName","orderDate",source,status,"createdAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [o.id,o.customerName,o.phoneNumber,o.address,o.quantity,o.productPrice,o.deliveryCharge,o.totalAmount,o.productName,o.orderDate,o.source,o.status,o.createdAt]
    );
    console.log('Order saved:', o.id);
    res.status(201).json({ success: true, order: o });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/orders', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM orders ORDER BY "createdAt" DESC');
    res.json({ success: true, orders: result.rows });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

app.delete('/api/orders/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM orders WHERE id = $1', [req.params.id]);
    if (result.rowCount > 0) res.json({ success: true });
    else res.status(404).json({ success: false, message: 'Not found' });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

app.patch('/api/orders/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const valid = ['Pending','Confirmed','Retry','Delivered','Cancelled'];
    if (!valid.includes(status)) return res.status(400).json({ success: false, message: 'Invalid status' });
    await pool.query('UPDATE orders SET status = $1 WHERE id = $2', [status, req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// ── Image API ──────────────────────────
app.post('/api/upload-image', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'No file' });
  res.json({ success: true, imageUrl: `/uploads/${req.file.filename}`, filename: req.file.filename });
});

app.get('/api/images', (req, res) => {
  try {
    const dir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(dir)) return res.json({ success: true, images: [] });
    const files = fs.readdirSync(dir)
      .filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f))
      .map(f => ({ filename: f, url: `/uploads/${f}`, uploadDate: fs.statSync(path.join(dir,f)).mtime }))
      .sort((a,b) => new Date(b.uploadDate) - new Date(a.uploadDate));
    res.json({ success: true, images: files });
  } catch(e) { res.status(500).json({ success: false }); }
});

// Admin panel
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// Start
initDB().then(() => {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}).catch(e => {
  console.error('DB init failed:', e.message);
  app.listen(PORT, () => console.log(`Server running (no DB) on port ${PORT}`));
});

module.exports = app;
