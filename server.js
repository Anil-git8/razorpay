

global.startTime = Date.now();

const express = require("express");
const cors = require("cors");
const Razorpay = require("razorpay");

const app = express();
require('dotenv').config();
app.use(cors());
app.use(express.json());

// -----------------------------
// Razorpay Config (SAFE)
// -----------------------------
const razorpay = new Razorpay({
  key_id: 'rzp_live_RW6EGUwOH81Aul',
  key_secret: 'VuI5bdfHGZEN0Cf1v3R0A1q3',
});

// -----------------------------
// ROUTES
// -----------------------------

app.get("/", (req, res) => {
  res.json({
    message: "Razorpay API Server",
    endpoints: ["/create-order", "/health"],
  });
});

app.get("/health", (req, res) => {
  res.json({ ok: true, time: Date.now() });
});

// ✅ Create Order (same as your working code)
app.post("/create-order", async (req, res) => {
  const start = Date.now();

  try {
    const { amount, currency = "INR" } = req.body;

    if (!amount || amount < 1) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100),
      currency: currency.toUpperCase(),
      receipt: `r${Date.now()}`,
    });

    console.log(`✅ Order created in ${Date.now() - start}ms`);

    res.json({
      success: true,
      orderId: order.id,
      amount: order.amount,
    });

  } catch (err) {
    console.error("❌ Razorpay error:", err.message);

    res.status(500).json({
      success: false,
      error: "Payment failed",
    });
  }
});

// -----------------------------
// SERVER
// -----------------------------
const PORT = 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`⚡ Server running in ${Date.now() - global.startTime}ms`);
  console.log(`🌍 http://YOUR_EC2_IP:${PORT}`);
});