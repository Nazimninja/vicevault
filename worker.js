/**
 * ═══════════════════════════════════════════════════════════
 * VICE VAULT — CLOUDFLARE WORKER
 * Newsletter signup + Waitlist handler
 * Deploy at: workers.dev / vicevault.linkwa.in/api/*
 *
 * KV Namespace binding: VICE_VAULT_KV
 * Environment variables needed:
 *   RESEND_API_KEY    — from resend.com (free tier: 3000 emails/mo)
 *   FROM_EMAIL        — noreply@vicevault.linkwa.in
 *   ADMIN_EMAIL       — your@email.com
 *
 * Deploy steps:
 *   1. npm install -g wrangler
 *   2. wrangler login
 *   3. wrangler kv:namespace create "VICE_VAULT_KV"
 *   4. Add the namespace ID to wrangler.toml
 *   5. wrangler secret put RESEND_API_KEY
 *   6. wrangler deploy
 * ═══════════════════════════════════════════════════════════
 */

// ─── CORS HEADERS ──────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin': 'https://vicevault.linkwa.in',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function getCorsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const headers = {
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
  if (origin === 'https://vicevault.linkwa.in' || origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
    headers['Access-Control-Allow-Origin'] = origin;
  } else {
    headers['Access-Control-Allow-Origin'] = 'https://vicevault.linkwa.in';
  }
  return headers;
}

// ─── MAIN HANDLER ──────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const corsHeaders = getCorsHeaders(request);

    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    let response;
    // Route
    if (url.pathname === '/api/waitlist' && request.method === 'POST') {
      response = await handleWaitlist(request, env);
    } else if (url.pathname === '/api/newsletter' && request.method === 'POST') {
      response = await handleNewsletter(request, env);
    } else if (url.pathname === '/api/stats' && request.method === 'GET') {
      response = await handleStats(env);
    } else {
      response = json({ error: 'Not found' }, 404);
    }

    // Inject dynamic CORS headers
    const newHeaders = new Headers(response.headers);
    for (const [key, value] of Object.entries(corsHeaders)) {
      newHeaders.set(key, value);
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  },
};

// ─── WAITLIST HANDLER ──────────────────────────────────────
async function handleWaitlist(request, env) {
  try {
    const body = await request.json();
    const email = (body.email || '').toLowerCase().trim();

    // Validate
    if (!isValidEmail(email)) {
      return json({ error: 'Invalid email address' }, 400);
    }

    // Check duplicate
    const existing = await env.VICE_VAULT_KV.get(`waitlist:${email}`);
    if (existing) {
      const data = JSON.parse(existing);
      return json({
        success: true,
        duplicate: true,
        position: data.position,
        message: "You're already on the list!",
      });
    }

    // Get current count
    const countRaw = await env.VICE_VAULT_KV.get('waitlist:count');
    const count = countRaw ? parseInt(countRaw) : 12847;
    const position = count + 1;

    // Store subscriber
    const subscriber = {
      email,
      position,
      joinedAt: new Date().toISOString(),
      source: body.source || 'website',
      tier: body.tier || null,
    };

    await env.VICE_VAULT_KV.put(`waitlist:${email}`, JSON.stringify(subscriber));
    await env.VICE_VAULT_KV.put('waitlist:count', String(position));

    // Also add to newsletter list
    await env.VICE_VAULT_KV.put(`newsletter:${email}`, JSON.stringify({
      email,
      subscribedAt: new Date().toISOString(),
      source: 'waitlist',
      active: true,
    }));

    // Send welcome email
    await sendWelcomeEmail(email, position, env, 'waitlist');

    // Notify admin every 100 signups
    if (position % 100 === 0) {
      await sendAdminNotification(position, env);
    }

    return json({
      success: true,
      position,
      message: `You're #${position.toLocaleString()} on the list! Check your email.`,
    });

  } catch (err) {
    console.error('Waitlist error:', err);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
}

// ─── NEWSLETTER HANDLER ─────────────────────────────────────
async function handleNewsletter(request, env) {
  try {
    const body = await request.json();
    const email = (body.email || '').toLowerCase().trim();

    if (!isValidEmail(email)) {
      return json({ error: 'Invalid email address' }, 400);
    }

    const existing = await env.VICE_VAULT_KV.get(`newsletter:${email}`);
    if (existing) {
      return json({ success: true, duplicate: true, message: "You're already subscribed!" });
    }

    const subscriber = {
      email,
      subscribedAt: new Date().toISOString(),
      source: body.source || 'newsletter-form',
      active: true,
    };

    await env.VICE_VAULT_KV.put(`newsletter:${email}`, JSON.stringify(subscriber));

    // Get + increment newsletter count
    const nlCountRaw = await env.VICE_VAULT_KV.get('newsletter:count');
    const nlCount = nlCountRaw ? parseInt(nlCountRaw) + 1 : 1;
    await env.VICE_VAULT_KV.put('newsletter:count', String(nlCount));

    // Send welcome email
    await sendWelcomeEmail(email, null, env, 'newsletter');

    return json({
      success: true,
      message: 'Subscribed! First drop arrives Thursday at 6PM IST.',
    });

  } catch (err) {
    console.error('Newsletter error:', err);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
}

// ─── STATS HANDLER ─────────────────────────────────────────
async function handleStats(env) {
  try {
    const wlCount = await env.VICE_VAULT_KV.get('waitlist:count') || '12847';
    const nlCount = await env.VICE_VAULT_KV.get('newsletter:count') || '0';
    return json({ waitlist: parseInt(wlCount), newsletter: parseInt(nlCount) });
  } catch {
    return json({ waitlist: 12847, newsletter: 0 });
  }
}

// ─── SEND WELCOME EMAIL ─────────────────────────────────────
async function sendWelcomeEmail(email, position, env, type) {
  if (!env.RESEND_API_KEY) return; // Skip if no key configured

  const isWaitlist = type === 'waitlist';
  const subject = isWaitlist
    ? `You're #${position?.toLocaleString()} on the Vice Vault waitlist 🔐`
    : `Vice Vault Intel — first drop arrives Thursday 🎯`;

  const html = isWaitlist ? waitlistEmailHTML(position) : newsletterEmailHTML();

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.FROM_EMAIL || 'noreply@vicevault.linkwa.in',
        to: email,
        subject,
        html,
      }),
    });
  } catch (err) {
    console.error('Email send error:', err);
    // Don't fail the request if email fails
  }
}

