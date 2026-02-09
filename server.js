// server.js - FREE TIER OPTIMIZED
require("dotenv").config();

// PRE-LOAD critical modules before server starts
const express = require("express");
const cors = require("cors");
const Razorpay = require("razorpay");
const https = require("https");

const app = express();

// MINIMAL middleware stack
app.use(cors());
app.use(express.json({ limit: "10kb" })); // Small limit = faster parsing

// -----------------------------
// 1. RAZORPAY (Pre-warmed instance)
// -----------------------------
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Pre-warm Razorpay connection (reduces first request latency)
razorpay.orders.all({ count: 1 }).catch(() => {}); // Silent fail on cold start

// -----------------------------
// 2. AGGRESSIVE KEEP-ALIVE (Free tier hack)
// -----------------------------
const SELF_URL = "https://razorpay-cn9l.onrender.com"; // NO trailing space!

// Ping every 2 minutes 30 seconds (Render free = 5 min sleep)
// Multiple pings to ensure wakefulness
const PING_INTERVAL = 150000; // 2.5 min

function ping() {
  const req = https.get(`${SELF_URL}/health`, { timeout: 3000 }, (res) => {
    res.resume(); // Discard body immediately
  });
  req.on("error", () => {});
  req.on("timeout", () => req.destroy());
}

// Triple ping strategy for reliability
setInterval(ping, PING_INTERVAL);
setInterval(ping, PING_INTERVAL + 10000); // Offset by 10s
setTimeout(ping, 1000); // Initial ping after 1s

// -----------------------------
// 3. ULTRA-FAST ROUTES
// -----------------------------
app.get("/health", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ ok: true, t: Date.now() });
});

// Warm-up endpoint (call this from frontend before payment)
app.get("/warmup", (req, res) => res.json({ ready: true }));

app.post("/create-order", async (req, res) => {
  const start = Date.now();
  
  try {
    const { amount, currency = "INR" } = req.body;

    // Ultra-fast validation
    if (!amount || amount < 1) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    // Direct order creation (no extra options)
    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100),
      currency: currency.toUpperCase(),
      receipt: `r${Date.now()}`, // Shorter receipt ID
    });

    console.log(`Order: ${Date.now() - start}ms`);
    
    // Minimal response
    res.json({
      success: true,
      orderId: order.id,
      amount: order.amount,
    });

  } catch (err) {
    console.error(`${Date.now() - start}ms - ${err.message}`);
    res.status(500).json({ 
      success: false, 
      error: "Payment failed" 
    });
  }
});

// -----------------------------
// 4. SERVER CONFIG (Free tier optimized)
// -----------------------------
const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`⚡ Server ready in ${Date.now() - global.startTime}ms`);
});

// Aggressive timeouts to prevent hanging
server.timeout = 8000;
server.keepAliveTimeout = 30000;

// Track start time
global.startTime = Date.now();