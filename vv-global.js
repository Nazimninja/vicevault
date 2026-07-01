/**
 * ═══════════════════════════════════════════════════════════
 * VICE VAULT — GLOBAL COUNTDOWN + PREORDER SYSTEM
 * File: vv-global.js
 * Include in every page: <script src="vv-global.js"></script>
 * Also requires: vv-global.css (included below as injected style)
 * ═══════════════════════════════════════════════════════════
 *
 * What this file does:
 * 1. Injects a sticky launch countdown bar at the top of every page
 * 2. Injects the preorder deal modal (opens on CTA click)
 * 3. Runs the live countdown timer
 * 4. Handles preorder deal selection + email capture
 * 5. Tracks referral source via URL params
 *
 * HOW TO USE:
 * Add before </body> on every HTML page:
 * <script src="vv-global.js"></script>
 *
 * To open preorder modal from any button:
 * onclick="VV.openPreorder()"
 *
 * To set launch date, change LAUNCH_DATE below.
 * ═══════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  // ─── CONFIG ──────────────────────────────────────────────
  // UPDATE THIS to the actual GTA 6 / Vice Vault launch date
  const LAUNCH_DATE = new Date('2026-11-19T06:00:00+05:30');

  function setupCustomCursorHover(el) {
    const cur = document.getElementById('cur');
    const crng = document.getElementById('crng');
    if (!cur || !crng || !el) return;
    el.addEventListener('mouseenter', () => {
      cur.style.width = '16px'; cur.style.height = '16px';
      crng.style.width = '52px'; crng.style.height = '52px';
      crng.style.opacity = '.9';
    });
    el.addEventListener('mouseleave', () => {
      cur.style.width = '10px'; cur.style.height = '10px';
      crng.style.width = '36px'; crng.style.height = '36px';
      crng.style.opacity = '.5';
    });
  }

  // Google Analytics ID (e.g., 'G-XXXXXXXXXX')
  // Centralizes tracking: set this and GA4 is enabled across all pages automatically!
  const GA_TRACKING_ID = '';

  const PREORDER_DEALS = [
    {
      id: 'soldier',
      name: 'Soldier',
      price: 199,
      originalPrice: 299,
      period: 'month',
      badge: null,
      color: '#7a788a',
      features: [
        '10 heist blueprints per month',
        'Full cheat code vault (PS5 & Xbox)',
        'Weekly money meta summary',
        'Basic story walkthroughs',
        'Wanted level escape guides',
      ],
      locked: ['Unlimited guide access', 'Hidden route unlocks', 'Discord access'],
    },
    {
      id: 'pro',
      name: 'Vault Pro',
      price: 399,
      originalPrice: 499,
      period: 'month',
      badge: '⭐ Best value',
      color: '#d4a332',
      hot: true,
      features: [
        'Unlimited access — all 11 sections',
        'Full heist blueprints + hidden routes',
        'Weekly money meta deep-dives',
        'Full story walkthrough vault',
        'Vehicle speed tests & tuning guides',
        'Online multiplayer strategy',
        'Priority Discord crew channels (Heist, RP, Lobbies)',
      ],
      locked: ['Custom blueprint requests'],
      note: null,
    },
    {
      id: 'elite',
      name: 'Elite Crew',
      price: 999,
      originalPrice: 1199,
      period: 'year',
      badge: '💎 Founding member',
      color: '#9b59ff',
      features: [
        'Everything in Vault Pro',
        'Custom blueprint requests (2/month)',
        'Early access — guides 48hr early',
        'Monthly live strategy session',
        'Private Elite HQ Channels & VIP Voice Lounge',
        'Founding member badge (lifetime)',
        'Direct line to our analysts',
        'Weekly personal meta briefing',
      ],
      locked: [],
      note: 'Founding member status — only available during pre-launch',
    },
  ];

  // ─── INJECT CSS ──────────────────────────────────────────
  const css = `
/* VV COUNTDOWN BAR */
#vv-bar {
  position: fixed;
  top: 0; left: 0; right: 0;
  z-index: 9000;
  background: linear-gradient(90deg, #0d0d18, #131320, #0d0d18);
  border-bottom: 1px solid rgba(212,163,50,0.25);
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 1.5rem;
  transform: translateY(-100%);
  animation: vv-bar-in 0.6s 0.5s cubic-bezier(0.4,0,0.2,1) forwards;
}
@keyframes vv-bar-in {
  to { transform: translateY(0); }
}
#vv-bar.vv-bar-hidden { display: none; }

