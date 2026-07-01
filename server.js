global.startTime = Date.now();

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const Razorpay = require("razorpay");
const crypto = require("crypto");
const axios = require("axios");

const app = express();

app.use(cors());
app.use(express.json());

// -----------------------------
// Logger, API URL, and processed cache
// -----------------------------
const FOLK_API_URL = process.env.FOLK_API_URL || "https://api.anandatirumaladevasthanam.com/api/donate";
const SEVA_NAME = process.env.SEVA_NAME || "TRIDAS-FOLK-GENERAL";

const log = {
  info: (tag, msg, data = {}) => console.log(`[${new Date().toISOString()}] [INFO]  [${tag}] ${msg}`, JSON.stringify(data)),
  warn: (tag, msg, data = {}) => console.warn(`[${new Date().toISOString()}] [WARN]  [${tag}] ${msg}`, JSON.stringify(data)),
  error: (tag, msg, data = {}) => console.error(`[${new Date().toISOString()}] [ERROR] [${tag}] ${msg}`, JSON.stringify(data)),
};

const processedPayments = new Set();

// -----------------------------
// Razorpay Config
// -----------------------------
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || 'rzp_live_RW6EGUwOH81Aul',
  key_secret: process.env.RAZORPAY_KEY_SECRET || 'VuI5bdfHGZEN0Cf1v3R0A1q3',
});

const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'VuI5bdfHGZEN0Cf1v3R0A1q3';

// -----------------------------
// HELPER — Push to FOLK DB (Dhanunjaya)
// -----------------------------
async function pushToFOLK(donorName, amount, email, mobile, remarks, address = "") {
  const payload = {
    donor_name: donorName || "",
    pan_no: "N/A",
    mobile: mobile || "",
    email: email || "",
    address: address || "",
    amount: parseFloat(amount) || 0,
    seva: SEVA_NAME,
    remarks: remarks || "",
    atg_required: false,
    trust: "TRI",
    preacher: "PDKD",
    separated_address: {
      type: "Residential",
      address_line_1: "N/A",
      address_line_2: "N/A",
      city: "N/A",
      state: "N/A",
      country: "India",
      pin_code: "N/A",
    },
  };

  log.info("FOLK", "Pushing to FOLK API", { remarks, donorName, amount });

  try {
    const response = await axios.post(FOLK_API_URL, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 15000,
    });
    log.info("FOLK", "✅ Success", { status: response.status, data: response.data });
    return { success: true, data: response.data };
  } catch (err) {
    log.error("FOLK", "❌ Failed", {
      remarks,
      status: err.response?.status,
      error: err.response?.data || err.message,
    });
    return { success: false, error: err.response?.data || err.message };
  }
}

// -----------------------------
// HELPER — Create Razorpay Invoice
// -----------------------------
async function createRazorpayInvoice({ name, email, phone, amount, currency = "INR", description, orderId = null, subscriptionId = null }) {
  const nowSec = Math.floor(Date.now() / 1000);

  const invoicePayload = {
    type: "invoice",
    date: nowSec,
    due_date: nowSec + 7 * 24 * 60 * 60, // due in 7 days
    customer: {
      name: name || "Donor",
      email: email || "",
      contact: phone || "",
    },
    line_items: [
      {
        name: description || "Donation",
        amount: Math.round(amount * 100), // paise
        currency: currency.toUpperCase(),
        quantity: 1,
      },
    ],
    currency: currency.toUpperCase(),
    description: description || "Hare Krishna Temple Donation",
    notes: {
      ...(orderId && { order_id: orderId }),
      ...(subscriptionId && { subscription_id: subscriptionId }),
    },
  };

  const invoice = await razorpay.invoices.create(invoicePayload);
  console.log(`🧾 Invoice created: ${invoice.id} | Status: ${invoice.status}`);
  return invoice;
}

// -----------------------------
// ROUTES
// -----------------------------

app.get("/", (req, res) => {
  res.json({
    message: "Razorpay API Server",
    endpoints: ["/create-order", "/verify-payment", "/create-subscription", "/health"],
  });
});

app.get("/health", (req, res) => {
  res.json({ ok: true, time: Date.now() });
});

// ✅ Create Order + Invoice
app.post("/create-order", async (req, res) => {
  const start = Date.now();

  try {
    const { amount, currency = "INR", name, email, phone, description } = req.body;

    console.log("📦 Create order request:", { amount, currency, name, email, phone });

    if (!amount || amount < 1) {
      return res.status(400).json({ success: false, error: "Invalid amount" });
    }

    // Step 1 — Create Order
    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100),
      currency: currency.toUpperCase(),
      receipt: `r${Date.now()}`,
      notes: {
        name: name || '',
        email: email || '',
        phone: phone || '',
      },
    });

    console.log(`✅ Order created in ${Date.now() - start}ms — ID: ${order.id}`);

    // Step 2 — Create Invoice linked to this order
    let invoice = null;
    try {
      invoice = await createRazorpayInvoice({
        name, email, phone, amount, currency,
        description: description || "One-time Donation",
        orderId: order.id,
      });
    } catch (invoiceErr) {
      // Non-fatal — order is still valid even if invoice creation fails
      console.warn("⚠️ Invoice creation failed (non-fatal):", invoiceErr.message);
    }

    res.json({
      success: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      invoiceId: invoice?.id || null,
      invoiceStatus: invoice?.status || null,
      invoiceUrl: invoice?.short_url || null,
    });

  } catch (err) {

    console.log("=================================");
    console.log("FULL RAZORPAY ERROR:");
    console.dir(err, { depth: null });
    console.log("=================================");

    res.status(500).json({
      success: false,
      error:
        err?.error?.description ||
        err?.message ||
        JSON.stringify(err) ||
        "Order creation failed",
    });
  }
});

