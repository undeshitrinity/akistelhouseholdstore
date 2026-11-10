const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

app.use(express.static(__dirname));

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'YOUR_CLOUD_NAME',
  api_key: process.env.CLOUDINARY_API_KEY || 'YOUR_API_KEY',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'YOUR_API_SECRET'
});

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
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      if (!data.inStoreOrders) data.inStoreOrders = [];
      return data;
    }
  } catch (err) {
    console.log('Error reading DB:', err);
  }
  return { products: [], orders: [], inStoreOrders: [], consultations: [] };
}

function writeDB(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// Products API
app.get('/api/products', (req, res) => {
  const db = readDB();
  res.json({ success: true, count: db.products.length, data: db.products });
});

app.post('/api/products', upload.array('imageFiles', 5), (req, res) => {
  const { name, category, price, stock } = req.body;
  if (!name || !category || price === undefined) {
    return res.status(400).json({ success: false, message: 'Please provide all required fields' });
  }

  let images = [];
  if (req.files && req.files.length > 0) {
    images = req.files.map(file => file.path);
  }

  const db = readDB();
  const parsedStock = Number(stock) || 10;
  const newProduct = {
    id: 'prod-' + Date.now(),
    name,
    category,
    price: Number(price),
    stock: parsedStock,
    inStock: parsedStock > 0,
    img: images[0] || '',
    images: images
  };

  db.products.push(newProduct);
  writeDB(db);
  res.status(201).json({ success: true, message: 'Product added successfully', product: newProduct });
});

// FIXED PUT PRODUCT API TO PROPERLY HANDLE ADDING/UPDATING IMAGES
app.put('/api/products/:id', upload.array('imageFiles', 5), (req, res) => {
  const { id } = req.params;
  const { price, name, stock } = req.body;
  const db = readDB();
  const productIndex = db.products.findIndex(p => p.id === id);

  if (productIndex === -1) {
    return res.status(404).json({ success: false, message: 'Product not found' });
  }

  if (price !== undefined) db.products[productIndex].price = Number(price);
  if (name !== undefined) db.products[productIndex].name = name;
  if (stock !== undefined) {
    db.products[productIndex].stock = Number(stock);
    db.products[productIndex].inStock = Number(stock) > 0;
  }

  if (req.files && req.files.length > 0) {
    const newImages = req.files.map(file => file.path);
    let existingImages = db.products[productIndex].images || (db.products[productIndex].img ? [db.products[productIndex].img] : []);
    db.products[productIndex].images = existingImages.concat(newImages);
    db.products[productIndex].img = db.products[productIndex].images[0];
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

// REMOVE SINGLE PRODUCT IMAGE API
app.delete('/api/products/:id/image', (req, res) => {
  const { id } = req.params;
  const { imageIndex } = req.body;
  const db = readDB();
  const product = db.products.find(p => p.id === id);

  if (!product) {
    return res.status(404).json({ success: false, message: 'Product not found' });
  }

  let images = product.images && product.images.length > 0 ? product.images : (product.img ? [product.img] : []);
  
  if (imageIndex >= 0 && imageIndex < images.length) {
    images.splice(imageIndex, 1);
    product.images = images;
    product.img = images.length > 0 ? images[0] : '';
    writeDB(db);
    return res.json({ success: true, message: 'Image removed successfully', product });
  }

  res.status(400).json({ success: false, message: 'Invalid image index' });
});

// Admin Data API (Total sales only counts completed/paid online orders & paid walk-in orders)
app.get('/api/admin/data', (req, res) => {
  const db = readDB();

  const completedOnlineSales = (db.orders || [])
    .filter(o => o.status === 'Completed' || o.status === 'Payment Confirmed / Paid')
    .reduce((sum, o) => sum + (o.totalAmount || 0), 0);

  const paidWalkInSales = (db.inStoreOrders || [])
    .filter(o => o.status === 'Paid')
    .reduce((sum, o) => sum + (o.totalAmount || 0), 0);

  const totalRevenue = completedOnlineSales + paidWalkInSales;

  res.json({
    success: true,
    products: db.products || [],
    orders: db.orders || [],
    inStoreOrders: db.inStoreOrders || [],
    consultations: db.consultations || [],
    totalRevenue: totalRevenue
  });
});

// Online Checkout & Order API (Saves order WITHOUT reducing stock immediately)
app.post('/api/orders', (req, res) => {
  const { customerName, phone, whatsapp, address, city, state, notes, items, totalAmount } = req.body;
  if (!customerName || !phone || !address || !items || items.length === 0) {
    return res.status(400).json({ success: false, message: 'Missing required delivery details or items.' });
  }

  const db = readDB();

  // Verify stock availability exists
  for (const item of items) {
    const product = db.products.find(p => p.id === item.id);
    if (!product || product.stock < item.qty) {
      return res.status(400).json({ success: false, message: `Sorry, "${item.name}" has insufficient stock available.` });
    }
  }

  const orderId = 'ORD-' + Math.floor(100000 + Math.random() * 900000);
  const newOrder = {
    id: orderId,
    customerName,
    phone,
    whatsapp: whatsapp || phone,
    address,
    city: city || '',
    state: state || '',
    notes: notes || '',
    items,
    totalAmount,
    status: 'Pending Verification',
    paymentMethod: 'Opay Transfer (Stella Inyanguku)',
    createdAt: new Date().toISOString()
  };

  db.orders.push(newOrder);
  writeDB(db);

  let whatsappMsg = `*PAYMENT RECEIPT & ORDER #${newOrder.id} - AKISTEL HOUSEHOLD STORE*\n`;
  whatsappMsg += `-----------------------------------\n`;
  whatsappMsg += `*Customer Name:* ${customerName}\n`;
  whatsappMsg += `*Phone Number:* ${phone}\n`;
  whatsappMsg += `*Delivery Address:* ${address}, ${city}, ${state}\n`;
  whatsappMsg += `-----------------------------------\n`;
  whatsappMsg += `*Products Ordered:*\n`;
  items.forEach((item, i) => {
    whatsappMsg += `${i + 1}. ${item.name} (x${item.qty}) - ₦${(item.price * item.qty).toLocaleString()}\n`;
  });
  whatsappMsg += `-----------------------------------\n`;
  whatsappMsg += `*Total Amount Paid:* ₦${totalAmount.toLocaleString()}\n`;
  whatsappMsg += `*Payment Details:* Opay | 6113202648 | Stella Inyanguku\n\n`;
  whatsappMsg += `📸 [Please attach your payment receipt screenshot here before sending!]`;

  const waUrl = `https://wa.me/2348125847101?text=${encodeURIComponent(whatsappMsg)}`;
  res.status(201).json({ success: true, orderId: newOrder.id, whatsappUrl: waUrl, product: newOrder });
});

// Update Order Status API & Deduct Stock Upon Admin Confirmation
app.put('/api/orders/:id/status', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const db = readDB();
  const order = db.orders.find(o => o.id === id);

  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

  const isNowConfirmed = (status === 'Payment Confirmed / Paid' || status === 'Completed');
  const wasPreviouslyConfirmed = (order.status === 'Payment Confirmed / Paid' || order.status === 'Completed');

  // Deduct stock only when admin changes status to paid/completed for the first time
  if (isNowConfirmed && !wasPreviouslyConfirmed) {
    for (const item of order.items) {
      const product = db.products.find(p => p.id === item.id);
      if (product) {
        product.stock = Math.max(0, product.stock - item.qty);
        product.inStock = product.stock > 0;
      }
    }
  }

  order.status = status;
  writeDB(db);
  res.json({ success: true, order });
});

// In-Store Walk-In Orders API (Connected to inventory)
app.post('/api/in-store-orders', (req, res) => {
  const { customerName, phone, address, items, discount, totalAmount, paymentMethod, notes, status } = req.body;
  if (!customerName || !items || items.length === 0) {
    return res.status(400).json({ success: false, message: 'Missing walk-in order details.' });
  }

  const db = readDB();

  // Verify and reduce stock for physical store sales
  for (const item of items) {
    const product = db.products.find(p => p.id === item.id);
    if (!product || product.stock < item.qty) {
      return res.status(400).json({ success: false, message: `Insufficient stock for ${item.name}` });
    }
  }

  for (const item of items) {
    const product = db.products.find(p => p.id === item.id);
    product.stock -= item.qty;
    product.inStock = product.stock > 0;
  }

  const walkInOrder = {
    id: 'WALK-' + Math.floor(100000 + Math.random() * 900000),
    customerName,
    phone: phone || 'Walk-in',
    address: address || 'In-store purchase',
    items,
    discount: Number(discount) || 0,
    totalAmount: Number(totalAmount),
    paymentMethod: paymentMethod || 'Cash',
    status: status || 'Paid',
    notes: notes || '',
    createdAt: new Date().toISOString()
  };

  db.inStoreOrders.push(walkInOrder);
  writeDB(db);
  res.status(201).json({ success: true, order: walkInOrder });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`🔑 Admin Portal: http://localhost:${PORT}/admin`);
});
