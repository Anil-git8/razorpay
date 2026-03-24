global.startTime = Date.now();

const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const sha512 = require("js-sha512");
const axios = require("axios");
const qs = require("qs");
const Razorpay = require("razorpay");
const Airtable = require("airtable");
require("dotenv").config();

const app = express();

// ─────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// ─────────────────────────────────────────────
// Validate Required ENV Variables on Startup
// ─────────────────────────────────────────────
const REQUIRED_ENV = [
  "AIRTABLE_API_KEY",
  "AIRTABLE_BASE_ID",
  "AIRTABLE_TABLE_NAME",
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
  "EASEBUZZ_KEY",
  "EASEBUZZ_SALT",
];

const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missingEnv.length > 0) {
  console.error("❌ Missing required environment variables:", missingEnv.join(", "));
  process.exit(1);
}

// ─────────────────────────────────────────────
// Razorpay Config
// ─────────────────────────────────────────────
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ─────────────────────────────────────────────
// Easebuzz Config
// ─────────────────────────────────────────────
const easebuzz = {
  key: process.env.EASEBUZZ_KEY,
  salt: process.env.EASEBUZZ_SALT,
  env: process.env.EASEBUZZ_ENV || "prod",
};

// ─────────────────────────────────────────────
// Airtable Config
// ─────────────────────────────────────────────
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_NAME = process.env.AIRTABLE_TABLE_NAME;

const base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(AIRTABLE_BASE_ID);

// ─────────────────────────────────────────────
// Easebuzz Helpers
// ─────────────────────────────────────────────
function getEasebuzzUrl(env) {
  return env === "prod"
    ? "https://pay.easebuzz.in/"
    : "https://testpay.easebuzz.in/";
}

function generateHash(data) {
  const str =
    easebuzz.key + "|" +
    data.txnid + "|" +
    data.amount + "|" +
    data.productinfo + "|" +
    data.name + "|" +
    data.email + "|" +
    (data.udf1 || "") + "|" +
    (data.udf2 || "") + "|" +
    (data.udf3 || "") + "|" +
    (data.udf4 || "") + "|" +
    (data.udf5 || "") + "|" +
    (data.udf6 || "") + "|" +
    (data.udf7 || "") + "|" +
    (data.udf8 || "") + "|" +
    (data.udf9 || "") + "|" +
    (data.udf10 || "") + "|" +
    easebuzz.salt;

  return sha512.sha512(str);
}

// ─────────────────────────────────────────────
// General Routes
// ─────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    message: "FOLK Payments API Server",
    status: "running",
    uptime: `${Math.floor(process.uptime())}s`,
    endpoints: {
      razorpay: ["POST /create-order"],
      easebuzz: [
        "POST /api/payment",
        "POST /api/easebuzz/success",
        "POST /api/easebuzz/failure",
      ],
      utils: ["GET /health", "GET /ping"],
    },
  });
});

app.get("/ping", (req, res) => res.json({ status: "alive", time: new Date().toISOString() }));
app.get("/health", (req, res) => res.json({ ok: true, uptime: process.uptime(), time: Date.now() }));

