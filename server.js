global.startTime = Date.now();

const express = require("express");
const cors = require("cors");
const Razorpay = require("razorpay");
const crypto = require("crypto");
const https = require("https");
const http = require("http");

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
// Google Sheets Config
// -----------------------------
const GOOGLE_SHEET_URL =
  "https://script.google.com/macros/s/AKfycbzlCw3FIqcH6zobXmkUX6QCsRR-VBCqMj6qfhLr18LHcn7GJcS4HBFwBgeQYnvQQMfE/exec";

/**
 * Sends donation data to the Google Sheet via Apps Script Web App.
 * Follows redirects manually because Google Script returns a 302.
 *
 * @param {Object} payload  - Fields matching the Apps Script doPost handler:
 *   timestamp, fullName, whatsapp, gender, area,
 *   amount, booksSummary, paymentId, orderId, paymentStatus
 */
async function sendToGoogleSheets(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);

    const makeRequest = (urlStr) => {
      const urlObj = new URL(urlStr);
      const lib = urlObj.protocol === "https:" ? https : http;

      const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      };

      const req = lib.request(options, (res) => {
        // Google Apps Script redirects to the actual execution endpoint
        if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
          console.log(`↩️  Redirecting to: ${res.headers.location}`);
          return makeRequest(res.headers.location);
        }

        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            console.log("📊 Google Sheets response:", parsed);
            resolve(parsed);
          } catch {
            console.log("📊 Google Sheets raw response:", data);
            resolve({ raw: data });
          }
        });
      });

      req.on("error", (err) => {
        console.error("❌ Google Sheets request error:", err.message);
        reject(err);
      });

      req.write(body);
      req.end();
    };

    makeRequest(GOOGLE_SHEET_URL);
  });
}

// -----------------------------
// HELPER — Create Razorpay Invoice
// -----------------------------
async function createRazorpayInvoice({ name, email, phone, amount, currency = "INR", description, orderId = null, subscriptionId = null }) {
  const nowSec = Math.floor(Date.now() / 1000);

  const invoicePayload = {
    type: "invoice",
    date: nowSec,
    due_date: nowSec + 7 * 24 * 60 * 60,
    customer: {
      name: name || "Donor",
      email: email || "",
      contact: phone || "",
    },
    line_items: [
      {
        name: description || "Donation",
        amount: Math.round(amount * 100),
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
    endpoints: ["/create-order", "/verify-payment", "/create-subscription", "/submit-to-sheet", "/health"],
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

    let invoice = null;
    try {
      invoice = await createRazorpayInvoice({
        name, email, phone, amount, currency,
        description: description || "One-time Donation",
        orderId: order.id,
      });
    } catch (invoiceErr) {
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

    let invoice = null;
    try {
      invoice = await createRazorpayInvoice({
        name, email, phone, amount, currency,
        description: description || `Monthly Donation – ₹${amount}`,
        subscriptionId: subscription.id,
      });
    } catch (invoiceErr) {
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
      invoiceUrl: invoice?.short_url || null,
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

// ✅ Submit Donation Details to Google Sheet
// Call this AFTER a successful payment verification.
// Accepts all Sunday Love Feast form fields + payment info.
//
// Body fields:
//   fullName      — donor's full name
//   whatsapp      — donor's WhatsApp number
//   gender        — donor's gender
//   area          — area of stay
//   amount        — donation amount (number)
//   booksSummary  — sponsorship / books details string
//   paymentId     — razorpay_payment_id from verify-payment
//   orderId       — razorpay_order_id
//   paymentStatus — "Paid" | "Pending" | "Failed"  (default: "Paid")
//   timestamp     — ISO string (optional, defaults to now)
app.post("/submit-to-sheet", async (req, res) => {
  try {
    const {
      fullName,
      whatsapp,
      gender,
      area,
      amount,
      booksSummary,
      paymentId,
      orderId,
      paymentStatus = "Paid",
      timestamp = new Date().toISOString(),
    } = req.body;

    console.log("📊 Submitting to Google Sheet:", { fullName, amount, paymentId, orderId });

    const payload = {
      timestamp,
      fullName,
      whatsapp,
      gender,
      area,
      amount,
      booksSummary,
      paymentId,
      orderId,
      paymentStatus,
    };

    const sheetResponse = await sendToGoogleSheets(payload);

    if (sheetResponse?.success) {
      console.log("✅ Google Sheet updated successfully");
      res.json({ success: true, message: "Data saved to Google Sheet" });
    } else {
      console.warn("⚠️ Google Sheet returned non-success:", sheetResponse);
      res.status(500).json({
        success: false,
        error: sheetResponse?.error || "Google Sheet update failed",
      });
    }

  } catch (err) {
    console.error("❌ submit-to-sheet error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ Verify Payment + Auto-Submit to Google Sheet in one step
// Useful when you want a single call from the frontend after payment.
//
// Body: all /verify-payment fields + all /submit-to-sheet fields.
app.post("/verify-and-save", async (req, res) => {
  try {
    const {
      // Payment verification fields
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      // Donor / form fields
      fullName,
      whatsapp,
      gender,
      area,
      amount,
      booksSummary,
      timestamp = new Date().toISOString(),
    } = req.body;

    console.log("🔐 Verify-and-save:", { razorpay_order_id, razorpay_payment_id });

    // --- Step 1: Verify signature ---
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success: false, error: "Missing payment fields" });
    }

    const sigBody = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", KEY_SECRET)
      .update(sigBody)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      console.error("❌ Signature mismatch for:", razorpay_payment_id);
      return res.status(400).json({ success: false, error: "Invalid signature" });
    }

    console.log("✅ Payment verified:", razorpay_payment_id);

    // --- Step 2: Send to Google Sheet ---
    let sheetSaved = false;
    let sheetError = null;

    try {
      const sheetResponse = await sendToGoogleSheets({
        timestamp,
        fullName,
        whatsapp,
        gender,
        area,
        amount,
        booksSummary,
        paymentId: razorpay_payment_id,
        orderId: razorpay_order_id,
        paymentStatus: "Paid",
      });
      sheetSaved = sheetResponse?.success === true;
      if (!sheetSaved) sheetError = sheetResponse?.error || "Sheet update failed";
    } catch (sheetErr) {
      // Non-fatal — payment is confirmed even if sheet write fails
      sheetError = sheetErr.message;
      console.warn("⚠️ Google Sheet write failed (non-fatal):", sheetErr.message);
    }

    res.json({
      success: true,
      paymentId: razorpay_payment_id,
      sheetSaved,
      ...(sheetError && { sheetError }),
    });

  } catch (err) {
    console.error("❌ verify-and-save error:", err.message);
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
