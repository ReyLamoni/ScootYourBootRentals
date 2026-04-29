require('dotenv').config();
const express      = require('express');
const bcrypt       = require('bcrypt');
const { Resend }   = require('resend');
const rateLimit    = require('express-rate-limit');
const mongoose     = require('mongoose');
const cloudinary   = require('cloudinary').v2;
const path         = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Cloudinary config ──────────────────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ── MongoDB ────────────────────────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅  MongoDB connected'))
  .catch(err => console.error('❌  MongoDB connection error:', err));

const storeSchema = new mongoose.Schema({
  key:       { type: String, default: 'main' },
  items:     { type: mongoose.Schema.Types.Mixed, default: [] },
  calSt:     { type: mongoose.Schema.Types.Mixed, default: {} },
  inquiries: { type: mongoose.Schema.Types.Mixed, default: [] },
  rentals:   { type: mongoose.Schema.Types.Mixed, default: [] },
  videos:    { type: mongoose.Schema.Types.Mixed, default: [] },
}, { timestamps: true });

const Store = mongoose.model('Store', storeSchema);

async function getStore() {
  let store = await Store.findOne({ key: 'main' });
  if (!store) store = await Store.create({ key: 'main' });
  return store;
}

// ── Middleware ─────────────────────────────────────────────────────
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { ok: false, error: 'Too many login attempts. Try again in 15 minutes.' }
});

// ── Routes ─────────────────────────────────────────────────────────

// POST /api/login
app.post('/api/login', loginLimiter, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || typeof password !== 'string')
      return res.status(400).json({ ok: false, error: 'Password required.' });
    const hash = process.env.ADMIN_PASSWORD_HASH;
    if (!hash)
      return res.status(500).json({ ok: false, error: 'Server misconfiguration.' });
    const match = await bcrypt.compare(password, hash);
    if (match) return res.json({ ok: true });
    await new Promise(r => setTimeout(r, 500));
    return res.status(401).json({ ok: false, error: 'Incorrect password.' });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ ok: false, error: 'Server error.' });
  }
});

// GET /api/data
app.get('/api/data', async (req, res) => {
  try {
    const store = await getStore();
    res.json({
      ok: true,
      items:     store.items     || [],
      calSt:     store.calSt     || {},
      inquiries: store.inquiries || [],
      rentals:   store.rentals   || [],
      videos:    store.videos    || [],
    });
  } catch (err) {
    console.error('GET /api/data error:', err);
    res.status(500).json({ ok: false, error: 'Could not load data.' });
  }
});

