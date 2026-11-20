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
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

function getCorsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const headers = {
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };
  if (origin === 'https://vicevault.linkwa.in' || origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
    headers['Access-Control-Allow-Origin'] = origin;
  } else {
    headers['Access-Control-Allow-Origin'] = 'https://vicevault.linkwa.in';
  }
  return headers;
}

// ─── CRYPTO HELPERS ────────────────────────────────────────
function toHex(buffer) {
  return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmacHex(secret, message) {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return toHex(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message)));
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function b64urlEncode(str) {
  return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return decodeURIComponent(escape(atob(s)));
}

// ─── SESSION TOKENS ────────────────────────────────────────
// Stateless signed tokens: base64url({e: email, exp}) + "." + HMAC-SHA256.
// The server derives the user's identity ONLY from a valid token — never from
// an email address sent in the request body.
const SESSION_TTL_SECONDS = 30 * 86400; // 30 days

function getSessionSecret(env) {
  return env.SESSION_SECRET || env.ADMIN_SECRET || null;
}

async function createSessionToken(email, env) {
  const secret = getSessionSecret(env);
  if (!secret) throw new Error('Server auth is not configured (SESSION_SECRET missing)');
  const payload = b64urlEncode(JSON.stringify({ e: email, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS }));
  const sig = await hmacHex(secret, 'session.' + payload);
  return `${payload}.${sig}`;
}

async function verifySessionToken(token, env) {
  const secret = getSessionSecret(env);
  if (!secret || typeof token !== 'string') return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = await hmacHex(secret, 'session.' + payload);
  if (!timingSafeEqual(expected, sig)) return null;
  try {
    const data = JSON.parse(b64urlDecode(payload));
    if (!data.e || !data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    return String(data.e).toLowerCase().trim();
  } catch (e) {
    return null;
  }
}

async function getSessionEmail(request, env) {
  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  return verifySessionToken(match[1].trim(), env);
}

function isAdminEmail(email, env) {
  return !!(email && env.ADMIN_EMAIL && email === env.ADMIN_EMAIL.toLowerCase().trim());
}

function hasActiveAccess(user) {
  if (!user) return false;
  if (user.subscribed) return true;
  const expiresAt = user.subscriptionExpiresAt ? new Date(user.subscriptionExpiresAt) : null;
  return !!(expiresAt && new Date() <= expiresAt); // 7-day grace period
}

// Strip secrets (password hash etc.) before sending a user record to a browser
function publicUser(user) {
  if (!user) return null;
  const { passwordHash, passwordSalt, ...rest } = user;
  return rest;
}

// Standard response for every successful sign-in: safe user + fresh session token.
// Admins get isAdmin + adminToken (the same session token) so admin.html keeps working.
async function authSuccess(user, env) {
  const sessionToken = await createSessionToken(user.email, env);
  const out = publicUser(user);
  if (isAdminEmail(user.email, env)) {
    out.isAdmin = true;
    out.adminToken = sessionToken;
  }
  return json({ success: true, user: out, sessionToken });
}

// ─── PASSWORD HASHING (PBKDF2, salted) ─────────────────────
const PBKDF2_ITERATIONS = 100000; // Workers runtime maximum

async function pbkdf2Hex(password, saltHex) {
  const encoder = new TextEncoder();
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map(h => parseInt(h, 16)));
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS }, keyMaterial, 256
  );
  return toHex(bits);
}

async function createPasswordHash(password) {
  const saltHex = toHex(crypto.getRandomValues(new Uint8Array(16)));
  return `pbkdf2$${PBKDF2_ITERATIONS}$${saltHex}$${await pbkdf2Hex(password, saltHex)}`;
}

