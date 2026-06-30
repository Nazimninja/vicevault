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
    } else if (url.pathname === '/api/auth/send-otp' && request.method === 'POST') {
      response = await handleSendOTP(request, env);
    } else if (url.pathname === '/api/auth/verify-otp' && request.method === 'POST') {
      response = await handleVerifyOTP(request, env);
    } else if (url.pathname === '/api/auth/google' && request.method === 'POST') {
      response = await handleGoogleAuth(request, env);
    } else if (url.pathname === '/api/auth/discord' && request.method === 'POST') {
      response = await handleDiscordAuth(request, env);
    } else if (url.pathname === '/api/auth/cancel-subscription' && request.method === 'POST') {
      response = await handleCancelSubscription(request, env);
    } else if (url.pathname === '/api/pay/create-order' && request.method === 'POST') {
      response = await handleCreateOrder(request, env);
    } else if (url.pathname === '/api/pay/verify' && request.method === 'POST') {
      response = await handleVerifyPayment(request, env);
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
  async scheduled(event, env, ctx) {
    ctx.waitUntil(syncDiscordRoles(env));
  }
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

    // Send Discord Webhook
    if (env.DISCORD_WEBHOOK_URL) {
      try {
        await fetch(env.DISCORD_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            embeds: [{
              title: "⏳ New Waitlist Sign-up",
              color: 13935410, // 0xd4a332 in decimal
              fields: [
                { name: "Email", value: email, inline: true },
                { name: "Position", value: `#${position?.toLocaleString()}`, inline: true }
              ],
              timestamp: new Date().toISOString()
            }]
          })
        });
      } catch(err) { console.error("Webhook error:", err); }
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

// ─── AUTHENTICATION HANDLERS ────────────────────────────────
async function handleSendOTP(request, env) {
  try {
    const { email } = await request.json();
    const cleanEmail = (email || '').toLowerCase().trim();
    if (!isValidEmail(cleanEmail)) {
      return json({ error: 'Invalid email address' }, 400);
    }

    // Generate random 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Save in KV with TTL 300 seconds (5 minutes)
    await env.VICE_VAULT_KV.put(`otp:${cleanEmail}`, otp, { expirationTtl: 300 });

    // Send email via Resend
    if (env.RESEND_API_KEY) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: env.FROM_EMAIL || 'noreply@vicevault.linkwa.in',
          to: cleanEmail,
          subject: `${otp} is your Vice Vault verification code`,
          html: otpEmailHTML(otp),
        }),
      });
    } else {
      console.log(`Resend not configured. Generated OTP for ${cleanEmail}: ${otp}`);
    }

    return json({ success: true });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

async function handleVerifyOTP(request, env) {
  try {
    const { email, code, tierId } = await request.json();
    const cleanEmail = (email || '').toLowerCase().trim();
    const inputCode = (code || '').trim();

    if (!cleanEmail || !inputCode) {
      return json({ error: 'Missing email or code' }, 400);
    }

    const savedCode = await env.VICE_VAULT_KV.get(`otp:${cleanEmail}`);
    if (!savedCode || savedCode !== inputCode) {
      return json({ error: 'Invalid or expired verification code' }, 400);
    }

    // Delete code from KV
    await env.VICE_VAULT_KV.delete(`otp:${cleanEmail}`);

    let tier = 'pro';
    if (tierId === '199' || tierId === '299' || tierId === 'soldier') tier = 'soldier';
    if (tierId === '1199' || tierId === '999' || tierId === 'elite') tier = 'elite';

    const user = {
      email: cleanEmail,
      firstName: cleanEmail.split('@')[0],
      lastName: '',
      tier,
      subscribed: true,
      subscriptionExpiresAt: new Date(Date.now() + 30 * 86400 * 1000).toISOString(),
      joinedAt: new Date().toISOString()
    };

    // Preserve existing Discord ID if present in KV
    const existingStr = await env.VICE_VAULT_KV.get(`user:${cleanEmail}`);
    if (existingStr) {
      try {
        const existing = JSON.parse(existingStr);
        if (existing.discordUserId) {
          user.discordUserId = existing.discordUserId;
        }
      } catch(e) {}
    }

    await env.VICE_VAULT_KV.put(`user:${cleanEmail}`, JSON.stringify(user));

    // Send Discord Webhook
    if (env.DISCORD_WEBHOOK_URL) {
      try {
        await fetch(env.DISCORD_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            embeds: [{
              title: "🔑 User OTP Sign-in",
              color: 3093046, // 0x2f3136 in decimal
              fields: [
                { name: "Email", value: cleanEmail, inline: true },
                { name: "Tier", value: tier.toUpperCase(), inline: true }
              ],
              timestamp: new Date().toISOString()
            }]
          })
        });
      } catch(err) { console.error("Webhook error:", err); }
    }

    return json({ success: true, user });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

