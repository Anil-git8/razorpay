require("dotenv").config();

const express = require("express");
const cors = require("cors");
const Razorpay = require("razorpay");
const crypto = require("crypto");

global.startTime = Date.now();

const app = express();

app.use(cors());
app.use(express.json({ limit: "10kb" }));

// -----------------------------
// 1. RAZORPAY (Pre-warmed instance)
// -----------------------------
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

razorpay.orders.all({ count: 1 }).catch(() => { });

// -----------------------------
// 2. INVOICE ID GENERATOR
// -----------------------------
let invoiceCounter = 1;

function generateInvoiceId() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const count = String(invoiceCounter++).padStart(4, "0");
  // Format: INV-20250402-0001
  return `INV-${year}${month}${day}-${count}`;
}

// -----------------------------
// 3. ROUTES
// -----------------------------

app.get("/health", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ ok: true, t: Date.now() });
});

app.get("/warmup", (req, res) => res.json({ ready: true }));

// ── Create Order ─────────────────────────────────────────────────
app.post("/create-order", async (req, res) => {
  const start = Date.now();
  try {
    const { amount, currency = "INR", name, email, phone } = req.body;

    if (!amount || amount < 1) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const invoiceId = generateInvoiceId();

    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100), // paise
      currency: currency.toUpperCase(),
      receipt: invoiceId,               // invoice ID used as receipt
      notes: {
        invoice_id: invoiceId,
        customer_name: name || "",
        customer_email: email || "",
        customer_phone: phone || "",
      },
    });

    console.log(`✅ Order created [${invoiceId}]: ${Date.now() - start}ms`);
    res.json({
      success: true,
      orderId: order.id,
      invoiceId: invoiceId,             // send back to frontend
      amount: order.amount,
      currency: order.currency,
    });
  } catch (err) {
    console.error(`❌ Create order failed (${Date.now() - start}ms): ${err.message}`);
    res.status(500).json({ success: false, error: "Order creation failed" });
  }
});

// ── Verify Payment ───────────────────────────────────────────────
app.post("/verify-payment", (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        success: false,
        error: "Missing payment verification fields",
      });
    }

    const body = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      console.warn(`⚠️ Signature mismatch for order: ${razorpay_order_id}`);
      return res.status(400).json({
        success: false,
        error: "Payment verification failed. Invalid signature.",
      });
    }

    console.log(`✅ Payment verified: ${razorpay_payment_id}`);
    res.json({
      success: true,
      paymentId: razorpay_payment_id,
      orderId: razorpay_order_id,
    });
  } catch (err) {
    console.error(`❌ Verify failed: ${err.message}`);
    res.status(500).json({ success: false, error: "Verification error" });
  }
});

// ── 404 fallback ─────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// -----------------------------
// 4. SERVER CONFIG
// -----------------------------
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`⚡ Server ready in ${Date.now() - global.startTime}ms on port ${PORT}`);
});

server.timeout = 8000;
server.keepAliveTimeout = 30000;