// Returns { ok, needsUpgrade }. Legacy accounts stored an unsalted SHA-256 hex digest.
async function verifyPassword(password, stored) {
  if (!stored) return { ok: false };
  if (stored.startsWith('pbkdf2$')) {
    const [, , saltHex, hash] = stored.split('$');
    return { ok: timingSafeEqual(await pbkdf2Hex(password, saltHex), hash), needsUpgrade: false };
  }
  const legacy = toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password)));
  return { ok: timingSafeEqual(legacy, stored), needsUpgrade: true };
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
    } else if (url.pathname === '/api/auth/register' && request.method === 'POST') {
      response = await handleRegister(request, env);
    } else if (url.pathname === '/api/auth/login' && request.method === 'POST') {
      response = await handleLogin(request, env);
    } else if (url.pathname === '/api/auth/cancel-subscription' && request.method === 'POST') {
      response = await handleCancelSubscription(request, env);
    } else if (url.pathname === '/api/auth/status' && request.method === 'POST') {
      response = await handleUserStatus(request, env);
    } else if (url.pathname === '/api/pay/create-order' && request.method === 'POST') {
      response = await handleCreateOrder(request, env);
    } else if (url.pathname === '/api/pay/verify' && request.method === 'POST') {
      response = await handleVerifyPayment(request, env);
    } else if (url.pathname.startsWith('/api/admin/')) {
      if (!getSessionSecret(env) || !env.ADMIN_EMAIL) {
        response = json({ error: 'Admin configuration missing' }, 500);
      } else {
        const sessionEmail = await getSessionEmail(request, env);
        if (!isAdminEmail(sessionEmail, env)) {
          response = json({ error: 'Unauthorized' }, 401);
        } else {
          if (url.pathname === '/api/admin/stats' && request.method === 'GET') {
            response = await handleAdminStats(env);
          } else if (url.pathname === '/api/admin/users' && request.method === 'GET') {
            response = await handleAdminUsers(env);
          } else if (url.pathname === '/api/admin/waitlist' && request.method === 'GET') {
            response = await handleAdminWaitlist(env);
          } else if (url.pathname === '/api/admin/update-user' && request.method === 'POST') {
            response = await handleAdminUpdateUser(request, env);
          } else if (url.pathname === '/api/admin/delete-user' && request.method === 'POST') {
            response = await handleAdminDeleteUser(request, env);
          } else {
            response = json({ error: 'Not found' }, 404);
          }
        }
      }
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
async function sendWelcomeEmail(email, details, env, type) {
  if (!env.RESEND_API_KEY) return; // Skip if no key configured

  const isWaitlist = type === 'waitlist';
  const isPremium = type === 'premium';
  
  let subject = `Vice Vault Intel — first drop arrives Thursday 🎯`;
  if (isWaitlist) {
    subject = `You're #${details?.toLocaleString()} on the Vice Vault waitlist 🔐`;
  } else if (isPremium) {
    const tierName = details === 'elite' ? 'Elite Crew' : (details === 'soldier' ? 'Soldier' : 'Vault Pro');
    subject = `Welcome to the Vault, ${tierName}! Your access is activated 🔑`;
  }

  let html;
  if (isWaitlist) {
    html = waitlistEmailHTML(details);
  } else if (isPremium) {
    html = premiumEmailHTML(details);
  } else {
    html = newsletterEmailHTML();
  }

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
  .logo{font-size:1.6rem;font-weight:900;letter-spacing:.14em;color:#0070f3;margin-bottom:2rem;font-family:Impact,sans-serif}
  .logo span{color:#ede8df}
  .hero-box{background:#0d0d18;border:1px solid rgba(0,112,243,.25);border-radius:6px;padding:2rem;margin-bottom:1.5rem;text-align:center}
  .hb-num{font-size:4rem;font-weight:900;color:#0070f3;line-height:1;font-family:Impact,sans-serif;margin-bottom:.5rem}
  .hb-label{font-size:.75rem;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#7a788a;margin-bottom:1rem}
  .hb-title{font-size:1.3rem;font-weight:800;color:#ede8df;margin-bottom:.5rem}
  .hb-sub{font-size:.88rem;color:#7a788a;line-height:1.7}
  .section{margin-bottom:1.5rem}
  .section-title{font-size:.65rem;font-weight:800;letter-spacing:.2em;text-transform:uppercase;color:#0070f3;margin-bottom:.8rem;padding-bottom:.5rem;border-bottom:1px solid rgba(255,255,255,.07)}
  .feature-list{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:.5rem}
  .feature-list li{display:flex;align-items:flex-start;gap:.6rem;font-size:.86rem;color:#9a98aa;line-height:1.6}
  .feature-list li::before{content:'✓';color:#00d4aa;font-weight:700;flex-shrink:0}
  .btn{display:block;background:#0070f3;color:#030308;font-weight:800;text-decoration:none;text-align:center;padding:.9rem 2rem;border-radius:3px;font-size:.88rem;letter-spacing:.1em;text-transform:uppercase;margin:1.5rem 0}
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
  .logo{font-size:1.6rem;font-weight:900;letter-spacing:.14em;color:#0070f3;margin-bottom:2rem;font-family:Impact,sans-serif}
  .logo span{color:#ede8df}
  .hero-box{background:#0d0d18;border:1px solid rgba(0,212,170,.2);border-radius:6px;padding:2rem;margin-bottom:1.5rem;text-align:center;border-left:3px solid #00d4aa}
  .hb-icon{font-size:2.5rem;margin-bottom:.8rem}
  .hb-title{font-size:1.3rem;font-weight:800;color:#ede8df;margin-bottom:.5rem}
  .hb-sub{font-size:.88rem;color:#7a788a;line-height:1.7}
  .section-title{font-size:.65rem;font-weight:800;letter-spacing:.2em;text-transform:uppercase;color:#0070f3;margin-bottom:.8rem;padding-bottom:.5rem;border-bottom:1px solid rgba(255,255,255,.07)}
  .drop-preview{background:#131320;border-radius:4px;padding:1.2rem;margin:1rem 0}
  .dp-label{font-size:.62rem;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#0070f3;margin-bottom:.5rem}
  .dp-title{font-size:.9rem;font-weight:700;color:#ede8df;margin-bottom:.3rem}
  .dp-meta{font-size:.75rem;color:#7a788a}
  .btn{display:block;background:#0070f3;color:#030308;font-weight:800;text-decoration:none;text-align:center;padding:.9rem 2rem;border-radius:3px;font-size:.88rem;letter-spacing:.1em;text-transform:uppercase;margin:1.5rem 0}
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

function premiumEmailHTML(tier) {
  const tierName = tier === 'elite' ? 'Elite Crew' : (tier === 'soldier' ? 'Soldier' : 'Vault Pro');
  const priceLabel = tier === 'elite' ? '₹999/yr' : (tier === 'soldier' ? '₹299/mo' : '₹699/mo');
  const badgeColor = tier === 'elite' ? '#00a3ff' : (tier === 'soldier' ? '#7a788a' : '#0070f3');

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Welcome to Vice Vault</title></head>
<body style="background-color:#030308;color:#ede8df;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:40px 20px;text-align:center">
  <div style="max-width:520px;margin:0 auto;background-color:#131320;border:1px solid rgba(255,255,255,0.07);border-radius:6px;padding:40px 30px;box-shadow:0 10px 30px rgba(0,0,0,0.5)">
    <div style="font-size:1.6rem;font-weight:900;letter-spacing:4px;color:#ffffff;margin-bottom:30px;font-family:'Impact',sans-serif">
      <span style="color:#0070f3">VICE</span>VAULT
    </div>
    <div style="font-size:45px;margin-bottom:20px">👑</div>
    <h1 style="font-size:22px;font-weight:800;color:#ffffff;margin:0 0 10px 0;text-transform:uppercase;letter-spacing:1px">Access Granted</h1>
    <p style="font-size:13px;color:#7a788a;line-height:1.6;margin:0 0 25px 0">Your premium subscription is live. Welcome to the ultimate GTA 6 intelligence hub.</p>
    <div style="background-color:#0d0d18;border:1px solid rgba(255,255,255,0.05);border-radius:4px;padding:18px;margin-bottom:30px;text-align:center">
      <div style="font-size:10px;font-weight:800;letter-spacing:2px;color:#7a788a;text-transform:uppercase;margin-bottom:5px">Active Plan</div>
      <div style="font-size:18px;font-weight:800;color:${badgeColor};text-transform:uppercase;margin-bottom:3px">${tierName}</div>
      <div style="font-size:12px;color:#7a788a">${priceLabel} · cancel anytime</div>
    </div>
    <h2 style="font-size:13px;font-weight:800;color:#ffffff;margin:0 0 15px 0;text-transform:uppercase;letter-spacing:1px;text-align:left;border-bottom:1px solid rgba(255,255,255,0.05);padding-bottom:8px">Next Steps</h2>
    <div style="text-align:left;margin-bottom:20px">
      <div style="font-size:13px;font-weight:700;color:#ffffff;margin-bottom:3px">1. Access your Dashboard 🗺️</div>
      <p style="font-size:12px;color:#7a788a;line-height:1.6;margin:0">Log in to view heist blueprints, vehicle speed stats, wanted level escape routes, and property guides.</p>
    </div>
    <div style="text-align:left;margin-bottom:30px">
      <div style="font-size:13px;font-weight:700;color:#ffffff;margin-bottom:3px">2. Connect your Discord 🎮</div>
      <p style="font-size:12px;color:#7a788a;line-height:1.6;margin:0">Link Discord in your account settings to instantly receive your premium crew roles and access locked crew-only channels.</p>
    </div>
    <a href="https://vicevault.linkwa.in/dashboard.html" style="display:inline-block;background-color:#0070f3;color:#030308;font-size:13px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;padding:14px 35px;border-radius:2px;text-decoration:none;margin-bottom:30px">Go to Dashboard →</a>
    <div style="font-size:11px;color:#7a788a;border-top:1px solid rgba(255,255,255,0.05);padding-top:20px;line-height:1.6;text-align:center">
      Got questions? Hit us up at support@vicevault.linkwa.in. Subscriptions auto-renew but you can cancel anytime with a single click from your dashboard.
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

    // Basic resend throttle: one code per email per minute (matches the signup page countdown)
    if (await env.VICE_VAULT_KV.get(`otp_cooldown:${cleanEmail}`)) {
      return json({ error: 'Please wait a minute before requesting another code.' }, 429);
    }

    // Generate cryptographically random 6-digit OTP
    const otp = (100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000)).toString();

    // Save in KV with TTL 300 seconds (5 minutes); a new code resets the attempt counter
    await env.VICE_VAULT_KV.put(`otp:${cleanEmail}`, otp, { expirationTtl: 300 });
    await env.VICE_VAULT_KV.delete(`otp_attempts:${cleanEmail}`);
    await env.VICE_VAULT_KV.put(`otp_cooldown:${cleanEmail}`, '1', { expirationTtl: 60 });

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
    if (!savedCode || !timingSafeEqual(savedCode, inputCode)) {
      if (savedCode) {
        // Max 5 wrong guesses per code, then the code is burned
        const attempts = parseInt(await env.VICE_VAULT_KV.get(`otp_attempts:${cleanEmail}`) || '0', 10) + 1;
        if (attempts >= 5) {
          await env.VICE_VAULT_KV.delete(`otp:${cleanEmail}`);
          await env.VICE_VAULT_KV.delete(`otp_attempts:${cleanEmail}`);
          return json({ error: 'Too many incorrect attempts. Please request a new code.' }, 429);
        }
        await env.VICE_VAULT_KV.put(`otp_attempts:${cleanEmail}`, String(attempts), { expirationTtl: 300 });
      }
      return json({ error: 'Invalid or expired verification code' }, 400);
    }

    // Delete code from KV
    await env.VICE_VAULT_KV.delete(`otp:${cleanEmail}`);
    await env.VICE_VAULT_KV.delete(`otp_attempts:${cleanEmail}`);

    let tier = 'pro';
    if (tierId === '199' || tierId === '299' || tierId === 'soldier') tier = 'soldier';
    if (tierId === '1199' || tierId === '999' || tierId === 'elite') tier = 'elite';

    const user = {
      email: cleanEmail,
      firstName: cleanEmail.split('@')[0],
      lastName: '',
      tier,
      subscribed: false,
      subscriptionExpiresAt: '',
      joinedAt: new Date().toISOString()
    };

    // Preserve existing Discord ID, password hash, and subscription status if present in KV
    const existingStr = await env.VICE_VAULT_KV.get(`user:${cleanEmail}`);
    if (existingStr) {
      try {
        const existing = JSON.parse(existingStr);
        user.subscribed = existing.subscribed !== undefined ? existing.subscribed : false;
        if (existing.firstName) user.firstName = existing.firstName;
        if (existing.lastName) user.lastName = existing.lastName;
        if (existing.tier) user.tier = existing.tier;
        if (existing.discordUserId) user.discordUserId = existing.discordUserId;
        if (existing.passwordHash) user.passwordHash = existing.passwordHash;
        if (existing.subscriptionExpiresAt) user.subscriptionExpiresAt = existing.subscriptionExpiresAt;
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

    return await authSuccess(user, env);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

const DEFAULT_GOOGLE_CLIENT_ID = '804858392117-7pmts3ffsa30f7to3jggnh4m49evc7a0.apps.googleusercontent.com';

async function handleGoogleAuth(request, env) {
  try {
    const { token, tierId } = await request.json();
    if (!token) {
      return json({ error: 'Missing Google credential token' }, 400);
    }

    // Call Google OAuth Tokeninfo API to verify the token signature
    const googleRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`);
    if (!googleRes.ok) {
      return json({ error: 'Invalid Google credential token' }, 400);
    }
    const payload = await googleRes.json();

    // The token must have been issued for OUR app, to a verified email address
    const expectedAud = env.GOOGLE_CLIENT_ID || DEFAULT_GOOGLE_CLIENT_ID;
    if (payload.aud !== expectedAud) {
      return json({ error: 'Google token was not issued for Vice Vault' }, 400);
    }
    if (payload.email_verified !== true && payload.email_verified !== 'true') {
      return json({ error: 'Your Google email address is not verified' }, 400);
    }

    const email = (payload.email || '').toLowerCase().trim();
    if (!email) {
      return json({ error: 'Google account has no email address' }, 400);
    }
    const firstName = payload.given_name || '';
    const lastName = payload.family_name || '';

    let tier = 'pro';
    if (tierId === '199' || tierId === '299' || tierId === 'soldier') tier = 'soldier';
    if (tierId === '1199' || tierId === '999' || tierId === 'elite') tier = 'elite';

    let user = {
      email,
      firstName,
      lastName,
      tier,
      subscribed: false,
      subscriptionExpiresAt: '',
      joinedAt: new Date().toISOString()
    };

    // Preserve existing Discord ID, password hash, and subscription status if present in KV
    const existingStr = await env.VICE_VAULT_KV.get(`user:${email}`);
    if (existingStr) {
      try {
        const existing = JSON.parse(existingStr);
        user = {
          ...existing,
          firstName: existing.firstName || user.firstName,
          lastName: existing.lastName || user.lastName,
          tier: existing.tier || user.tier,
          subscribed: existing.subscribed !== undefined ? existing.subscribed : false,
          joinedAt: existing.joinedAt || user.joinedAt
        };
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

    return await authSuccess(user, env);
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
  .logo{font-size:1.6rem;font-weight:900;letter-spacing:.14em;color:#0070f3;margin-bottom:2rem;font-family:Impact,sans-serif}
  .logo span{color:#ede8df}
  .card{background:#0d0d18;border:1px solid rgba(0,112,243,.2);border-radius:6px;padding:2.5rem;text-align:center;border-left:3px solid #0070f3}
  .title{font-size:1.4rem;font-weight:800;color:#ede8df;margin-bottom:.5rem}
  .sub{font-size:.88rem;color:#7a788a;line-height:1.7;margin-bottom:2rem}
  .otp-box{background:#131320;border:1px dashed rgba(0,112,243,.3);border-radius:4px;padding:1.2rem;font-size:2rem;font-weight:800;letter-spacing:.2em;color:#0070f3;margin:1.5rem 0;display:inline-block;padding-left:1.4em}
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
    // If the browser already has a valid session, this call LINKS Discord to that account.
    // The account email is never taken from the request body.
    const sessionEmail = await getSessionEmail(request, env);
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
    let email = sessionEmail;
    if (!email) {
      if (!userData.email || userData.verified !== true) {
        return json({ error: 'Your Discord account must have a verified email address to sign in.' }, 400);
      }
      email = userData.email.toLowerCase().trim();
    }
    const username = userData.username || '';

    // 3. Map tier ID
    let tier = 'pro';
    if (tierId === '199' || tierId === '299' || tierId === 'soldier') tier = 'soldier';
    if (tierId === '1199' || tierId === '999' || tierId === 'elite') tier = 'elite';

    let user = {
      email,
      firstName: username,
      lastName: '',
      tier,
      subscribed: false,
      subscriptionExpiresAt: '',
      discordUserId: userData.id,
      joinedAt: new Date().toISOString()
    };

    const existingStr = await env.VICE_VAULT_KV.get(`user:${email}`);
    if (existingStr) {
      try {
        const existing = JSON.parse(existingStr);
        user = {
          ...existing,
          discordUserId: userData.id,
          firstName: existing.firstName || user.firstName,
          lastName: existing.lastName || user.lastName,
          tier: existing.tier || user.tier,
          subscribed: existing.subscribed !== undefined ? existing.subscribed : false,
          subscriptionExpiresAt: existing.subscriptionExpiresAt || user.subscriptionExpiresAt,
          joinedAt: existing.joinedAt || user.joinedAt
        };
      } catch(e) {}
    }

    // Assign the local variable tier to match the final resolved user tier for roles matching below
    tier = user.tier;

    await env.VICE_VAULT_KV.put(`user:${email}`, JSON.stringify(user));

    // 4. Auto-join server & assign roles only for PAYING Vault Pro/Elite members
    if (hasActiveAccess(user) && (tier === 'pro' || tier === 'elite') && env.DISCORD_BOT_TOKEN && env.DISCORD_GUILD_ID && env.DISCORD_PRO_ROLE_ID) {
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

    return await authSuccess(user, env);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

async function handleCancelSubscription(request, env) {
  try {
    const cleanEmail = await getSessionEmail(request, env);
    if (!cleanEmail) {
      return json({ error: 'Please sign in again to manage your subscription.' }, 401);
    }

    const userStr = await env.VICE_VAULT_KV.get(`user:${cleanEmail}`);
    if (!userStr) {
      return json({ error: 'User profile not found' }, 400);
    }
    const user = JSON.parse(userStr);

    user.subscribed = false;
    user.subscriptionExpiresAt = new Date(Date.now() + 7 * 86400 * 1000).toISOString(); // 7-day grace period
    await env.VICE_VAULT_KV.put(`user:${cleanEmail}`, JSON.stringify(user));

    // Post webhook alert about cancellation and active grace period
    if (env.DISCORD_WEBHOOK_URL) {
      try {
        await fetch(env.DISCORD_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            embeds: [{
              title: "🚫 Subscription Cancelled (Grace Period Active)",
              description: "A subscription was cancelled. Access and Discord roles remain active during the 7-day grace period.",
              color: 16753920, // Orange
              fields: [
                { name: "Email", value: cleanEmail, inline: true },
                { name: "Grace Expiration", value: user.subscriptionExpiresAt, inline: true }
              ],
              timestamp: new Date().toISOString()
            }]
          })
        });
      } catch(err) {}
    }

    return await authSuccess(user, env);
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

      const isGraceExpired = user.subscriptionExpiresAt && now > new Date(user.subscriptionExpiresAt);
      const isInactive = !user.subscribed && (!user.subscriptionExpiresAt || isGraceExpired);

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
// Days of access granted per tier (Elite is sold as an annual plan)
const TIER_ACCESS_DAYS = { soldier: 30, pro: 30, elite: 365 };

async function handleCreateOrder(request, env) {
  try {
    const sessionEmail = await getSessionEmail(request, env);
    if (!sessionEmail) {
      return json({ error: 'Please sign in before checking out.' }, 401);
    }
    const { tier } = await request.json();

    // Price map in paise (INR × 100)
    const PRICES = {
      soldier: 29900,  // ₹299
      pro:     49900,  // ₹499
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
        payment_capture: 1,
        notes: { email: sessionEmail, tier }
      })
    });

    if (!rzpRes.ok) {
      const err = await rzpRes.text();
      return json({ error: 'Failed to create Razorpay order: ' + err }, 500);
    }

    const order = await rzpRes.json();

    // Bind the order to this account + tier server-side (24h to complete payment)
    await env.VICE_VAULT_KV.put(`order:${order.id}`, JSON.stringify({
      email: sessionEmail, tier, amount, createdAt: new Date().toISOString()
    }), { expirationTtl: 86400 });
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
    const sessionEmail = await getSessionEmail(request, env);
    if (!sessionEmail) {
      return json({ error: 'Your session expired. Please sign in again — your payment is safe; contact support if access is not granted.' }, 401);
    }
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, firstName, lastName } = await request.json();

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return json({ error: 'Missing payment verification fields' }, 400);
    }
    if (!env.RAZORPAY_KEY_SECRET) {
      return json({ error: 'Payment gateway not configured.' }, 500);
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

    if (!timingSafeEqual(expectedSignature, String(razorpay_signature))) {
      return json({ error: 'Payment verification failed — invalid signature.' }, 400);
    }

    // The order must be one WE created, for THIS signed-in account
    const orderStr = await env.VICE_VAULT_KV.get(`order:${razorpay_order_id}`);
    if (!orderStr) {
      return json({ error: 'Unknown or expired order. Please contact support with your payment ID.' }, 400);
    }
    const order = JSON.parse(orderStr);
    if (order.email !== sessionEmail) {
      return json({ error: 'This payment belongs to a different account.' }, 403);
    }

    // Each payment can activate a subscription only once
    if (await env.VICE_VAULT_KV.get(`payment:${razorpay_payment_id}`)) {
      return json({ error: 'This payment has already been used.' }, 409);
    }
    await env.VICE_VAULT_KV.put(`payment:${razorpay_payment_id}`, JSON.stringify({
      email: sessionEmail, orderId: razorpay_order_id, tier: order.tier, amount: order.amount, at: new Date().toISOString()
    }));
    await env.VICE_VAULT_KV.delete(`order:${razorpay_order_id}`);

    // Payment is valid — activate subscription with the tier that was actually paid for
    const cleanEmail = sessionEmail;
    const tierName = order.tier;
    const accessDays = TIER_ACCESS_DAYS[tierName] || 30;

    const existingStr = await env.VICE_VAULT_KV.get(`user:${cleanEmail}`);
    let user = existingStr ? JSON.parse(existingStr) : {};

    user = {
      ...user,
      email: cleanEmail,
      firstName: firstName || user.firstName || cleanEmail.split('@')[0],
      lastName: lastName || user.lastName || '',
      tier: tierName,
      subscribed: true,
      subscriptionExpiresAt: new Date(Date.now() + accessDays * 86400 * 1000).toISOString(),
      lastPaymentId: razorpay_payment_id,
      lastOrderId: razorpay_order_id,
      joinedAt: user.joinedAt || new Date().toISOString()
    };

    await env.VICE_VAULT_KV.put(`user:${cleanEmail}`, JSON.stringify(user));

    // Send purchase welcome email via Resend
    await sendWelcomeEmail(cleanEmail, tierName, env, 'premium');

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

    return await authSuccess(user, env);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

// ─── ADMIN: GET STATS ──────────────────────────────────────
async function handleAdminStats(env) {
  try {
    const userList = await env.VICE_VAULT_KV.list({ prefix: 'user:' });
    let totalMembers = userList.keys.length;
    let activeSubs = 0;
    let soldierCount = 0;
    let proCount = 0;
    let eliteCount = 0;

    for (const key of userList.keys) {
      const val = await env.VICE_VAULT_KV.get(key.name);
      if (val) {
        try {
          const user = JSON.parse(val);
          if (user.subscribed) {
            activeSubs++;
            if (user.tier === 'soldier') soldierCount++;
            else if (user.tier === 'elite') eliteCount++;
            else proCount++; // default/pro
          }
        } catch(e) {}
      }
    }

    const waitlistCountStr = await env.VICE_VAULT_KV.get('waitlist:count') || '0';
    const waitlistCount = parseInt(waitlistCountStr, 10);

    // Calculate MRR: Soldier (₹299/mo), Pro (₹699/mo), Elite (₹999/yr => ₹83/mo equivalent)
    const mrr = (soldierCount * 299) + (proCount * 699) + Math.round(eliteCount * (999 / 12));

    return json({
      success: true,
      stats: {
        totalMembers,
        activeSubs,
        soldierCount,
        proCount,
        eliteCount,
        waitlistCount,
        mrr
      }
    });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

// ─── ADMIN: LIST MEMBERS ───────────────────────────────────
async function handleAdminUsers(env) {
  try {
    const userList = await env.VICE_VAULT_KV.list({ prefix: 'user:' });
    const users = [];
    for (const key of userList.keys) {
      const val = await env.VICE_VAULT_KV.get(key.name);
      if (val) {
        try {
          users.push(publicUser(JSON.parse(val)));
        } catch(e) {}
      }
    }
    // Sort by joinedAt descending
    users.sort((a, b) => new Date(b.joinedAt || 0) - new Date(a.joinedAt || 0));
    return json({ success: true, users });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

// ─── ADMIN: LIST WAITLIST ──────────────────────────────────
async function handleAdminWaitlist(env) {
  try {
    const wlList = await env.VICE_VAULT_KV.list({ prefix: 'waitlist:' });
    const waitlist = [];
    for (const key of wlList.keys) {
      if (key.name === 'waitlist:count') continue;
      const val = await env.VICE_VAULT_KV.get(key.name);
      if (val) {
        try {
          waitlist.push(JSON.parse(val));
        } catch(e) {
          waitlist.push({ email: val, joinedAt: new Date().toISOString() });
        }
      }
    }
    // Sort by joinedAt descending
    waitlist.sort((a, b) => new Date(b.joinedAt || 0) - new Date(a.joinedAt || 0));
    return json({ success: true, waitlist });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

// ─── ADMIN: UPDATE MEMBER ──────────────────────────────────
async function handleAdminUpdateUser(request, env) {
  try {
    const { email, tier, subscribed, subscriptionExpiresAt } = await request.json();
    if (!email) {
      return json({ error: 'Email is required' }, 400);
    }
    const cleanEmail = email.toLowerCase().trim();
    const existingStr = await env.VICE_VAULT_KV.get(`user:${cleanEmail}`);
    if (!existingStr) {
      return json({ error: 'User not found' }, 404);
    }

    const user = JSON.parse(existingStr);
    if (tier !== undefined) user.tier = tier;
    if (subscribed !== undefined) user.subscribed = subscribed;
    if (subscriptionExpiresAt !== undefined) user.subscriptionExpiresAt = subscriptionExpiresAt;

    await env.VICE_VAULT_KV.put(`user:${cleanEmail}`, JSON.stringify(user));
    return json({ success: true, user: publicUser(user) });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

// ─── ADMIN: DELETE MEMBER ──────────────────────────────────
async function handleAdminDeleteUser(request, env) {
  try {
    const { email } = await request.json();
    if (!email) {
      return json({ error: 'Email is required' }, 400);
    }
    const cleanEmail = email.toLowerCase().trim();
    const existingStr = await env.VICE_VAULT_KV.get(`user:${cleanEmail}`);
    if (!existingStr) {
      return json({ error: 'User not found' }, 404);
    }

    const user = JSON.parse(existingStr);
    
    // Try to remove Discord roles immediately if user has Discord ID
    if (user.discordUserId && env.DISCORD_BOT_TOKEN && env.DISCORD_GUILD_ID) {
      try {
        const rolesToRemove = [env.DISCORD_PRO_ROLE_ID, env.DISCORD_ELITE_ROLE_ID].filter(Boolean);
        for (const roleId of rolesToRemove) {
          await fetch(`https://discord.com/api/v10/guilds/${env.DISCORD_GUILD_ID}/members/${user.discordUserId}/roles/${roleId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bot ${env.DISCORD_BOT_TOKEN}` }
          });
        }
      } catch(e) {
        console.error("Discord roles removal on delete failed:", e);
      }
    }

    await env.VICE_VAULT_KV.delete(`user:${cleanEmail}`);
    return json({ success: true, message: 'User deleted successfully' });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

async function handleRegister(request, env) {
  try {
    const { email, password, firstName, lastName, tier } = await request.json();
    const cleanEmail = (email || '').toLowerCase().trim();
    if (!isValidEmail(cleanEmail) || !password || password.length < 8) {
      return json({ error: 'Valid email and password (min 8 chars) are required' }, 400);
    }

    // Never overwrite an existing account (it may belong to someone who signed in via Google/OTP/Discord)
    const existingStr = await env.VICE_VAULT_KV.get(`user:${cleanEmail}`);
    if (existingStr) {
      return json({ error: 'An account with this email already exists. Please sign in instead (use the email code option if you signed up with Google or Discord).' }, 409);
    }

    const passwordHash = await createPasswordHash(password);
    
    let tierName = 'pro';
    if (tier === 'soldier' || tier === '299') tierName = 'soldier';
    if (tier === 'elite' || tier === '999') tierName = 'elite';

    const user = {
      email: cleanEmail,
      passwordHash,
      firstName: firstName || cleanEmail.split('@')[0],
      lastName: lastName || '',
      tier: tierName,
      subscribed: false,
      joinedAt: new Date().toISOString()
    };
    
    await env.VICE_VAULT_KV.put(`user:${cleanEmail}`, JSON.stringify(user));
    return await authSuccess(user, env);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

async function handleLogin(request, env) {
  try {
    const { email, password } = await request.json();
    const cleanEmail = (email || '').toLowerCase().trim();
    if (!cleanEmail || !password) {
      return json({ error: 'Email and password are required' }, 400);
    }
    
    const userStr = await env.VICE_VAULT_KV.get(`user:${cleanEmail}`);
    if (!userStr) {
      return json({ error: 'Account not found. Please sign up first.' }, 404);
    }
    
    const user = JSON.parse(userStr);
    if (!user.passwordHash) {
      return json({ error: 'This account was created via social login or OTP. Please sign in using the OTP link or Google/Discord.' }, 400);
    }
    
    const { ok, needsUpgrade } = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      return json({ error: 'Incorrect password. Please try again.' }, 400);
    }

    // Transparently migrate legacy unsalted SHA-256 hashes to salted PBKDF2
    if (needsUpgrade) {
      user.passwordHash = await createPasswordHash(password);
      await env.VICE_VAULT_KV.put(`user:${cleanEmail}`, JSON.stringify(user));
    }

    return await authSuccess(user, env);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

async function handleUserStatus(request, env) {
  try {
    const cleanEmail = await getSessionEmail(request, env);
    if (!cleanEmail) {
      return json({ error: 'Not signed in', authRequired: true }, 401);
    }
    const userStr = await env.VICE_VAULT_KV.get(`user:${cleanEmail}`);
    if (!userStr) {
      return json({ error: 'User not found', authRequired: true }, 401);
    }
    const user = JSON.parse(userStr);
    return json({
      success: true,
      email: cleanEmail,
      subscribed: hasActiveAccess(user), // includes 7-day grace period
      tier: user.tier || 'pro',
      subscriptionExpiresAt: user.subscriptionExpiresAt || ''
    });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
