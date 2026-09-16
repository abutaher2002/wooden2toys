const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;

// Setup SQLite database
const dbPath = path.join(__dirname, 'data.db');
const db = new Database(dbPath);

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    customerName TEXT,
    phoneNumber TEXT,
    address TEXT,
    quantity INTEGER,
    productPrice REAL,
    deliveryCharge REAL,
    totalAmount REAL,
    productName TEXT,
    orderDate TEXT,
    source TEXT,
    createdAt TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Insert default price settings if not exists
const existingPrice = db.prepare("SELECT value FROM settings WHERE key = 'price'").get();
if (!existingPrice) {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run('price', '999');
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run('originalPrice', '1200');
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run('deliveryCharge', '100');
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run('productName', '৪৮ পিসের ১ সেট + ফ্রি ঢেঁকি');
  console.log('Default price settings inserted');
}

// Helper: get all settings
function getPriceSettings() {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  const settings = {};
  rows.forEach(row => { settings[row.key] = row.value; });
  return {
    price: Number(settings.price) || 999,
    originalPrice: Number(settings.originalPrice) || 1200,
    deliveryCharge: Number(settings.deliveryCharge) || 100,
    productName: settings.productName || '৪৮ পিসের ১ সেট + ফ্রি ঢেঁকি'
  };
}

// Configure multer for file upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'hero-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: function (req, file, cb) {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed!'), false);
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── Price API ──────────────────────────────────────────
app.get('/api/price', (req, res) => {
  res.json({ success: true, ...getPriceSettings() });
});

app.post('/api/price', (req, res) => {
  try {
    const { price, originalPrice, deliveryCharge, productName } = req.body;
    const upsert = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    if (price)         upsert.run('price', String(price));
    if (originalPrice) upsert.run('originalPrice', String(originalPrice));
    if (deliveryCharge)upsert.run('deliveryCharge', String(deliveryCharge));
    if (productName)   upsert.run('productName', productName);
    console.log('Price updated:', getPriceSettings());
    res.json({ success: true, message: 'Price updated successfully', ...getPriceSettings() });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Failed to update price' });
  }
});

// ── Orders API ─────────────────────────────────────────
app.post('/api/orders', (req, res) => {
  try {
    const order = {
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
      createdAt: new Date().toISOString()
    };

    db.prepare(`
      INSERT INTO orders (id, customerName, phoneNumber, address, quantity, productPrice, deliveryCharge, totalAmount, productName, orderDate, source, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(order.id, order.customerName, order.phoneNumber, order.address, order.quantity, order.productPrice, order.deliveryCharge, order.totalAmount, order.productName, order.orderDate, order.source, order.createdAt);

    console.log('New order saved:', order.id);
    res.status(201).json({ success: true, order });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Failed to create order' });
  }
});

app.get('/api/orders', (req, res) => {
  const orders = db.prepare("SELECT * FROM orders ORDER BY createdAt DESC").all();
  res.json({ success: true, orders });
});

app.delete('/api/orders/:id', (req, res) => {
  const result = db.prepare("DELETE FROM orders WHERE id = ?").run(req.params.id);
  if (result.changes > 0) {
    res.json({ success: true, message: 'Order deleted' });
  } else {
    res.status(404).json({ success: false, message: 'Order not found' });
  }
});

// ── Image Upload API ───────────────────────────────────
app.post('/api/upload-image', upload.single('image'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No image file uploaded' });
    const imageUrl = `/uploads/${req.file.filename}`;
    console.log('Image uploaded:', req.file.filename);
    res.json({ success: true, message: 'Image uploaded successfully', imageUrl, filename: req.file.filename });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Failed to upload image' });
  }
});

app.get('/api/images', (req, res) => {
  try {
    const uploadsDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadsDir)) return res.json({ success: true, images: [] });
    const files = fs.readdirSync(uploadsDir)
      .filter(file => /\.(jpg|jpeg|png|gif|webp)$/i.test(file))
      .map(file => ({
        filename: file,
        url: `/uploads/${file}`,
        uploadDate: fs.statSync(path.join(uploadsDir, file)).mtime
      }))
      .sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate));
    res.json({ success: true, images: files });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to get images' });
  }
});

// ── Admin Panel ────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
  console.log(`Database: ${dbPath}`);
});

module.exports = app;