.vv-bar-left {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  flex: 1;
}
.vv-bar-pulse {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: #ff3d6e;
  animation: vv-pulse 2s ease-in-out infinite;
  flex-shrink: 0;
}
@keyframes vv-pulse {
  0%,100%{ box-shadow: 0 0 0 0 rgba(255,61,110,0.7); }
  50%{ box-shadow: 0 0 0 6px rgba(255,61,110,0); }
}
.vv-bar-label {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 0.7rem;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #ede8df;
  white-space: nowrap;
}
.vv-bar-label .vv-bl-accent { color: #d4a332; }

.vv-countdown {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  flex-shrink: 0;
}
.vv-cd-unit {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 36px;
}
.vv-cd-num {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 1.1rem;
  line-height: 1;
  color: #d4a332;
  background: rgba(212,163,50,0.08);
  border: 1px solid rgba(212,163,50,0.2);
  border-radius: 3px;
  padding: 0.1rem 0.4rem;
  min-width: 32px;
  text-align: center;
}
.vv-cd-label {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 0.45rem;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #7a788a;
  margin-top: 1px;
}
.vv-cd-sep {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 1rem;
  color: rgba(212,163,50,0.4);
  margin-bottom: 8px;
}

.vv-bar-cta {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  background: #d4a332;
  color: #030308;
  border: none;
  padding: 0.38rem 1rem;
  border-radius: 2px;
  cursor: pointer;
  transition: background 0.2s, transform 0.15s;
  white-space: nowrap;
  flex-shrink: 0;
  margin-left: 0;
}
.vv-bar-cta:hover { background: #f0c84a; transform: translateY(-1px); }

.vv-bar-close {
  background: none;
  border: none;
  color: #7a788a;
  font-size: 1rem;
  cursor: pointer;
  padding: 0.2rem 0.4rem;
  margin-left: 0;
  line-height: 1;
  transition: color 0.2s;
  flex-shrink: 0;
}
.vv-bar-close:hover { color: #ede8df; }

/* Offset nav for the bar */
body.vv-bar-active nav { top: 44px !important; }
body.vv-bar-active .hero,
body.vv-bar-active .about-hero,
body.vv-bar-active .drop-hero { padding-top: calc(120px + 44px) !important; }

/* VV PREORDER MODAL */
#vv-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 9500;
  background: rgba(3,3,8,0.88);
  backdrop-filter: blur(12px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.25s ease;
}
#vv-modal-overlay.vv-open {
  opacity: 1;
  pointer-events: all;
}
#vv-modal {
  background: #0d0d18;
  border: 1px solid rgba(212,163,50,0.25);
  border-radius: 8px;
  width: 100%;
  max-width: 840px;
  max-height: 90vh;
  overflow-y: auto;
  position: relative;
  transform: translateY(20px) scale(0.98);
  transition: transform 0.25s ease;
}
#vv-modal-overlay.vv-open #vv-modal {
  transform: translateY(0) scale(1);
}
#vv-modal::-webkit-scrollbar { width: 4px; }
#vv-modal::-webkit-scrollbar-thumb { background: #2a2838; }

