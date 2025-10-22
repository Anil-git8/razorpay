// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Razorpay = require('razorpay');

const app = express();
app.use(express.json());
app.use(cors());

// ✅ 1. Initialize Razorpay client once (global scope)
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ✅ 2. Warm-up function: keeps Render instance awake (optional)
if (process.env.NODE_ENV === 'production') {
  setInterval(() => {
    fetch('https://razorpay-cy4m.onrender.com/health').catch(() => {});
  }, 300000); // every 5 min
}

// ✅ Health route for Render warm-up
app.get('/health', (_, res) => res.status(200).send('OK'));

// ✅ 3. Fast Razorpay order creation endpoint
app.post('/create-order', async (req, res) => {
  try {
    const { amount, currency = 'INR', receipt } = req.body;

    if (!amount || isNaN(amount)) {
      return res.status(400).json({ success: false, error: 'Invalid amount' });
    }

    // Keep object minimal for speed
    const options = {
      amount: Math.round(amount * 100), // paise
      currency,
      receipt: receipt || `receipt_${Date.now()}`,
    };

    // ⚡ Create order directly (Razorpay SDK handles validation)
    const order = await razorpay.orders.create(options);

    res.json({
      success: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      receipt: order.receipt,
    });
  } catch (err) {
    console.error('❌ Error creating Razorpay order:', err);
    res.status(500).json({ success: false, error: err.message || 'Server error' });
  }
});

// ✅ 4. Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Razorpay backend running on port ${PORT}`);
});
