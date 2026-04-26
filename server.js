/**
 * Scoot Your Boot Rentals — Backend Server
 * ==========================================
 * Handles:
 *   1. Password verification (bcrypt — hash never exposed to browser)
 *   2. Email notifications via Nodemailer when a new inquiry arrives
 *   3. Serves the HTML frontend
 *
 * Setup:
 *   npm install
 *   node scripts/hash-password.js   ← run ONCE to generate your password hash
 *   node server.js
 */

require('dotenv').config();
const express    = require('express');
const bcrypt     = require('bcrypt');
const nodemailer = require('nodemailer');
const rateLimit  = require('express-rate-limit');
const path       = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' })); // allow base64 images/videos
app.use(express.static(path.join(__dirname, 'public'))); // serves index.html + assets

// Rate-limit the login endpoint to slow brute-force attempts
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,                   // max 20 attempts per window per IP
  message: { ok: false, error: 'Too many login attempts. Try again in 15 minutes.' }
});

// ── Email transporter ─────────────────────────────────────────────
// Uses Gmail by default. For other providers change the `service` or
// supply `host`/`port` manually. See: https://nodemailer.com/smtp/
function createTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,  // your Gmail address
      pass: process.env.EMAIL_PASS,  // Gmail App Password (not your login password)
    },
  });
}

// ── Routes ────────────────────────────────────────────────────────

/**
 * POST /api/login
 * Body: { password: string }
 * Returns: { ok: true } or { ok: false, error: string }
 *
 * The browser sends the plain-text password; the server compares it
 * against the stored bcrypt hash. The hash never leaves the server.
 */
app.post('/api/login', loginLimiter, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || typeof password !== 'string') {
      return res.status(400).json({ ok: false, error: 'Password required.' });
    }

    const hash = process.env.ADMIN_PASSWORD_HASH;
    if (!hash) {
      console.error('ADMIN_PASSWORD_HASH not set in .env');
      return res.status(500).json({ ok: false, error: 'Server misconfiguration.' });
    }

    const match = await bcrypt.compare(password, hash);
    if (match) {
      return res.json({ ok: true });
    } else {
      // Small artificial delay to slow brute force even more
      await new Promise(r => setTimeout(r, 500));
      return res.status(401).json({ ok: false, error: 'Incorrect password.' });
    }
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ ok: false, error: 'Server error.' });
  }
});

/**
 * POST /api/inquiry
 * Body: { name, phone, email, itemName, dates, cost, msg }
 * Sends a notification email to NOTIFY_EMAIL, then returns { ok: true }.
 */
app.post('/api/inquiry', async (req, res) => {
  try {
    const { name, phone, email, itemName, dates, cost, msg } = req.body;

    // Basic validation
    if (!name || !phone || !itemName) {
      return res.status(400).json({ ok: false, error: 'Missing required fields.' });
    }

    const notifyEmail = process.env.NOTIFY_EMAIL;
    if (!notifyEmail) {
      // Notifications not configured — still accept the inquiry, just skip email
      console.warn('NOTIFY_EMAIL not set — skipping notification email.');
      return res.json({ ok: true, notified: false });
    }

    const costLine = cost != null ? `$${Number(cost).toFixed(2)}` : 'N/A';

    const transporter = createTransporter();
    await transporter.sendMail({
      from: `"Scoot Your Boot Rentals" <${process.env.EMAIL_USER}>`,
      to: notifyEmail,
      subject: `📬 New Rental Request — ${itemName}`,
      text: [
        `New rental inquiry received on Scoot Your Boot Rentals!`,
        ``,
        `Item:       ${itemName}`,
        `Renter:     ${name}`,
        `Phone:      ${phone}`,
        `Email:      ${email || 'not provided'}`,
        `Dates:      ${dates || 'not provided'}`,
        `Est. Cost:  ${costLine}`,
        `Message:    ${msg || '(none)'}`,
        ``,
        `Log in to your admin panel to review and accept or decline.`,
      ].join('\n'),
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto">
          <div style="background:#1a1410;padding:20px 28px;border-radius:8px 8px 0 0">
            <h2 style="color:#fff;margin:0;font-size:1.2rem">📬 New Rental Request</h2>
            <p style="color:#d4c5a9;margin:4px 0 0;font-size:0.85rem">Scoot Your Boot Rentals · Provo, Utah</p>
          </div>
          <div style="border:1px solid #e5e0d8;border-top:none;border-radius:0 0 8px 8px;padding:24px 28px">
            <table style="width:100%;border-collapse:collapse;font-size:0.9rem">
              <tr><td style="padding:6px 0;color:#888;width:110px">Item</td><td style="padding:6px 0;font-weight:600">${itemName}</td></tr>
              <tr><td style="padding:6px 0;color:#888">Renter</td><td style="padding:6px 0">${name}</td></tr>
              <tr><td style="padding:6px 0;color:#888">Phone</td><td style="padding:6px 0">${phone}</td></tr>
              <tr><td style="padding:6px 0;color:#888">Email</td><td style="padding:6px 0">${email || '<em>not provided</em>'}</td></tr>
              <tr><td style="padding:6px 0;color:#888">Dates</td><td style="padding:6px 0">${dates || '<em>not provided</em>'}</td></tr>
              <tr><td style="padding:6px 0;color:#888">Est. Cost</td><td style="padding:6px 0;color:#c4501a;font-weight:600">${costLine}</td></tr>
              ${msg ? `<tr><td style="padding:6px 0;color:#888;vertical-align:top">Message</td><td style="padding:6px 0;font-style:italic">"${msg}"</td></tr>` : ''}
            </table>
            <div style="margin-top:20px;padding:14px;background:#f5f0e8;border-radius:6px;font-size:0.82rem;color:#555">
              Log in to your admin panel to review and respond to this request.
            </div>
          </div>
        </div>
      `,
    });

    console.log(`Notification sent to ${notifyEmail} for inquiry from ${name}`);
    return res.json({ ok: true, notified: true });

  } catch (err) {
    console.error('Inquiry notification error:', err);
    // Still return ok:true so the user's submission succeeds even if email fails
    return res.json({ ok: true, notified: false, warning: 'Email notification failed.' });
  }
});

/**
 * GET /api/health
 * Simple health check.
 */
app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'Scoot Your Boot Rentals', time: new Date().toISOString() });
});

// Catch-all: serve index.html for any unmatched route (SPA fallback)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🛴  Scoot Your Boot Rentals server running`);
  console.log(`   Local:  http://localhost:${PORT}`);
  console.log(`   Press Ctrl+C to stop\n`);
});
