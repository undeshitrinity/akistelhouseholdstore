const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const multer = require('multer');
const mongoose = require('mongoose');

const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

app.use(express.static(__dirname));

// Connect to MongoDB Atlas
const MONGO_URI = process.env.MONGO_URI;
mongoose.connect(MONGO_URI)
  .then(() => console.log('📦 Connected to MongoDB Atlas successfully'))
  .catch(err => console.error('MongoDB connection error:', err));

// Mongoose Schemas & Models
const productSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  category: { type: String, required: true },
  price: { type: Number, required: true },
  stock: { type: Number, default: 10 },
  inStock: { type: Boolean, default: true },
  img: String,
  images: [String]
});

const orderSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  customerName: String,
  phone: String,
  whatsapp: String,
  address: String,
  city: String,
  state: String,
  notes: String,
  items: Array,
  totalAmount: Number,
  status: String,
  paymentMethod: String,
  createdAt: { type: String, default: () => new Date().toISOString() }
});

const Product = mongoose.model('Product', productSchema);
const Order = mongoose.model('Order', orderSchema);
const InStoreOrder = mongoose.model('InStoreOrder', orderSchema);

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

// Products API
app.get('/api/products', async (req, res) => {
  try {
    const products = await Product.find({});
    res.json({ success: true, count: products.length, data: products });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/products', (req, res) => {
  upload.array('imageFiles', 5)(req, res, async function (err) {
    if (err) {
      return res.status(400).json({ success: false, message: 'Image upload failed: ' + err.message });
    }

    try {
      const { name, category, price, stock } = req.body;
      if (!name || !category || price === undefined) {
        return res.status(400).json({ success: false, message: 'Please provide all required fields' });
      }

      let images = [];
      if (req.files && req.files.length > 0) {
        images = req.files.map(file => file.path);
      }

      const parsedStock = Number(stock) || 10;
      const newProduct = new Product({
        id: 'prod-' + Date.now(),
        name,
        category,
        price: Number(price),
        stock: parsedStock,
        inStock: parsedStock > 0,
        img: images[0] || '',
        images: images
      });

      await newProduct.save();
      res.status(201).json({ success: true, message: 'Product added successfully', product: newProduct });
    } catch (serverErr) {
      res.status(500).json({ success: false, message: 'Internal server error: ' + serverErr.message });
    }
  });
});

app.put('/api/products/:id', (req, res) => {
  upload.array('imageFiles', 5)(req, res, async function (err) {
    if (err) {
      return res.status(400).json({ success: false, message: 'Image upload failed: ' + err.message });
    }

    try {
      const { id } = req.params;
      const { price, name, stock } = req.body;
      const product = await Product.findOne({ id });

      if (!product) {
        return res.status(404).json({ success: false, message: 'Product not found' });
      }

      if (price !== undefined) product.price = Number(price);
      if (name !== undefined) product.name = name;
      if (stock !== undefined) {
        product.stock = Number(stock);
        product.inStock = Number(stock) > 0;
      }

      if (req.files && req.files.length > 0) {
        const newImages = req.files.map(file => file.path);
        let existingImages = product.images && product.images.length > 0 ? product.images : (product.img ? [product.img] : []);
        product.images = existingImages.concat(newImages);
        product.img = product.images[0];
      }

      await product.save();
      res.json({ success: true, message: 'Product updated successfully', product });
    } catch (serverErr) {
      res.status(500).json({ success: false, message: 'Internal server error: ' + serverErr.message });
    }
  });
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await Product.findOneAndDelete({ id });
    if (!deleted) return res.status(404).json({ success: false, message: 'Product not found' });
    res.json({ success: true, message: 'Product deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.delete('/api/products/:id/image', async (req, res) => {
  try {
    const { id } = req.params;
    const { imageIndex } = req.body;
    const product = await Product.findOne({ id });

    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    let images = product.images && product.images.length > 0 ? product.images : (product.img ? [product.img] : []);
    
    if (imageIndex >= 0 && imageIndex < images.length) {
      images.splice(imageIndex, 1);
      product.images = images;
      product.img = images.length > 0 ? images[0] : '';
      await product.save();
      return res.json({ success: true, message: 'Image removed successfully', product });
    }

    res.status(400).json({ success: false, message: 'Invalid image index' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Admin Data API
app.get('/api/admin/data', async (req, res) => {
  try {
    const products = await Product.find({});
    const orders = await Order.find({});
    const inStoreOrders = await InStoreOrder.find({});

    const completedOnlineSales = orders
      .filter(o => o.status === 'Completed' || o.status === 'Payment Confirmed / Paid')
      .reduce((sum, o) => sum + (o.totalAmount || 0), 0);

    const paidWalkInSales = inStoreOrders
      .filter(o => o.status === 'Paid')
      .reduce((sum, o) => sum + (o.totalAmount || 0), 0);

    const totalRevenue = completedOnlineSales + paidWalkInSales;

    res.json({
      success: true,
      products,
      orders,
      inStoreOrders,
      consultations: [],
      totalRevenue
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Orders API
app.post('/api/orders', async (req, res) => {
  try {
    const { customerName, phone, whatsapp, address, city, state, notes, items, totalAmount } = req.body;
    if (!customerName || !phone || !address || !items || items.length === 0) {
      return res.status(400).json({ success: false, message: 'Missing required delivery details or iitems.' });
    }

    for (const item of items) {
      const product = await Product.findOne({ id: item.id });
      if (!product || product.stock < item.qty) {
        return res.status(400).json({ success: false, message: `Sorry, "${item.name}" has insufficient stock available.` });
      }
    }

    const orderId = 'ORD-' + Math.floor(100000 + Math.random() * 900000);
    const newOrder = new Order({
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
      paymentMethod: 'Opay Transfer (Stella Inyanguku)'
    });

    await newOrder.save();

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
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.put('/api/orders/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const order = await Order.findOne({ id });

    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const isNowConfirmed = (status === 'Payment Confirmed / Paid' || status === 'Completed');
    const wasPreviouslyConfirmed = (order.status === 'Payment Confirmed / Paid' || order.status === 'Completed');

    if (isNowConfirmed && !wasPreviouslyConfirmed) {
      for (const item of order.items) {
        const product = await Product.findOne({ id: item.id });
        if (product) {
          product.stock = Math.max(0, product.stock - item.qty);
          product.inStock = product.stock > 0;
          await product.save();
        }
      }
    }

    order.status = status;
    await order.save();
    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// In-Store Walk-In Orders API
app.post('/api/in-store-orders', async (req, res) => {
  try {
    const { customerName, phone, address, items, discount, totalAmount, paymentMethod, notes, status } = req.body;
    if (!customerName || !items || items.length === 0) {
      return res.status(400).json({ success: false, message: 'Missing walk-in order details.' });
    }

    for (const item of items) {
      const product = await Product.findOne({ id: item.id });
      if (!product || product.stock < item.qty) {
        return res.status(400).json({ success: false, message: `Insufficient stock for ${item.name}` });
      }
    }

    for (const item of items) {
      const product = await Product.findOne({ id: item.id });
      product.stock -= item.qty;
      product.inStock = product.stock > 0;
      await product.save();
    }

    const walkInOrder = new InStoreOrder({
      id: 'WALK-' + Math.floor(100000 + Math.random() * 900000),
      customerName,
      phone: phone || 'Walk-in',
      address: address || 'In-store purchase',
      items,
      discount: Number(discount) || 0,
      totalAmount: Number(totalAmount),
      paymentMethod: paymentMethod || 'Cash',
      status: status || 'Paid',
      notes: notes || ''
    });

    await walkInOrder.save();
    res.status(201).json({ success: true, order: walkInOrder });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`🔑 Admin Portal: http://localhost:${PORT}/admin`);
});
