// server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const Razorpay = require("razorpay");
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const app = express();
app.use(express.json());
app.use(cors());

// -----------------------------
// 1. Initialize Razorpay
// -----------------------------
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// -----------------------------
// 2. KEEP SERVER AWAKE (Render Fix)
// -----------------------------
const SELF_URL = "https://razorpay-cn9l.onrender.com";

function keepAlive() {
  fetch(`${SELF_URL}/health`).catch(() => {});
}

// Ping every **4 minutes** (Render sleeps at 5 minutes)
setInterval(keepAlive, 240000);

// Ping immediately on start
keepAlive();

// -----------------------------
// 3. Health route
// -----------------------------
app.get("/health", (req, res) => res.status(200).send("OK"));

// -----------------------------
// 4. FAST Razorpay Order Endpoint
// -----------------------------
app.post("/create-order", async (req, res) => {
  try {
    const { amount, currency = "INR", receipt } = req.body;

    if (!amount || isNaN(amount)) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid amount" });
    }

    const options = {
      amount: Math.round(amount * 100),
      currency,
      receipt: receipt || `rcpt_${Date.now()}`,
    };

    const order = await razorpay.orders.create(options);

    res.json({
      success: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      receipt: order.receipt,
    });
  } catch (err) {
    console.error("❌ Razorpay error:", err);
    res
      .status(500)
      .json({ success: false, error: err.message || "Server error" });
  }
});

// -----------------------------
// 5. Start Server
// -----------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🚀 Razorpay backend live on port ${PORT}`)
);