// ─── ADMIN NOTIFICATION ─────────────────────────────────────
async function sendAdminNotification(count, env) {
  if (!env.RESEND_API_KEY || !env.ADMIN_EMAIL) return;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.FROM_EMAIL || 'noreply@vicevault.linkwa.in',
        to: env.ADMIN_EMAIL,
        subject: `🎯 Vice Vault waitlist hit ${count.toLocaleString()} signups`,
        html: `<p>Vice Vault waitlist just crossed <strong>${count.toLocaleString()}</strong> signups. Keep going!</p>`,
      }),
    });
  } catch {}
}

// ─── EMAIL TEMPLATES ────────────────────────────────────────
function waitlistEmailHTML(position) {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body{margin:0;padding:0;background:#030308;font-family:'Barlow',Arial,sans-serif;color:#ede8df}
  .wrap{max-width:560px;margin:0 auto;padding:40px 20px}
  .logo{font-size:1.6rem;font-weight:900;letter-spacing:.14em;color:#d4a332;margin-bottom:2rem;font-family:Impact,sans-serif}
  .logo span{color:#ede8df}
  .hero-box{background:#0d0d18;border:1px solid rgba(212,163,50,.25);border-radius:6px;padding:2rem;margin-bottom:1.5rem;text-align:center}
  .hb-num{font-size:4rem;font-weight:900;color:#d4a332;line-height:1;font-family:Impact,sans-serif;margin-bottom:.5rem}
  .hb-label{font-size:.75rem;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#7a788a;margin-bottom:1rem}
  .hb-title{font-size:1.3rem;font-weight:800;color:#ede8df;margin-bottom:.5rem}
  .hb-sub{font-size:.88rem;color:#7a788a;line-height:1.7}
  .section{margin-bottom:1.5rem}
  .section-title{font-size:.65rem;font-weight:800;letter-spacing:.2em;text-transform:uppercase;color:#d4a332;margin-bottom:.8rem;padding-bottom:.5rem;border-bottom:1px solid rgba(255,255,255,.07)}
  .feature-list{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:.5rem}
  .feature-list li{display:flex;align-items:flex-start;gap:.6rem;font-size:.86rem;color:#9a98aa;line-height:1.6}
  .feature-list li::before{content:'✓';color:#00d4aa;font-weight:700;flex-shrink:0}
  .btn{display:block;background:#d4a332;color:#030308;font-weight:800;text-decoration:none;text-align:center;padding:.9rem 2rem;border-radius:3px;font-size:.88rem;letter-spacing:.1em;text-transform:uppercase;margin:1.5rem 0}
  .footer{font-size:.72rem;color:#2a2838;text-align:center;line-height:1.7;margin-top:2rem}
</style>
</head>
<body>
<div class="wrap">
  <div class="logo">VICE<span>VAULT</span></div>
  <div class="hero-box">
    <div class="hb-num">#${position?.toLocaleString()}</div>
    <div class="hb-label">Your waitlist position</div>
    <div class="hb-title">You're in the vault 🔐</div>
    <div class="hb-sub">We'll email you 24 hours before Vice Vault launches with your early access link. No spam between now and then — just the launch email.</div>
  </div>
  <div class="section">
    <div class="section-title">What you get on launch day</div>
    <ul class="feature-list">
      <li>24-hour early access before the public launch</li>
      <li>Launch-day pricing locked in — same rate forever</li>
      <li>First weekly Thursday drop the moment we go live</li>
      <li>Access to all 11 sections — 320+ guides at launch</li>
      <li>Discord crew access (Vault Pro and Elite members)</li>
    </ul>
  </div>
  <div class="section">
    <div class="section-title">While you wait</div>
    <ul class="feature-list">
      <li>Share Vice Vault to move up the waitlist</li>
      <li>Follow us on X @vicevaultgg for pre-launch intel drops</li>
      <li>Join our Discord for early community access</li>
    </ul>
  </div>
  <a href="https://vicevault.linkwa.in" class="btn">Visit Vice Vault →</a>
  <div class="footer">
    © 2025 Vice Vault · Not affiliated with Rockstar Games or Take-Two Interactive<br>
    You're receiving this because you joined the Vice Vault waitlist.<br>
    <a href="https://vicevault.linkwa.in/unsubscribe" style="color:#7a788a">Unsubscribe</a>
  </div>
</div>
</body>
</html>`;
}

function newsletterEmailHTML() {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body{margin:0;padding:0;background:#030308;font-family:'Barlow',Arial,sans-serif;color:#ede8df}
  .wrap{max-width:560px;margin:0 auto;padding:40px 20px}
  .logo{font-size:1.6rem;font-weight:900;letter-spacing:.14em;color:#d4a332;margin-bottom:2rem;font-family:Impact,sans-serif}
  .logo span{color:#ede8df}
  .hero-box{background:#0d0d18;border:1px solid rgba(0,212,170,.2);border-radius:6px;padding:2rem;margin-bottom:1.5rem;text-align:center;border-left:3px solid #00d4aa}
  .hb-icon{font-size:2.5rem;margin-bottom:.8rem}
  .hb-title{font-size:1.3rem;font-weight:800;color:#ede8df;margin-bottom:.5rem}
  .hb-sub{font-size:.88rem;color:#7a788a;line-height:1.7}
  .section-title{font-size:.65rem;font-weight:800;letter-spacing:.2em;text-transform:uppercase;color:#d4a332;margin-bottom:.8rem;padding-bottom:.5rem;border-bottom:1px solid rgba(255,255,255,.07)}
  .drop-preview{background:#131320;border-radius:4px;padding:1.2rem;margin:1rem 0}
  .dp-label{font-size:.62rem;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#d4a332;margin-bottom:.5rem}
  .dp-title{font-size:.9rem;font-weight:700;color:#ede8df;margin-bottom:.3rem}
  .dp-meta{font-size:.75rem;color:#7a788a}
  .btn{display:block;background:#d4a332;color:#030308;font-weight:800;text-decoration:none;text-align:center;padding:.9rem 2rem;border-radius:3px;font-size:.88rem;letter-spacing:.1em;text-transform:uppercase;margin:1.5rem 0}
  .footer{font-size:.72rem;color:#2a2838;text-align:center;line-height:1.7;margin-top:2rem}
</style>
</head>
<body>
<div class="wrap">
  <div class="logo">VICE<span>VAULT</span></div>
  <div class="hero-box">
    <div class="hb-icon">🎯</div>
    <div class="hb-title">You're on the intel list</div>
    <div class="hb-sub">Every Thursday at 6PM IST — the best GTA 6 money routes, meta shifts, new cheat codes, and secrets discovered that week. Straight to your inbox.</div>
  </div>
  <div class="section-title">Your first drop includes</div>
  <div class="drop-preview"><div class="dp-label">Heist Blueprint</div><div class="dp-title">Vice City Bank Job — Silent approach, $4.2M max take</div><div class="dp-meta">New this week · 14 min read</div></div>
  <div class="drop-preview"><div class="dp-label">Money Meta</div><div class="dp-title">$800K/hr passive: the business stacking method</div><div class="dp-meta">Updated · 8 min read</div></div>
  <div class="drop-preview"><div class="dp-label">Cheat Vault</div><div class="dp-title">3 new cheat codes confirmed this week — PS5 & Xbox</div><div class="dp-meta">All verified</div></div>
  <a href="https://vicevault.linkwa.in/weekly" class="btn">See this week's drop →</a>
  <div class="footer">
    © 2025 Vice Vault · Not affiliated with Rockstar Games<br>
    <a href="https://vicevault.linkwa.in/unsubscribe" style="color:#7a788a">Unsubscribe</a>
  </div>
</div>
</body>
</html>`;
}

// ─── HELPERS ────────────────────────────────────────────────
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}
