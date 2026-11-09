const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

// 1. Import Cloudinary Packages
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

app.use(express.static(__dirname));

// 2. Configure Cloudinary Credentials
// (Sign up free at https://cloudinary.com to get these 3 keys from your dashboard)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'YOUR_CLOUD_NAME',
  api_key: process.env.CLOUDINARY_API_KEY || 'YOUR_API_KEY',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'YOUR_API_SECRET'
});

// 3. Configure Multer to upload directly to Cloudinary instead of local folder
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'akistel_household_products',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp']
  }
});
const upload = multer({ storage: storage });

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

const DATA_FILE = path.join(__dirname, 'data.json');

function readDB() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    }
  } catch (err) {
    console.log('Error reading DB:', err);
  }
  return { products: [], orders: [], consultations: [] };
}

function writeDB(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

app.get('/api/products', (req, res) => {
  const db = readDB();
  res.json({ success: true, count: db.products.length, data: db.products });
});

// ADD NEW PRODUCT API WITH CLOUDINARY MULTI-IMAGE UPLOAD
app.post('/api/products', upload.array('imageFiles', 5), (req, res) => {
  const { name, category, price } = req.body;
  if (!name || !category || price === undefined) {
    return res.status(400).json({ success: false, message: 'Please provide all required fields' });
  }

  // Cloudinary returns full secure HTTPS image URLs in file.path
  let images = [];
  if (req.files && req.files.length > 0) {
    images = req.files.map(file => file.path);
  }

  const db = readDB();
  const newProduct = {
    id: 'prod-' + Date.now(),
    name,
    category,
    price: Number(price),
    inStock: true,
    img: images[0] || '', // Primary Cloudinary HTTPS URL
    images: images       // Array of all uploaded Cloudinary HTTPS URLs
  };

  db.products.push(newProduct);
  writeDB(db);
  res.status(201).json({ success: true, message: 'Product added successfully', product: newProduct });
});

// UPDATE PRODUCT API WITH CLOUDINARY MULTI-IMAGE UPLOAD
app.put('/api/products/:id', upload.array('imageFiles', 5), (req, res) => {
  const { id } = req.params;
  const { price, name } = req.body;
  const db = readDB();
  const productIndex = db.products.findIndex(p => p.id === id);

  if (productIndex === -1) {
    return res.status(404).json({ success: false, message: 'Product not found' });
  }

  if (price !== undefined) db.products[productIndex].price = Number(price);
  if (name !== undefined) db.products[productIndex].name = name;

  if (req.files && req.files.length > 0) {
    const newImages = req.files.map(file => file.path);
    db.products[productIndex].images = newImages;
    db.products[productIndex].img = newImages[0];
  }

  writeDB(db);
  res.json({ success: true, message: 'Product updated successfully', product: db.products[productIndex] });
});

// DELETE PRODUCT API
app.delete('/api/products/:id', (req, res) => {
  const { id } = req.params;
  const db = readDB();
  const productIndex = db.products.findIndex(p => p.id === id);

  if (productIndex === -1) {
    return res.status(404).json({ success: false, message: 'Product not found' });
  }

  db.products.splice(productIndex, 1);
  writeDB(db);
  res.json({ success: true, message: 'Product deleted successfully' });
});

app.get('/api/admin/data', (req, res) => {
  const db = readDB();
  res.json({
    success: true,
    products: db.products || [],
    orders: db.orders || [],
    consultations: db.consultations || [],
    totalRevenue: (db.orders || []).reduce((sum, o) => sum + (o.totalAmount || 0), 0)
  });
});

app.post('/api/orders', (req, res) => {
  const { customerName, address, notes, items, totalAmount } = req.body;
  if (!customerName || !address || !items || items.length === 0) {
    return res.status(400).json({ success: false, message: 'Missing order details' });
  }

  const db = readDB();
  const newOrder = {
    id: 'ORD-' + Math.floor(100000 + Math.random() * 900000),
    customerName,
    address,
    notes: notes || '',
    items,
    totalAmount,
    status: 'Pending WhatsApp Confirmation',
    createdAt: new Date().toISOString()
  };

  db.orders.push(newOrder);
  writeDB(db);

  let whatsappMsg = `*NEW ORDER #${newOrder.id} - AKISTEL HOUSEHOLD STORE*\n`;
  whatsappMsg += `-----------------------------------\n`;
  whatsappMsg += `*Customer:* ${customerName}\n*Address:* ${address}\n`;
  items.forEach((item, i) => {
    whatsappMsg += `${i + 1}. ${item.name} (x${item.qty}) - ₦${(item.price * item.qty).toLocaleString()}\n`;
  });
  whatsappMsg += `-----------------------------------\n*TOTAL:* ₦${totalAmount.toLocaleString()}\n`;

  const waUrl = `https://wa.me/2348125847101?text=${encodeURIComponent(whatsappMsg)}`;
  res.status(201).json({ success: true, orderId: newOrder.id, whatsappUrl: waUrl });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`🔑 Admin Portal: http://localhost:${PORT}/admin`);
});