// ─────────────────────────────────────────────
// RAZORPAY — Create Order
// ─────────────────────────────────────────────
app.post("/create-order", async (req, res) => {
  const start = Date.now();
  try {
    const { amount, currency = "INR" } = req.body;

    if (!amount || isNaN(amount) || amount < 1) {
      return res.status(400).json({ success: false, error: "Invalid amount" });
    }

    const order = await razorpay.orders.create({
      amount: Math.round(Number(amount) * 100),
      currency: currency.toUpperCase(),
      receipt: `receipt_${Date.now()}`,
    });

    console.log(`✅ Razorpay order created in ${Date.now() - start}ms — ID: ${order.id}`);
    res.json({ success: true, orderId: order.id, amount: order.amount, currency: order.currency });

  } catch (err) {
    console.error("❌ Razorpay error:", err.message);
    res.status(500).json({ success: false, error: "Failed to create order" });
  }
});
app.get("/version", (req, res) => {
  res.send("VERSION 2 UPDATED");
});
// ─────────────────────────────────────────────
// EASEBUZZ — Initiate Payment Link
// ─────────────────────────────────────────────
app.post("/api/payment", async (req, res) => {
  try {
    const data = req.body;
    data.name = data.name?.trim() || "";
    data.email = data.email?.trim() || "";
    data.productinfo = data.productinfo?.trim() || "";

    if (!data.txnid || !data.amount || !data.email) {
      return res.status(400).json({ status: 0, error: "txnid, amount and email are required" });
    }

    const hash = generateHash(data);
    const SERVER_URL = process.env.SERVER_URL || "https://raz.folkexclusive.com";

    const form = {
      key: easebuzz.key,
      txnid: data.txnid,
      amount: data.amount,
      firstname: data.name,
      email: data.email,
      phone: data.phone,
      productinfo: data.productinfo,
      surl: `${SERVER_URL}/api/easebuzz/success`,
      furl: `${SERVER_URL}/api/easebuzz/failure`,
      hash,
    };

    const response = await axios.post(
      getEasebuzzUrl(easebuzz.env) + "payment/initiateLink",
      qs.stringify(form),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const result = response.data;

    if (result?.status === 1 && typeof result.data === "string") {
      const paymentUrl = getEasebuzzUrl(easebuzz.env) + "pay/" + result.data;
      console.log(`✅ Easebuzz link generated — txnid: ${data.txnid}`);
      return res.json({ status: 1, url: paymentUrl });
    }

    if (result?.status === 1 && result?.data?.payment_link) {
      return res.json({ status: 1, url: result.data.payment_link });
    }

    console.warn("⚠️ Easebuzz unexpected response:", result);
    res.status(500).json({ status: 0, error: "Failed to generate payment link", details: result });

  } catch (error) {
    console.error("❌ Easebuzz error:", error?.response?.data || error.message);
    res.status(500).json({ status: 0, error: "Internal Server Error" });
  }
});

// ─────────────────────────────────────────────
// EASEBUZZ — Payment Success Callback
// ─────────────────────────────────────────────
app.post("/api/easebuzz/success", async (req, res) => {
  console.log("✅ Easebuzz Success Callback:", req.body);
  const txnid = req.body.txnid;
  if (!txnid) return res.status(400).send("Missing txnid");

  try {
    const records = await base(AIRTABLE_TABLE_NAME)
      .select({ filterByFormula: `{txnid} = '${txnid}'` })
      .firstPage();

    if (records.length > 0) {
      await base(AIRTABLE_TABLE_NAME).update(records[0].id, { "Payment Status": "Success" });
      console.log(`✅ Airtable — Success updated for txnid: ${txnid}`);
    } else {
      console.warn(`⚠️ No Airtable record for txnid: ${txnid}`);
    }

    return res.redirect("https://folkexclusive.com/event-success");
  } catch (error) {
    console.error("❌ Airtable error (success):", error);
    res.status(500).send("Error updating Airtable record");
  }
});

// ─────────────────────────────────────────────
// EASEBUZZ — Payment Failure Callback
// ─────────────────────────────────────────────
app.post("/api/easebuzz/failure", async (req, res) => {
  console.log("❌ Easebuzz Failure Callback:", req.body);
  const txnid = req.body.txnid;
  if (!txnid) return res.status(400).send("Missing txnid");

  try {
    const records = await base(AIRTABLE_TABLE_NAME)
      .select({ filterByFormula: `{txnid} = '${txnid}'` })
      .firstPage();

    if (records.length > 0) {
      await base(AIRTABLE_TABLE_NAME).update(records[0].id, { "Payment Status": "Failed" });
      console.log(`❌ Airtable — Failed updated for txnid: ${txnid}`);
    } else {
      console.warn(`⚠️ No Airtable record for txnid: ${txnid}`);
    }

    return res.redirect("https://folkexclusive.com/event-failed");
  } catch (error) {
    console.error("❌ Airtable error (failure):", error);
    res.status(500).send("Error updating Airtable record");
  }
});

// ─────────────────────────────────────────────
// Global Error Handler
// ─────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error("🔥 Unhandled error:", err.message);
  res.status(500).json({ error: "Something went wrong" });
});

// ─────────────────────────────────────────────
// Start Server
// ─────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`⚡ Server started in ${Date.now() - global.startTime}ms`);
  console.log(`🚀 Running on port ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
});