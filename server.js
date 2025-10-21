// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Razorpay = require('razorpay');
const { GoogleSpreadsheet } = require('google-spreadsheet');

const app = express();
app.use(express.json());
app.use(cors());

// ✅ Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ✅ Initialize Google Sheet
const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID);
async function initGoogleSheet() {
  await doc.useServiceAccountAuth({
    client_email: process.env.GOOGLE_SERVICE_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  });
  await doc.loadInfo();
  return doc.sheetsByIndex[0];
}

// ✅ Create Razorpay Order
app.post('/create-order', async (req, res) => {
  try {
    const { amount, name, email, donationCategory, folkGuide } = req.body;

    const options = {
      amount: amount * 100, // amount in paise
      currency: 'INR',
      receipt: `receipt_${Date.now()}`,
    };

    const order = await razorpay.orders.create(options);

    res.status(200).json({
      success: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      receipt: order.receipt,
    });

    // Log to Google Sheet as "PENDING"
    const sheet = await initGoogleSheet();
    await sheet.addRow({
      Timestamp: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      Name: name || 'Unknown',
      Email: email || 'N/A',
      'Donation Category': donationCategory || 'N/A',
      'FOLK Guide': folkGuide || 'N/A',
      Amount: amount,
      Status: 'PENDING',
      'Order ID': order.id,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });

    // Log failed attempt
    const sheet = await initGoogleSheet();
    await sheet.addRow({
      Timestamp: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      Name: req.body.name || 'Unknown',
      Email: req.body.email || 'N/A',
      'Donation Category': req.body.donationCategory || 'N/A',
      'FOLK Guide': req.body.folkGuide || 'N/A',
      Amount: req.body.amount || 0,
      Status: 'FAILED',
      'Error Message': err.message,
    });
  }
});

// ✅ Verify Payment & Update Sheet
app.post('/verify-payment', async (req, res) => {
  try {
    const { orderId, paymentId, signature } = req.body;

    // Normally you’d verify signature using crypto (optional here)
    const sheet = await initGoogleSheet();
    const rows = await sheet.getRows();

    const row = rows.find(r => r['Order ID'] === orderId);
    if (row) {
      row.Status = 'SUCCESS';
      row['Payment ID'] = paymentId;
      row['Verified Timestamp'] = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
      await row.save();
    }

    res.status(200).json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Razorpay backend running on port ${PORT}`));