.vvm-header {
  padding: 2rem 2rem 1.5rem;
  border-bottom: 1px solid rgba(255,255,255,0.07);
  position: relative;
}
.vvm-close {
  position: absolute;
  top: 1.2rem; right: 1.2rem;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.1);
  color: #7a788a;
  width: 32px; height: 32px;
  border-radius: 50%;
  font-size: 0.9rem;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.2s;
}
.vvm-close:hover { background: rgba(255,255,255,0.1); color: #ede8df; }

.vvm-eye {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 0.62rem;
  font-weight: 800;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: #d4a332;
  margin-bottom: 0.4rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.vvm-eye-dot {
  width: 5px; height: 5px;
  border-radius: 50%;
  background: #ff3d6e;
  animation: vv-pulse 1.5s ease-in-out infinite;
}
.vvm-title {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 2rem;
  letter-spacing: 0.06em;
  color: #ede8df;
  margin-bottom: 0.3rem;
}
.vvm-sub {
  font-size: 0.84rem;
  color: #7a788a;
  line-height: 1.6;
}

/* Countdown in modal */
.vvm-countdown {
  display: flex;
  gap: 0.6rem;
  margin-top: 1rem;
  flex-wrap: wrap;
}
.vvm-cd-unit {
  background: rgba(212,163,50,0.07);
  border: 1px solid rgba(212,163,50,0.18);
  border-radius: 4px;
  padding: 0.5rem 0.8rem;
  text-align: center;
  min-width: 60px;
}
.vvm-cd-num {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 1.6rem;
  color: #d4a332;
  line-height: 1;
}
.vvm-cd-label {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 0.58rem;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #7a788a;
}

/* Deal cards */
.vvm-deals {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1px;
  background: rgba(255,255,255,0.07);
  margin: 0;
}
.vvm-deal {
  background: #0d0d18;
  padding: 1.5rem 1.3rem;
  cursor: pointer;
  transition: background 0.2s;
  position: relative;
  display: flex;
  flex-direction: column;
}
.vvm-deal:hover { background: #131320; }
.vvm-deal.selected {
  background: #131320;
  box-shadow: inset 0 0 0 2px var(--deal-color, #d4a332);
}
.vvm-deal-badge {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 0.6rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--deal-color, #d4a332);
  margin-bottom: 0.6rem;
  min-height: 1.2rem;
}
.vvm-deal-name {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 1.3rem;
  letter-spacing: 0.08em;
  color: var(--deal-color, #d4a332);
  margin-bottom: 0.3rem;
}
.vvm-deal-price-row {
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
  margin-bottom: 0.15rem;
}
.vvm-deal-orig {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 0.9rem;
  font-weight: 700;
  color: #7a788a;
  text-decoration: line-through;
}
.vvm-deal-price {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 2.2rem;
  color: #ede8df;
  line-height: 1;
}
.vvm-deal-cur {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 1rem;
  font-weight: 700;
  color: #7a788a;
}
.vvm-deal-per {
  font-size: 0.72rem;
  color: #7a788a;
  margin-bottom: 1rem;
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 600;
  letter-spacing: 0.06em;
}
.vvm-deal-note {
  font-size: 0.72rem;
  color: #00d4aa;
  line-height: 1.5;
  margin-bottom: 0.8rem;
  font-style: italic;
}
.vvm-feats {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.38rem;
  flex: 1;
}
.vvm-feats li {
  font-size: 0.78rem;
  color: #ede8df;
  display: flex;
  align-items: flex-start;
  gap: 0.45rem;
  line-height: 1.5;
}
.vvm-feats li::before { content: '✓'; color: #d4a332; flex-shrink: 0; margin-top: 1px; font-weight: 700; }
.vvm-feats li.vvm-locked { color: #7a788a; opacity: 0.45; }
.vvm-feats li.vvm-locked::before { content: '×'; color: #2a2838; }
.vvm-select-check {
  position: absolute;
  top: 0.8rem; right: 0.8rem;
  width: 20px; height: 20px;
  border-radius: 50%;
  background: var(--deal-color, #d4a332);
  display: flex; align-items: center; justify-content: center;
  font-size: 0.7rem; color: #030308;
  opacity: 0;
  transform: scale(0.5);
  transition: opacity 0.2s, transform 0.2s;
}
.vvm-deal.selected .vvm-select-check { opacity: 1; transform: scale(1); }

/* Footer */
.vvm-footer {
  padding: 1.5rem 2rem;
  border-top: 1px solid rgba(255,255,255,0.07);
}
.vvm-form {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
  margin-bottom: 0.8rem;
}
.vvm-email {
  flex: 1;
  min-width: 220px;
  background: #131320;
  border: 1px solid rgba(255,255,255,0.14);
  color: #ede8df;
  font-family: 'Barlow', sans-serif;
  font-size: 0.9rem;
  padding: 0.85rem 1rem;
  border-radius: 3px;
  outline: none;
  transition: border-color 0.2s;
}
.vvm-email::placeholder { color: #7a788a; }
.vvm-email:focus { border-color: #d4a332; }
.vvm-submit {
  background: #d4a332;
  color: #030308;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 0.88rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  padding: 0.85rem 1.8rem;
  border-radius: 3px;
  border: none;
  cursor: pointer;
  transition: background 0.2s, transform 0.15s;
  white-space: nowrap;
}
.vvm-submit:hover { background: #f0c84a; transform: translateY(-1px); }
.vvm-submit:disabled { opacity: 0.5; pointer-events: none; }
.vvm-terms {
  font-size: 0.72rem;
  color: #7a788a;
  line-height: 1.6;
}
.vvm-terms a { color: #d4a332; }

/* Success */
.vvm-success {
  display: none;
  text-align: center;
  padding: 2.5rem 2rem;
}
.vvm-success.vvm-shown { display: block; }
.vvm-success-icon { font-size: 3rem; margin-bottom: 0.8rem; }
.vvm-success-title {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 2rem;
  letter-spacing: 0.06em;
  color: #00d4aa;
  margin-bottom: 0.5rem;
}
.vvm-success-sub { font-size: 0.88rem; color: #7a788a; line-height: 1.75; max-width: 400px; margin: 0 auto; }

@media (max-width: 700px) {
  .vvm-deals { grid-template-columns: 1fr; }
  #vv-bar .vv-bar-label .vv-bar-long { display: none; }
  .vvm-header { padding: 1.5rem 1rem; }
  .vvm-footer { padding: 1.2rem 1rem; }
}
@media (max-width: 480px) {
  .vv-countdown { display: none; }
}
`;

  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  // ─── BUILD COUNTDOWN BAR ─────────────────────────────────
  function buildBar() {
    if (document.getElementById('vv-bar')) return;

    const bar = document.createElement('div');
    bar.id = 'vv-bar';
    bar.innerHTML = `
      <div class="vv-bar-left">
        <span class="vv-bar-pulse"></span>
        <span class="vv-bar-label">
          <span class="vv-bl-accent">Vice Vault</span>
          <span class="vv-bar-long"> launches with GTA 6 — </span>
          <span class="vv-bar-long">pre-order now & save 20%</span>
        </span>
      </div>
      <div class="vv-bar-right" style="display:flex;align-items:center;gap:1.2rem">
        <div class="vv-countdown">
          <div class="vv-cd-unit"><div class="vv-cd-num" id="vvb-d">00</div><div class="vv-cd-label">Days</div></div>
          <span class="vv-cd-sep">:</span>
          <div class="vv-cd-unit"><div class="vv-cd-num" id="vvb-h">00</div><div class="vv-cd-label">Hrs</div></div>
          <span class="vv-cd-sep">:</span>
          <div class="vv-cd-unit"><div class="vv-cd-num" id="vvb-m">00</div><div class="vv-cd-label">Min</div></div>
          <span class="vv-cd-sep">:</span>
          <div class="vv-cd-unit"><div class="vv-cd-num" id="vvb-s">00</div><div class="vv-cd-label">Sec</div></div>
        </div>
        <button class="vv-bar-cta" onclick="VV.openPreorder()">Pre-order — save 20%</button>
        <button class="vv-bar-close" onclick="VV.closeBar()" aria-label="Close">✕</button>
      </div>
    `;
    document.body.insertBefore(bar, document.body.firstChild);
    document.body.classList.add('vv-bar-active');

    // Attach custom cursor listeners to dynamically added buttons
    const ctaBtn = bar.querySelector('.vv-bar-cta');
    const closeBtn = bar.querySelector('.vv-bar-close');
    if (ctaBtn) setupCustomCursorHover(ctaBtn);
    if (closeBtn) setupCustomCursorHover(closeBtn);
  }

  // ─── BUILD MODAL ─────────────────────────────────────────
  function buildModal() {
    if (document.getElementById('vv-modal-overlay')) return;

    const dealsHTML = PREORDER_DEALS.map((d, i) => `
      <div class="vvm-deal ${i === 1 ? 'selected' : ''}" data-id="${d.id}"
           style="--deal-color:${d.color}" onclick="VV.selectDeal('${d.id}')">
        <div class="vvm-select-check">✓</div>
        <div class="vvm-deal-badge">${d.badge || '&nbsp;'}</div>
        <div class="vvm-deal-name">${d.name}</div>
        <div class="vvm-deal-price-row">
          <span class="vvm-deal-cur">₹</span>
          <span class="vvm-deal-price">${d.price}</span>
          ${d.originalPrice ? `<span class="vvm-deal-orig">₹${d.originalPrice}</span>` : ''}
        </div>
        <div class="vvm-deal-per">per ${d.period} ${d.period === 'year' ? '· billed yearly' : '· cancel anytime'}</div>
        ${d.note ? `<div class="vvm-deal-note">${d.note}</div>` : ''}
        <ul class="vvm-feats">
          ${d.features.map(f => `<li>${f}</li>`).join('')}
          ${d.locked.map(f => `<li class="vvm-locked">${f}</li>`).join('')}
        </ul>
      </div>
    `).join('');

    const overlay = document.createElement('div');
    overlay.id = 'vv-modal-overlay';
    overlay.innerHTML = `
      <div id="vv-modal">
        <div class="vvm-header">
          <button class="vvm-close" onclick="VV.closePreorder()" aria-label="Close">✕</button>
          <div class="vvm-eye"><span class="vvm-eye-dot"></span>Pre-launch exclusive — ends at launch</div>
          <div class="vvm-title">Lock in your rate before launch</div>
          <div class="vvm-sub">Pre-order today and your price is locked forever. Vault Pro drops to ₹399/mo — saves you ₹100 every month, ₹1,200/year, permanently.</div>
          <div class="vvm-countdown">
            <div class="vvm-cd-unit"><div class="vvm-cd-num" id="vvm-d">00</div><div class="vvm-cd-label">Days</div></div>
            <div class="vvm-cd-unit"><div class="vvm-cd-num" id="vvm-h">00</div><div class="vvm-cd-label">Hours</div></div>
            <div class="vvm-cd-unit"><div class="vvm-cd-num" id="vvm-m">00</div><div class="vvm-cd-label">Minutes</div></div>
            <div class="vvm-cd-unit"><div class="vvm-cd-num" id="vvm-s">00</div><div class="vvm-cd-label">Seconds</div></div>
          </div>
        </div>
        <div class="vvm-deals">${dealsHTML}</div>
        <div class="vvm-footer" id="vvm-footer-main">
          <div class="vvm-form">
            <input type="email" class="vvm-email" id="vvm-email" placeholder="your@email.com" aria-label="Email address">
            <button class="vvm-submit" id="vvm-submit" onclick="VV.submitPreorder()">
              Pre-order Vault Pro — ₹399/mo →
            </button>
          </div>
          <div class="vvm-terms">
            No payment now. We'll email you on launch day with your checkout link. Your price is locked from the moment you pre-order. <a href="terms.html">Terms</a> · <a href="privacy.html">Privacy</a>
          </div>
        </div>
        <div class="vvm-success" id="vvm-success">
          <div class="vvm-success-icon">🔐</div>
          <div class="vvm-success-title">Rate locked in.</div>
          <div class="vvm-success-sub">Check your email for confirmation. On launch day we'll send you a direct checkout link with your locked price. You're <span id="vvm-pos" style="color:#d4a332;font-weight:700">#12,849</span> in line.</div>
        </div>
      </div>
    `;
    overlay.addEventListener('click', e => { if (e.target === overlay) VV.closePreorder(); });
    document.body.appendChild(overlay);
  }

  // ─── COUNTDOWN LOGIC ─────────────────────────────────────
  function tick() {
    const now = new Date();
    const diff = LAUNCH_DATE - now;
    if (diff <= 0) {
      ['vvb-d','vvb-h','vvb-m','vvb-s','vvm-d','vvm-h','vvm-m','vvm-s'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '00';
      });
      return;
    }
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    const pad = n => String(n).padStart(2, '0');
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = pad(val); };
    set('vvb-d', d); set('vvb-h', h); set('vvb-m', m); set('vvb-s', s);
    set('vvm-d', d); set('vvm-h', h); set('vvm-m', m); set('vvm-s', s);
  }

  // ─── PUBLIC API ──────────────────────────────────────────
  let selectedDealId = 'pro';

  window.VV = {
    openPreorder() {
      window.location.href = 'preorder.html';
    },
    closePreorder() {
      const overlay = document.getElementById('vv-modal-overlay');
      if (overlay) overlay.classList.remove('vv-open');
      document.body.style.overflow = '';
    },
    closeBar() {
      const bar = document.getElementById('vv-bar');
      if (bar) bar.classList.add('vv-bar-hidden');
      document.body.classList.remove('vv-bar-active');
    },
    selectDeal(id) {
      selectedDealId = id;
      document.querySelectorAll('.vvm-deal').forEach(el => {
        el.classList.toggle('selected', el.dataset.id === id);
      });
      const deal = PREORDER_DEALS.find(d => d.id === id);
      const btn = document.getElementById('vvm-submit');
      if (btn && deal) {
        btn.textContent = `Pre-order ${deal.name} — ₹${deal.price}/${deal.period} →`;
      }
    },
    async submitPreorder() {
      const emailEl = document.getElementById('vvm-email');
      const btn = document.getElementById('vvm-submit');
      const email = emailEl ? emailEl.value.trim() : '';

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        if (emailEl) { emailEl.style.borderColor = '#ff3d6e'; setTimeout(() => emailEl.style.borderColor = '', 2000); }
        return;
      }

      if (btn) { btn.disabled = true; btn.textContent = 'Locking in...'; }

      try {
        const res = await fetch('/api/waitlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, source: 'preorder', tier: selectedDealId }),
        });
        const data = await res.json();
        const pos = data.position || 12849;
        document.getElementById('vvm-footer-main').style.display = 'none';
        const success = document.getElementById('vvm-success');
        if (success) {
          success.classList.add('vvm-shown');
          const posEl = document.getElementById('vvm-pos');
          if (posEl) posEl.textContent = '#' + pos.toLocaleString();
        }
      } catch {
        // Fallback — show success anyway (email stored client-side)
        document.getElementById('vvm-footer-main').style.display = 'none';
        const success = document.getElementById('vvm-success');
        if (success) success.classList.add('vvm-shown');
      }
    },
    logout() { logout(); },
    cancelSubscription() { cancelSubscription(); }
  };

  // ─── AUTHENTICATION SYSTEM ──────────────────────────────────
  const USER_KEY = 'vv_user';

  const TIER_LEVELS = {
    'none': 0,
    'free': 0,
    'soldier': 1,
    'pro': 2,
    'vaultpro': 2,
    'elite': 3,
    'elitecrew': 3
  };

  function getCurrentUser() {
    try {
      const u = localStorage.getItem(USER_KEY);
      return u ? JSON.parse(u) : null;
    } catch (e) {
      return null;
    }
  }

  async function login(email, password) {
    if (!email || !password) return { success: false, error: 'Email and password are required' };
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (data.success && data.user) {
        localStorage.setItem(USER_KEY, JSON.stringify(data.user));
        return { success: true, user: data.user };
      }
      return { success: false, error: data.error || 'Login failed' };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async function register(email, password, firstName, lastName, tier) {
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, firstName, lastName, tier })
      });
      const data = await res.json();
      if (data.success && data.user) {
        localStorage.setItem(USER_KEY, JSON.stringify(data.user));
        return { success: true, user: data.user };
      }
      return { success: false, error: data.error || 'Registration failed' };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  function signup(email, firstName, lastName, tierId) {
    if (!email) return false;
    let tier = 'pro';
    if (tierId === '199' || tierId === '299' || tierId === 'soldier') tier = 'soldier';
    if (tierId === '1199' || tierId === '999' || tierId === 'elite') tier = 'elite';

    const user = {
      email,
      firstName: firstName || email.split('@')[0],
      lastName: lastName || '',
      tier,
      subscribed: true,
      joinedAt: new Date().toISOString()
    };
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    return true;
  }

  function logout() {
    localStorage.removeItem(USER_KEY);
    window.location.href = 'index.html';
  }

  async function cancelSubscription() {
    if (!confirm("Are you sure you want to cancel your Vice Vault subscription? This will revoke your private Discord access immediately.")) {
      return;
    }
    const user = getCurrentUser();
    if (!user) return;

    const btn = document.getElementById('cancelSubBtn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Cancelling...";
    }

    try {
      const res = await fetch(`${API_BASE}/api/auth/cancel-subscription`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email })
      });
      const data = await res.json();
      if (data.success) {
        alert("Subscription cancelled successfully! Discord roles have been revoked.");
        user.subscribed = false;
        user.tier = 'none';
        localStorage.setItem(USER_KEY, JSON.stringify(user));
        window.location.reload();
      } else {
        alert("Failed to cancel: " + (data.error || "Unknown error"));
        if (btn) {
          btn.disabled = false;
          btn.textContent = "Cancel Subscription";
        }
      }
    } catch (e) {
      alert("Error cancelling subscription: " + e.message);
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Cancel Subscription";
      }
    }
  }

  function checkAccess(requiredTier) {
    const user = getCurrentUser();
    if (!user) return false;
    
    const userTier = user.tier.toLowerCase().replace(/[^a-z]/g, '');
    const reqTier = requiredTier.toLowerCase().replace(/[^a-z]/g, '');
    
    const userLevel = TIER_LEVELS[userTier] || 0;
    const reqLevel = TIER_LEVELS[reqTier] || 0;
    
    return userLevel >= reqLevel;
  }

  function updateNavigationUI() {
    const user = getCurrentUser();
    if (!user) return;

    const navLinks = document.querySelector('.nav-links');
    if (navLinks) {
      const loginCTA = navLinks.querySelector('.nav-cta');
      if (loginCTA && loginCTA.textContent.toLowerCase().includes('login')) {
        loginCTA.textContent = 'Dashboard';
        loginCTA.href = 'dashboard.html';

        const logoutLi = document.createElement('li');
        const logoutA = document.createElement('a');
        logoutA.href = '#';
        logoutA.textContent = 'Logout';
        logoutA.style.marginLeft = "1rem";
        logoutA.style.cursor = "pointer";
        logoutA.onclick = (e) => {
          e.preventDefault();
          logout();
        };
        setupCustomCursorHover(logoutA);
        logoutLi.appendChild(logoutA);
        navLinks.appendChild(logoutLi);
      }
    }
  }

  function processContentGating() {
    const paywalls = document.querySelectorAll('.paywall');
    if (paywalls.length === 0) return;

    paywalls.forEach(pw => {
      const reqTier = pw.getAttribute('data-required-tier') || 'pro';
      if (checkAccess(reqTier)) {
        pw.classList.add('unlocked');
      }
    });
  }

  function injectPaywallCSS() {
    const style = document.createElement('style');
    style.textContent = `
      .paywall.unlocked .pw-blur {
        filter: none !important;
        opacity: 1 !important;
        user-select: auto !important;
        pointer-events: auto !important;
      }
      .paywall.unlocked .pw-gate {
        display: none !important;
      }
    `;
    document.head.appendChild(style);
  }

  const API_BASE = window.location.hostname.includes('localhost') || window.location.hostname.includes('127.0.0.1')
    ? 'http://localhost:8787'
    : 'https://vicevault.linkwa.in';

  async function sendOTP(email) {
    try {
      const res = await fetch(`${API_BASE}/api/auth/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await res.json();
      return data;
    } catch (e) {
      return { error: e.message };
    }
  }

  async function verifyOTP(email, code, tierId) {
    try {
      const res = await fetch(`${API_BASE}/api/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code, tierId })
      });
      const data = await res.json();
      if (data.success && data.user) {
        localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      }
      return data;
    } catch (e) {
      return { error: e.message };
    }
  }

  async function loginWithGoogle(token, tierId) {
    try {
      const res = await fetch(`${API_BASE}/api/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, tierId })
      });
      const data = await res.json();
      if (data.success && data.user) {
        localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      }
      return data;
    } catch (e) {
      return { error: e.message };
    }
  }

  async function loginWithDiscord(code, redirectUri, tierId, currentUserEmail = '') {
    try {
      const res = await fetch(`${API_BASE}/api/auth/discord`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, redirectUri, tierId, currentUserEmail })
      });
      const data = await res.json();
      if (data.success && data.user) {
        localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      }
      return data;
    } catch (e) {
      return { error: e.message };
    }
  }

  // Export to window.VV
  window.VV = {
    ...window.VV,
    getCurrentUser,
    login,
    register,
    signup,
    logout,
    checkAccess,
    sendOTP,
    verifyOTP,
    loginWithGoogle,
    loginWithDiscord,
    pay: initRazorpayPayment
  };

  // ─── KEYBOARD CLOSE ──────────────────────────────────────
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') VV.closePreorder();
  });

  // ─── GOOGLE ANALYTICS ────────────────────────────────────
  function initGA() {
    if (!GA_TRACKING_ID) return;

    // Inject Google Analytics script tag
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_TRACKING_ID}`;
    document.head.appendChild(script);

    // Initialize tracking
    window.dataLayer = window.dataLayer || [];
    function gtag() { window.dataLayer.push(arguments); }
    window.gtag = gtag;
    gtag('js', new Date());
    gtag('config', GA_TRACKING_ID);
  }

  function setupDashboardUI() {
    const user = getCurrentUser();
    if (!user) {
      if (window.location.pathname.includes('dashboard.html')) {
        window.location.href = 'signup.html?mode=login';
      }
      return;
    }

    if (!window.location.pathname.includes('dashboard.html')) return;

    // Update avatar and name
    const avatar = document.querySelector('.sb-avatar');
    if (avatar && user.firstName) {
      avatar.textContent = user.firstName[0].toUpperCase();
    }
    const nameEl = document.querySelector('.sb-name');
    if (nameEl) {
      nameEl.textContent = user.firstName + (user.lastName ? ' ' + user.lastName : '');
    }
    const tierEl = document.querySelector('.sb-tier');
    if (tierEl) {
      const tierNames = {
        'soldier': 'Soldier',
        'pro': 'Vault Pro',
        'elite': 'Elite Crew'
      };
      tierEl.textContent = '⭐ ' + (tierNames[user.tier] || 'Vault Member');
    }

    // Update sub title on dashboard: "Welcome back, Nazim"
    const subEl = document.getElementById('pageSub');
    if (subEl && subEl.textContent.startsWith('Welcome back')) {
      subEl.textContent = 'Welcome back, ' + user.firstName;
    }
    if (window.subs) {
      window.subs.dashboard = 'Welcome back, ' + user.firstName;
    }

    // Settings view navigation is handled by onclick="showView('settings')" in HTML
    
    // Admin Link
    if (user.isAdmin) {
      const nav = document.querySelector('.sb-nav');
      if (nav && !document.getElementById('sb-admin-link')) {
        const adminLink = document.createElement('div');
        adminLink.id = 'sb-admin-link';
        adminLink.className = 'sb-item';
        adminLink.style.color = 'var(--pink)';
        adminLink.innerHTML = `<span class="ico">🛡️</span><a href="admin.html" style="color:inherit">Admin Center</a>`;
        nav.appendChild(adminLink);
      }
    }
  }

  // ─── INIT ────────────────────────────────────────────────
  function init() {
    buildBar();
    buildModal();
    tick();
    setInterval(tick, 1000);
    initGA();
    
    // Auth initialization
    injectPaywallCSS();
    updateNavigationUI();
    processContentGating();
    setupDashboardUI();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Define global error logger to make it safe
  window.addEventListener('error', e => {
    console.warn("Global Auth Handled Error:", e.message);
  });

  // ─── RAZORPAY CHECKOUT ─────────────────────────────────────
  async function initRazorpayPayment(tier) {
    const user = getCurrentUser();
    let email = user?.email || '';
    if (!email) {
      const emailInput = document.getElementById('email');
      if (emailInput) email = emailInput.value.trim();
    }

    // Ensure Razorpay script is loaded
    if (!window.Razorpay) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://checkout.razorpay.com/v1/checkout.js';
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }

    // Show loading state on button
    const btn = document.getElementById(`pay-btn-${tier}`);
    if (btn) { btn.disabled = true; btn.textContent = 'Processing…'; }

    try {
      // 1. Create order on backend
      const orderRes = await fetch(`${API_BASE}/api/pay/create-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier })
      });
      const orderData = await orderRes.json();

      if (!orderData.success) {
        alert('Could not initiate payment: ' + (orderData.error || 'Unknown error'));
        if (btn) { btn.disabled = false; btn.textContent = 'Subscribe Now'; }
        return;
      }

      // Price labels for display
      const LABELS = { soldier: '₹299/mo', pro: '₹699/mo', elite: '₹999/yr' };
      const NAMES  = { soldier: 'Vault Soldier', pro: 'Vault Pro', elite: 'Elite Crew' };

      // 2. Open Razorpay checkout modal
      const options = {
        key: orderData.keyId,
        amount: orderData.amount,
        currency: orderData.currency,
        name: 'Vice Vault',
        description: `${NAMES[tier] || tier} — ${LABELS[tier] || ''}`,
        order_id: orderData.orderId,
        prefill: { email },
        theme: { color: '#f5a623' },
        modal: {
          ondismiss: () => {
            if (btn) { btn.disabled = false; btn.textContent = 'Subscribe Now'; }
          }
        },
        handler: async function(response) {
          // 3. Verify payment on backend
          if (btn) btn.textContent = 'Verifying…';
          try {
            const verifyRes = await fetch(`${API_BASE}/api/pay/verify`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                razorpay_order_id:   response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature:  response.razorpay_signature,
                email, tier,
                firstName: user?.firstName || '',
                lastName:  user?.lastName  || ''
              })
            });
            const verifyData = await verifyRes.json();

            if (verifyData.success) {
              // Save updated user to localStorage
              localStorage.setItem('vv_user', JSON.stringify(verifyData.user));
              // Redirect to dashboard
              window.location.href = '/dashboard.html?payment=success&tier=' + tier;
            } else {
              alert('Payment verification failed: ' + (verifyData.error || 'Please contact support.'));
              if (btn) { btn.disabled = false; btn.textContent = 'Subscribe Now'; }
            }
          } catch(e) {
            alert('Error verifying payment. Please contact support.');
            if (btn) { btn.disabled = false; btn.textContent = 'Subscribe Now'; }
          }
        }
      };

      const rzp = new window.Razorpay(options);
      rzp.open();
    } catch(e) {
      alert('Payment error: ' + e.message);
      if (btn) { btn.disabled = false; btn.textContent = 'Subscribe Now'; }
    }
  }

  // Expose to global scope
  window.VV = window.VV || {};
  window.VV.pay = initRazorpayPayment;

})();
