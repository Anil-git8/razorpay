global.startTime = Date.now();

const express = require("express");
const cors = require("cors");
const Razorpay = require("razorpay");
const crypto = require("crypto");

const app = express();

app.use(cors());
app.use(express.json());

// -----------------------------
// Razorpay Config
// -----------------------------
const razorpay = new Razorpay({
  key_id: 'rzp_live_RW6EGUwOH81Aul',
  key_secret: 'VuI5bdfHGZEN0Cf1v3R0A1q3',
});

const KEY_SECRET = 'VuI5bdfHGZEN0Cf1v3R0A1q3';

// -----------------------------
// ROUTES
// -----------------------------

app.get("/", (req, res) => {
  res.json({
    message: "Razorpay API Server",
    endpoints: ["/create-order", "/verify-payment", "/health"],
  });
});

app.get("/health", (req, res) => {
  res.json({ ok: true, time: Date.now() });
});

// ✅ Create Order
app.post("/create-order", async (req, res) => {
  const start = Date.now();

  try {
    const { amount, currency = "INR", name, email, phone } = req.body;

    console.log("📦 Create order request:", { amount, currency, name, email, phone });

    if (!amount || amount < 1) {
      return res.status(400).json({ success: false, error: "Invalid amount" });
    }

    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100), // convert to paise
      currency: currency.toUpperCase(),
      receipt: `r${Date.now()}`,
      notes: {
        name: name || '',
        email: email || '',
        phone: phone || '',
      }
    });

    console.log(`✅ Order created in ${Date.now() - start}ms — ID: ${order.id}`);

    res.json({
      success: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
    });

  } catch (err) {
    console.error("❌ Razorpay create-order error:", err.message);
    res.status(500).json({ success: false, error: err.message || "Order creation failed" });
  }
});

// ✅ Verify Payment
app.post("/verify-payment", (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body;

    console.log("🔐 Verifying payment:", { razorpay_order_id, razorpay_payment_id });

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success: false, error: "Missing payment fields" });
    }

    const body = razorpay_order_id + "|" + razorpay_payment_id;

    const expectedSignature = crypto
      .createHmac("sha256", KEY_SECRET)
      .update(body)
      .digest("hex");

    const isValid = expectedSignature === razorpay_signature;

    if (isValid) {
      console.log("✅ Payment verified:", razorpay_payment_id);
      res.json({ success: true, paymentId: razorpay_payment_id });
    } else {
      console.error("❌ Signature mismatch for:", razorpay_payment_id);
      res.status(400).json({ success: false, error: "Invalid signature" });
    }

  } catch (err) {
    console.error("❌ Verify error:", err.message);
    res.status(500).json({ success: false, error: "Verification failed" });
  }
});

// -----------------------------
// SERVER
// -----------------------------
const PORT = 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`⚡ Server running in ${Date.now() - global.startTime}ms`);
  console.log(`🌍 Listening on port ${PORT}`);
});