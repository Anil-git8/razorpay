// server.js
require('dotenv').config(); // ✅ Load variables from .env
const express = require('express');
const cors = require('cors');
const Razorpay = require('razorpay');

const app = express();
app.use(express.json());
app.use(cors());

// ✅ Access from environment
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

app.post("/create-order", async (req, res) => {
  try {
    const { amount, currency = "INR", receipt } = req.body;

    const options = {
      amount: amount * 100, // amount in paise
      currency,
      receipt: receipt || `receipt_${Date.now()}`,
    };

    const order = await razorpay.orders.create(options);

    res.status(200).json({
      success: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      receipt: order.receipt,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ Use PORT from .env
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Razorpay backend running on port ${PORT}`));