// ✅ Verify Payment
app.post("/verify-payment", (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

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

// ✅ Webhook Handler
app.post("/webhook", async (req, res) => {
  try {
    const signature = req.headers["x-razorpay-signature"];
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || '2d4g4g7pp@fnwdA';

    if (webhookSecret && signature) {
      const shasum = crypto.createHmac("sha256", webhookSecret);
      shasum.update(JSON.stringify(req.body));
      const digest = shasum.digest("hex");
      if (digest !== signature) {
        log.warn("WEBHOOK", "❌ Invalid Webhook Signature");
        return res.status(400).send("Invalid signature");
      }
    } else {
      log.warn("WEBHOOK", "⚠️ Webhook received without signature verification (Secret/Signature missing)");
    }

    const { event, payload } = req.body;
    log.info("WEBHOOK", `Event received: ${event}`, { event });

    if (event === "payment.captured") {
      const payment = payload?.payment?.entity;
      if (!payment) {
        log.error("WEBHOOK", "❌ No payment entity found in webhook payload");
        return res.status(400).json({ success: false, error: "Invalid payload" });
      }

      const paymentId = payment.id;

      // Idempotency: Ensure this payment is only processed once
      if (processedPayments.has(paymentId)) {
        log.warn("WEBHOOK", `⚠️ Payment ${paymentId} already processed, skipping`);
        return res.json({ success: true, status: "already_processed" });
      }

      processedPayments.add(paymentId);

      const donorName = payment.notes?.name || payment.notes?.donor_name || payment.notes?.firstname || payment.description || "Donor";
      const amount = payment.amount / 100; // Razorpay uses paise
      const email = payment.email || "";
      const mobile = payment.contact || "";
      const remarks = paymentId;
      const address = payment.notes?.address || payment.notes?.areaOfStay || "";

      log.info("WEBHOOK", `Processing successful payment: ${paymentId}`, {
        donorName,
        amount,
        email,
        mobile,
      });

      const pushResult = await pushToFOLK(donorName, amount, email, mobile, remarks, address);
      return res.json({ success: true, pushResult });
    }

    res.json({ success: true, message: "Event ignored" });
  } catch (err) {
    log.error("WEBHOOK", "❌ Webhook handling exception", { error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
});


// ✅ Create Subscription (Monthly Auto-Debit) + Invoice
app.post("/create-subscription", async (req, res) => {
  const start = Date.now();

  try {
    const {
      name,
      email,
      phone,
      amount,
      period = "monthly",
      interval = 1,
      currency = "INR",
      description,
    } = req.body;

    console.log("📦 Create subscription request:", { name, email, amount, period, interval });

    if (!amount || amount < 1) {
      return res.status(400).json({ success: false, error: "Invalid amount" });
    }

    // Step 1 — Create Plan
    const plan = await razorpay.plans.create({
      period,
      interval,
      item: {
        name: `Donation – ₹${amount}/${period}`,
        amount: Math.round(amount * 100),
        currency: currency.toUpperCase(),
      },
      notes: { name: name || '', email: email || '' },
    });

    console.log(`✅ Plan created: ${plan.id}`);

    // Step 2 — Create Subscription
    const subscription = await razorpay.subscriptions.create({
      plan_id: plan.id,
      total_count: 120,
      quantity: 1,
      customer_notify: 1,
      notes: {
        name: name || '',
        email: email || '',
        phone: phone || '',
      },
    });

    console.log(`✅ Subscription created in ${Date.now() - start}ms — ID: ${subscription.id}`);

    // Step 3 — Create Invoice for the first billing cycle
    let invoice = null;
    try {
      invoice = await createRazorpayInvoice({
        name, email, phone, amount, currency,
        description: description || `Monthly Donation – ₹${amount}`,
        subscriptionId: subscription.id,
      });
    } catch (invoiceErr) {
      // Non-fatal — subscription is still valid
      console.warn("⚠️ Invoice creation failed (non-fatal):", invoiceErr.message);
    }

    res.json({
      success: true,
      subscriptionId: subscription.id,
      planId: plan.id,
      status: subscription.status,
      amount,
      period,
      invoiceId: invoice?.id || null,
      invoiceStatus: invoice?.status || null,
      invoiceUrl: invoice?.short_url || null,  // shareable invoice link
    });

  } catch (err) {
    console.error("❌ Razorpay create-subscription error:", err.message, err?.error);
    res.status(500).json({
      success: false,
      error: err?.error?.description || err.message || "Subscription creation failed",
    });
  }
});

// ✅ Fetch Invoice by ID
app.get("/invoice/:id", async (req, res) => {
  try {
    const invoice = await razorpay.invoices.fetch(req.params.id);
    res.json({ success: true, invoice });
  } catch (err) {
    console.error("❌ Fetch invoice error:", err.message);
    res.status(500).json({ success: false, error: err.message });
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