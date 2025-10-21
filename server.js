// server.js
const express = require('express');
const cors = require('cors');
const Razorpay = require('razorpay');

const app = express();
app.use(express.json());
app.use(cors());

// ✅ Replace with your Razorpay credentials
const razorpay = new Razorpay({
  key_id: "rzp_live_RW6EGUwOH81Aul",  // or test key
  key_secret: "VuI5bdfHGZEN0Cf1v3R0A1q3",      // keep this secret
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

app.listen(3000, () => console.log("✅ Razorpay backend running on port 3000"));