async function handleGoogleAuth(request, env) {
  try {
    const { token, tierId } = await request.json();
    if (!token) {
      return json({ error: 'Missing Google credential token' }, 400);
    }

    // Call Google OAuth Tokeninfo API to verify the token signature
    const googleRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${token}`);
    if (!googleRes.ok) {
      return json({ error: 'Invalid Google credential token' }, 400);
    }
    const payload = await googleRes.json();
    
    const email = (payload.email || '').toLowerCase().trim();
    const firstName = payload.given_name || '';
    const lastName = payload.family_name || '';

    let tier = 'pro';
    if (tierId === '199' || tierId === '299' || tierId === 'soldier') tier = 'soldier';
    if (tierId === '1199' || tierId === '999' || tierId === 'elite') tier = 'elite';

    const user = {
      email,
      firstName,
      lastName,
      tier,
      subscribed: true,
      subscriptionExpiresAt: new Date(Date.now() + 30 * 86400 * 1000).toISOString(),
      joinedAt: new Date().toISOString()
    };

    // Preserve existing Discord ID if present in KV
    const existingStr = await env.VICE_VAULT_KV.get(`user:${email}`);
    if (existingStr) {
      try {
        const existing = JSON.parse(existingStr);
        if (existing.discordUserId) {
          user.discordUserId = existing.discordUserId;
        }
      } catch(e) {}
    }

    await env.VICE_VAULT_KV.put(`user:${email}`, JSON.stringify(user));

    // Send Discord Webhook
    if (env.DISCORD_WEBHOOK_URL) {
      try {
        await fetch(env.DISCORD_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            embeds: [{
              title: "🌐 Google OAuth Sign-in",
              color: 4359924, // 0x4285f4 in decimal
              fields: [
                { name: "Name", value: `${firstName} ${lastName}`, inline: true },
                { name: "Email", value: email, inline: true },
                { name: "Tier", value: tier.toUpperCase(), inline: true }
              ],
              timestamp: new Date().toISOString()
            }]
          })
        });
      } catch(err) { console.error("Webhook error:", err); }
    }

    return json({ success: true, user });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

function otpEmailHTML(otp) {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body{margin:0;padding:0;background:#030308;font-family:'Barlow',Arial,sans-serif;color:#ede8df}
  .wrap{max-width:480px;margin:0 auto;padding:40px 20px}
  .logo{font-size:1.6rem;font-weight:900;letter-spacing:.14em;color:#d4a332;margin-bottom:2rem;font-family:Impact,sans-serif}
  .logo span{color:#ede8df}
  .card{background:#0d0d18;border:1px solid rgba(212,163,50,.2);border-radius:6px;padding:2.5rem;text-align:center;border-left:3px solid #d4a332}
  .title{font-size:1.4rem;font-weight:800;color:#ede8df;margin-bottom:.5rem}
  .sub{font-size:.88rem;color:#7a788a;line-height:1.7;margin-bottom:2rem}
  .otp-box{background:#131320;border:1px dashed rgba(212,163,50,.3);border-radius:4px;padding:1.2rem;font-size:2rem;font-weight:800;letter-spacing:.2em;color:#d4a332;margin:1.5rem 0;display:inline-block;padding-left:1.4em}
  .footer{font-size:.72rem;color:#2a2838;text-align:center;line-height:1.7;margin-top:2rem}
</style>
</head>
<body>
<div class="wrap">
  <div class="logo">VICE<span>VAULT</span></div>
  <div class="card">
    <div class="title">Verification Code</div>
    <div class="sub">Use the code below to complete your sign-in to Vice Vault. This code is valid for 5 minutes.</div>
    <div class="otp-box">${otp}</div>
    <div class="sub" style="margin-top:1.5rem;font-size:.78rem">If you did not request this code, you can safely ignore this email.</div>
  </div>
  <div class="footer">
    © 2025 Vice Vault · Not affiliated with Rockstar Games
  </div>
</div>
</body>
</html>`;
}

async function handleDiscordAuth(request, env) {
  try {
    const { code, redirectUri, tierId } = await request.json();
    if (!code || !redirectUri) {
      return json({ error: 'Missing code or redirectUri' }, 400);
    }

    // 1. Exchange code for access token
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.DISCORD_CLIENT_ID || '1521435317129842728',
        client_secret: env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const errData = await tokenResponse.text();
      return json({ error: 'Failed to exchange Discord authorization code: ' + errData }, 400);
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // 2. Fetch user profile from Discord
    const userResponse = await fetch('https://discord.com/api/users/@me', {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    if (!userResponse.ok) {
      return json({ error: 'Failed to fetch user details from Discord' }, 400);
    }

    const userData = await userResponse.json();
    const email = (userData.email || '').toLowerCase().trim();
    const username = userData.username || '';

    if (!email) {
      return json({ error: 'Your Discord account must have a verified email address to sign in.' }, 400);
    }

    // 3. Map tier ID
    let tier = 'pro';
    if (tierId === '199' || tierId === '299' || tierId === 'soldier') tier = 'soldier';
    if (tierId === '1199' || tierId === '999' || tierId === 'elite') tier = 'elite';

    const user = {
      email,
      firstName: username,
      lastName: '',
      tier,
      subscribed: true,
      subscriptionExpiresAt: new Date(Date.now() + 30 * 86400 * 1000).toISOString(),
      discordUserId: userData.id,
      joinedAt: new Date().toISOString()
    };

    await env.VICE_VAULT_KV.put(`user:${email}`, JSON.stringify(user));

    // 4. Auto-join server & assign roles if tier is Vault Pro/Elite
    if ((tier === 'pro' || tier === 'elite') && env.DISCORD_BOT_TOKEN && env.DISCORD_GUILD_ID && env.DISCORD_PRO_ROLE_ID) {
      try {
        const userId = userData.id;
        const guildId = env.DISCORD_GUILD_ID;
        const roleId = env.DISCORD_PRO_ROLE_ID;

        const rolesToAssign = [roleId];
        if (tier === 'elite' && env.DISCORD_ELITE_ROLE_ID) {
          rolesToAssign.push(env.DISCORD_ELITE_ROLE_ID);
        }

        // Try adding the member to the server with roles directly
        await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${userId}`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bot ${env.DISCORD_BOT_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            access_token: accessToken,
            roles: rolesToAssign
          })
        });
      } catch (err) {
        console.error("Auto-role error:", err);
      }
    }

    // Send Discord Webhook
    if (env.DISCORD_WEBHOOK_URL) {
      try {
        await fetch(env.DISCORD_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            embeds: [{
              title: "🎮 Discord OAuth Sign-in",
              color: 5793010, // 0x5865f2 in decimal
              fields: [
                { name: "Username", value: username, inline: true },
                { name: "Email", value: email, inline: true },
                { name: "Tier", value: tier.toUpperCase(), inline: true }
              ],
              timestamp: new Date().toISOString()
            }]
          })
        });
      } catch(err) { console.error("Webhook error:", err); }
    }

    return json({ success: true, user });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

async function handleCancelSubscription(request, env) {
  try {
    const { email } = await request.json();
    const cleanEmail = (email || '').toLowerCase().trim();
    if (!cleanEmail) {
      return json({ error: 'Missing email' }, 400);
    }

    const userStr = await env.VICE_VAULT_KV.get(`user:${cleanEmail}`);
    if (!userStr) {
      return json({ error: 'User profile not found' }, 400);
    }
    const user = JSON.parse(userStr);

    user.subscribed = false;
    user.subscriptionExpiresAt = new Date(0).toISOString(); // Expired
    await env.VICE_VAULT_KV.put(`user:${cleanEmail}`, JSON.stringify(user));

    // Remove roles on Discord immediately
    if (user.discordUserId && env.DISCORD_BOT_TOKEN && env.DISCORD_GUILD_ID) {
      const userId = user.discordUserId;
      const guildId = env.DISCORD_GUILD_ID;

      if (env.DISCORD_PRO_ROLE_ID) {
        await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${userId}/roles/${env.DISCORD_PRO_ROLE_ID}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bot ${env.DISCORD_BOT_TOKEN}` }
        });
      }
      if (env.DISCORD_ELITE_ROLE_ID) {
        await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${userId}/roles/${env.DISCORD_ELITE_ROLE_ID}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bot ${env.DISCORD_BOT_TOKEN}` }
        });
      }
      
      // Post webhook alert about cancellation role sync
      if (env.DISCORD_WEBHOOK_URL) {
        try {
          await fetch(env.DISCORD_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              embeds: [{
                title: "🚫 Subscription Cancelled & Roles Revoked",
                color: 16724590, // 0xff3d6e in decimal
                fields: [
                  { name: "Email", value: cleanEmail, inline: true },
                  { name: "Discord User ID", value: userId, inline: true }
                ],
                timestamp: new Date().toISOString()
              }]
            })
          });
        } catch(err) {}
      }
    }

    return json({ success: true, user });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

async function syncDiscordRoles(env) {
  try {
    if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_GUILD_ID) return;

    const listResult = await env.VICE_VAULT_KV.list({ prefix: "user:" });
    const now = new Date();

    for (const key of listResult.keys) {
      const userStr = await env.VICE_VAULT_KV.get(key.name);
      if (!userStr) continue;

      const user = JSON.parse(userStr);
      if (!user.discordUserId) continue;

      const isExpired = user.subscriptionExpiresAt && now > new Date(user.subscriptionExpiresAt);
      const isInactive = !user.subscribed || isExpired;

      if (isInactive) {
        const userId = user.discordUserId;
        const guildId = env.DISCORD_GUILD_ID;

        let roleRemoved = false;
        if (env.DISCORD_PRO_ROLE_ID) {
          const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${userId}/roles/${env.DISCORD_PRO_ROLE_ID}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bot ${env.DISCORD_BOT_TOKEN}` }
          });
          if (res.ok) roleRemoved = true;
        }
        if (env.DISCORD_ELITE_ROLE_ID) {
          const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${userId}/roles/${env.DISCORD_ELITE_ROLE_ID}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bot ${env.DISCORD_BOT_TOKEN}` }
          });
          if (res.ok) roleRemoved = true;
        }

        if (roleRemoved && env.DISCORD_WEBHOOK_URL) {
          try {
            await fetch(env.DISCORD_WEBHOOK_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                embeds: [{
                  title: "🧹 Automated Role Clean-up",
                  color: 16724590, // Red
                  fields: [
                    { name: "User", value: user.email, inline: true },
                    { name: "Reason", value: "Subscription Expired", inline: true }
                  ],
                  timestamp: new Date().toISOString()
                }]
              })
            });
          } catch(err) {}
        }
      }
    }
  } catch (err) {
    console.error("Scheduled sync error:", err);
  }
}

// ─── RAZORPAY: CREATE ORDER ────────────────────────────────
async function handleCreateOrder(request, env) {
  try {
    const { tier } = await request.json();

    // Price map in paise (INR × 100)
    const PRICES = {
      soldier: 29900,  // ₹299
      pro:     69900,  // ₹699
      elite:   99900,  // ₹999
    };

    const amount = PRICES[tier];
    if (!amount) {
      return json({ error: 'Invalid tier. Must be soldier, pro, or elite.' }, 400);
    }

    if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
      return json({ error: 'Payment gateway not configured.' }, 500);
    }

    const credentials = btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);

    const rzpRes = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        amount,
        currency: 'INR',
        receipt: `vv_${tier}_${Date.now()}`,
        payment_capture: 1
      })
    });

    if (!rzpRes.ok) {
      const err = await rzpRes.text();
      return json({ error: 'Failed to create Razorpay order: ' + err }, 500);
    }

    const order = await rzpRes.json();
    return json({
      success: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: env.RAZORPAY_KEY_ID
    });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

// ─── RAZORPAY: VERIFY PAYMENT ──────────────────────────────
async function handleVerifyPayment(request, env) {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, email, tier, firstName, lastName } = await request.json();

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return json({ error: 'Missing payment verification fields' }, 400);
    }
    if (!email) {
      return json({ error: 'Missing email' }, 400);
    }

    // Verify HMAC SHA256 signature
    const message = `${razorpay_order_id}|${razorpay_payment_id}`;
    const encoder = new TextEncoder();
    const keyData = encoder.encode(env.RAZORPAY_KEY_SECRET);
    const msgData = encoder.encode(message);

    const cryptoKey = await crypto.subtle.importKey(
      'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
    const expectedSignature = Array.from(new Uint8Array(signatureBuffer))
      .map(b => b.toString(16).padStart(2, '0')).join('');

    if (expectedSignature !== razorpay_signature) {
      return json({ error: 'Payment verification failed — invalid signature.' }, 400);
    }

    // Payment is valid — activate subscription
    const cleanEmail = email.toLowerCase().trim();
    let tierName = 'pro';
    if (tier === 'soldier' || tier === '199' || tier === '299') tierName = 'soldier';
    if (tier === 'elite' || tier === '1199' || tier === '999') tierName = 'elite';

    const existingStr = await env.VICE_VAULT_KV.get(`user:${cleanEmail}`);
    let user = existingStr ? JSON.parse(existingStr) : {};

    user = {
      ...user,
      email: cleanEmail,
      firstName: firstName || user.firstName || cleanEmail.split('@')[0],
      lastName: lastName || user.lastName || '',
      tier: tierName,
      subscribed: true,
      subscriptionExpiresAt: new Date(Date.now() + 30 * 86400 * 1000).toISOString(),
      lastPaymentId: razorpay_payment_id,
      lastOrderId: razorpay_order_id,
      joinedAt: user.joinedAt || new Date().toISOString()
    };

    await env.VICE_VAULT_KV.put(`user:${cleanEmail}`, JSON.stringify(user));

    // Send Discord Webhook alert
    if (env.DISCORD_WEBHOOK_URL) {
      try {
        await fetch(env.DISCORD_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            embeds: [{
              title: '💳 New Payment Received!',
              color: 3329330, // Green
              fields: [
                { name: 'Email', value: cleanEmail, inline: true },
                { name: 'Tier', value: tierName.toUpperCase(), inline: true },
                { name: 'Payment ID', value: razorpay_payment_id, inline: false }
              ],
              timestamp: new Date().toISOString()
            }]
          })
        });
      } catch(err) {}
    }

    return json({ success: true, user });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