// POST /api/data
app.post('/api/data', async (req, res) => {
  try {
    const { items, calSt, inquiries, rentals, videos } = req.body;
    await Store.findOneAndUpdate(
      { key: 'main' },
      { $set: { items, calSt, inquiries, rentals, videos } },
      { upsert: true, new: true }
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/data error:', err);
    res.status(500).json({ ok: false, error: 'Could not save data.' });
  }
});

/**
 * POST /api/upload-video
 * Receives a base64 video from the browser, uploads it to Cloudinary,
 * and returns the secure URL. Only the URL is stored in MongoDB.
 * Body: { data: "data:video/mp4;base64,..." }
 */
app.post('/api/upload-video', async (req, res) => {
  try {
    const { data } = req.body;
    if (!data) return res.status(400).json({ ok: false, error: 'No video data provided.' });

    const result = await cloudinary.uploader.upload(data, {
      resource_type: 'video',
      folder: 'scoot-your-boot',
      transformation: [{ quality: 'auto' }],
    });

    console.log(`Video uploaded to Cloudinary: ${result.secure_url}`);
    return res.json({ ok: true, url: result.secure_url, publicId: result.public_id });
  } catch (err) {
    console.error('Video upload error:', err);
    return res.status(500).json({ ok: false, error: 'Video upload failed.' });
  }
});

/**
 * POST /api/delete-video
 * Deletes a video from Cloudinary when the admin removes it.
 * Body: { publicId: "scoot-your-boot/abc123" }
 */
app.post('/api/delete-video', async (req, res) => {
  try {
    const { publicId } = req.body;
    if (!publicId) return res.status(400).json({ ok: false, error: 'No publicId provided.' });
    await cloudinary.uploader.destroy(publicId, { resource_type: 'video' });
    return res.json({ ok: true });
  } catch (err) {
    console.error('Video delete error:', err);
    return res.status(500).json({ ok: false, error: 'Video delete failed.' });
  }
});

/**
 * POST /api/upload-image
 * Uploads a listing photo to Cloudinary and returns the URL.
 */
app.post('/api/upload-image', async (req, res) => {
  try {
    const { data } = req.body;
    if (!data) return res.status(400).json({ ok: false, error: 'No image data provided.' });
    const result = await cloudinary.uploader.upload(data, {
      resource_type: 'image',
      folder: 'scoot-your-boot/images',
      transformation: [{ quality: 'auto', fetch_format: 'auto' }],
    });
    console.log(`Image uploaded to Cloudinary: ${result.secure_url}`);
    return res.json({ ok: true, url: result.secure_url, publicId: result.public_id });
  } catch (err) {
    console.error('Image upload error:', err);
    return res.status(500).json({ ok: false, error: 'Image upload failed.' });
  }
});

/**
 * POST /api/delete-image
 * Deletes a listing photo from Cloudinary.
 */
app.post('/api/delete-image', async (req, res) => {
  try {
    const { publicId } = req.body;
    if (!publicId) return res.status(400).json({ ok: false, error: 'No publicId provided.' });
    await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
    return res.json({ ok: true });
  } catch (err) {
    console.error('Image delete error:', err);
    return res.status(500).json({ ok: false, error: 'Image delete failed.' });
  }
});
app.post('/api/inquiry', async (req, res) => {
  try {
    const { name, phone, email, itemName, dates, cost, msg, storeData } = req.body;
    if (!name || !phone || !itemName)
      return res.status(400).json({ ok: false, error: 'Missing required fields.' });

    if (storeData) {
      await Store.findOneAndUpdate(
        { key: 'main' },
        { $set: storeData },
        { upsert: true }
      );
    }

    const resendKey   = process.env.RESEND_API_KEY;
    const notifyEmail = process.env.NOTIFY_EMAIL;
    const fromEmail   = process.env.FROM_EMAIL || 'onboarding@resend.dev';

    if (resendKey && notifyEmail) {
      const costLine = cost != null ? `$${Number(cost).toFixed(2)}` : 'N/A';
      const resend = new Resend(resendKey);
      await resend.emails.send({
        from: `Scoot Your Boot Rentals <${fromEmail}>`,
        to: [notifyEmail],
        subject: `New Rental Request — ${itemName}`,
        text: [
          'New rental inquiry received!', '',
          `Item:      ${itemName}`,
          `Renter:    ${name}`,
          `Phone:     ${phone}`,
          `Email:     ${email || 'not provided'}`,
          `Dates:     ${dates || 'not provided'}`,
          `Est Cost:  ${costLine}`,
          `Message:   ${msg || '(none)'}`, '',
          'Log in to your admin panel to accept or decline.',
        ].join('\n'),
        html: `
          <div style="font-family:sans-serif;max-width:520px;margin:0 auto">
            <div style="background:#1a1410;padding:20px 28px;border-radius:8px 8px 0 0">
              <h2 style="color:#fff;margin:0;font-size:1.2rem">New Rental Request</h2>
              <p style="color:#d4c5a9;margin:4px 0 0;font-size:0.85rem">Scoot Your Boot Rentals &middot; Provo, Utah</p>
            </div>
            <div style="border:1px solid #e5e0d8;border-top:none;border-radius:0 0 8px 8px;padding:24px 28px">
              <table style="width:100%;border-collapse:collapse;font-size:0.9rem">
                <tr><td style="padding:6px 0;color:#888;width:110px">Item</td><td style="padding:6px 0;font-weight:600">${itemName}</td></tr>
                <tr><td style="padding:6px 0;color:#888">Renter</td><td style="padding:6px 0">${name}</td></tr>
                <tr><td style="padding:6px 0;color:#888">Phone</td><td style="padding:6px 0">${phone}</td></tr>
                <tr><td style="padding:6px 0;color:#888">Email</td><td style="padding:6px 0">${email || '<em>not provided</em>'}</td></tr>
                <tr><td style="padding:6px 0;color:#888">Dates</td><td style="padding:6px 0">${dates || '<em>not provided</em>'}</td></tr>
                <tr><td style="padding:6px 0;color:#888">Est. Cost</td><td style="padding:6px 0;color:#c4501a;font-weight:600">${costLine}</td></tr>
                ${msg ? `<tr><td style="padding:6px 0;color:#888;vertical-align:top">Message</td><td style="padding:6px 0;font-style:italic">&ldquo;${msg}&rdquo;</td></tr>` : ''}
              </table>
              <div style="margin-top:20px;padding:14px;background:#f5f0e8;border-radius:6px;font-size:0.82rem;color:#555">
                Log in to your admin panel to review and respond.
              </div>
            </div>
          </div>`,
      });
      console.log(`Notification sent to ${notifyEmail} for inquiry from ${name}`);
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('Inquiry error:', err);
    return res.json({ ok: true, warning: 'Saved but email notification failed.' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'Scoot Your Boot Rentals', time: new Date().toISOString() });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🛴  Scoot Your Boot Rentals server running`);
  console.log(`   Local:  http://localhost:${PORT}`);
  console.log(`   Press Ctrl+C to stop\n`);
});
