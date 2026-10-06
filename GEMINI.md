# Vice Vault - Master Project Memory & Guidelines

> **Permanent Project Memory & Guidelines**  
> Consolidated from all previous engineering, architectural, SEO, UI/UX, Cloudflare Worker backend, pricing, and optimization chat sessions for Vice Vault.  
> Loaded automatically by Antigravity / Gemini for all future tasks in this workspace.

---

## 1. Project Overview & Architecture

- **Primary Product**: **Vice Vault** (`https://vicevault.linkwa.in`) — The premier underground intelligence hub, interactive guides portal, heist blueprint archive, cheat codes database, and community platform for **Grand Theft Auto VI (GTA 6)**.
- **Parent Brand / Agency**: **Social Ninja's** (`https://socialninjas.in`) — Growth Systems, Automation, Content Studio.
- **Owner / Founder**: Nazim (`nazim.socialninja@gmail.com`).
- **Authoritative Domain**: `https://vicevault.linkwa.in` (hosted via Cloudflare Pages and Cloudflare Workers).
  - *Note*: `vicevault.gg` was the historical planning domain; production is live on `vicevault.linkwa.in`.
- **Repository**: `https://github.com/Nazimninja/vicevault` (tracked on `main` branch).
- **Target Launch Window**: Expected Grand Theft Auto VI release date (configured as `2026-11-19T06:00:00+05:30` / Fall 2026).
- **Core Technology Stack**:
  - **Frontend**: Clean semantic HTML5, modern vanilla CSS design system (obsidian/carbon theme with Vice City neon cyan `#00f0ff`, magenta/pink `#ff007f`, and gold `#ffd700` HUD accents).
  - **Motion & Interactions**: Lenis smooth scroll engine, custom GPU-accelerated cursor, particle canvas background (`ParticlesBg`), dynamic shooting meteors, HUD vector cards.
  - **Serverless Backend**: Cloudflare Worker (`worker.js` / `wrangler.toml` named `vice-vault-api`) running with `nodejs_compat`.
  - **Storage**: Cloudflare Workers KV (`VICE_VAULT_KV`, ID: `31d5ed49d5ee4891a890ad47f4aad99a`, Preview ID: `f2c6cbddba344806aed74123479fa214`).
  - **Automated Cron Jobs**: Hourly cron (`0 * * * *`) to synchronize subscription states and Discord roles.
  - **Email Service**: Resend API (`RESEND_API_KEY`) via `noreply@vicevault.linkwa.in` with admin notifications to `ADMIN_EMAIL`.

---

## 2. Core Features & Key Modules

### A. Pre-Order & Waitlist Subscription System
- **Billing Strategy**:
  - Members pay upfront during the pre-launch phase to secure their spot on the waitlist and lock in discounted founder pricing.
  - The actual recurring 30-day billing cycle activates on official game launch day.
- **7-Day Grace Period & Paywall**:
  - Users with failed payments or cancellations are granted a 7-day grace period to renew before their access is fully revoked.
  - Enforced in `dashboard.html`, `vv-global.js` access checks, and `worker.js` backend endpoints (`/api/auth/status`).
- **Pre-Launch Limited Dashboard Access**:
  - Instead of blocking paid pre-launch users with a blank/lock screen, members receive limited access with an interactive pre-launch status banner and preview content to ensure immediate purchase satisfaction and prevent buyer remorse.

### B. Membership & Pricing Tiers
| Tier | Offer / Pre-Order Price | Launch Day Price | Billing | Features |
|---|---|---|---|---|
| **Soldier** | ₹199 - ₹299 | ₹399 | Monthly | 10 heist blueprints/mo, full cheat code vault (PS5 & Xbox), weekly money meta summary, basic story walkthroughs, wanted level escape guides. |
| **Vault Pro** *(Best Value)* | ₹399 - ₹499 | ₹699 | Monthly | Unlimited access to all 11 sections, hidden heist routes, vehicle speed tests, tuning guides, online multiplayer strategy, priority Discord channels (Heist, RP, Lobbies). |
| **Elite Crew** *(Founding Member)* | ₹999 | ₹1,199 | Annual | Everything in Pro plus custom blueprint requests, direct line to lead researchers, VIP founding badge, private Discord council. |

### C. Authentication & Access Control
- Multi-provider authentication in `signup.html` & `worker.js`:
  - **Google OAuth**: One-click Google sign-in.
  - **Discord OAuth**: Connects Discord account for automatic Discord role assignment in the community server.
  - **Email OTP**: Secure one-time password verification via Resend.
- Default authentication state for new signups is `unsubscribed` until payment confirmation callback verifies active membership.
- Server-side access verification on `dashboard.html` entry prevents URL parameter bypass.

### D. Content Architecture: Guides vs. Blogs
- **Strict Separation**:
  - `guides.html`: Dedicated gameplay hub featuring 14+ game walkthroughs, heist maps, and strategy guides with filter tabs.
  - `blog.html`: Dedicated gaming news and editorial articles separated from guides to avoid user confusion.
  - `index.html`: Displays a curated set of 6 featured guides with a clean "Show More" button routing to `guides.html`.
  - `cheat-codes.html`: High-intent SEO landing page dedicated to GTA 6 cheats across PlayStation and Xbox.
  - `weekly.html`: The Weekly Heist briefing newsletter with live email subscription wired to Cloudflare Worker `/api/newsletter`.

---

## 3. Performance, UI & Mobile Optimization Rules

1. **Mobile Responsiveness**:
   - Lenis smooth scrolling is strictly disabled on touch / mobile devices (`pointer: coarse`) to eliminate scrolling jitter and rubber-banding.
   - Canvas particle animations (`ParticlesBg`) pause on mobile viewports to conserve battery and GPU resources.
   - Double-glow hover borders are restricted to devices with fine pointers (`pointer: fine`).
   - Mobile navigation utilizes a dedicated hamburger overlay with an explicit, accessible close button.
   - Category cards and waitlist email forms collapse cleanly into vertical single-column layouts on mobile viewports.

2. **GPU-Accelerated Interactions**:
   - Custom cursor positioning and parallax transitions site-wide use `translate3d` and `transform: scale` for 60fps hardware-accelerated rendering, avoiding CPU-heavy layout reflows (width/height modifications).
   - Cursor dots remain hidden until initial mouse movement (`mousemove`).

3. **Dashboard Split-Pane Layout**:
   - Body-level scrolling with a sticky sidebar (`align-self: flex-start`) allows independent scrolling for main content feed and sidebar tabs.
   - For Elite tier users, the "Upgrade to Elite" CTA is automatically suppressed.

---

## 4. Search Engine Optimization (SEO) & Discovery

- **Clean Slug Architecture**:
  - Historical blog filenames (`blog1.html` - `blog8.html`) have been permanently mapped to keyword-targeted slugs:
    - `gta-6-character-customization-hair-gym.html`
    - `gta-6-crypto-in-game-economy.html`
    - `gta-6-dynamic-weather-hurricane-mechanics.html`
    - `gta-6-leonida-map-locations-real-miami.html`
    - `gta-6-lucia-jason-protagonists.html`
    - `gta-6-next-gen-features-graphics.html`
    - `gta-6-pc-release-date-expectations-rockstar.html`
    - `gta-6-police-ai-wanted-system-features.html`
    - `gta-6-release-date-latest-delay-rumors.html`
    - `gta-6-soundtrack-radio-stations.html`
    - `gta6-confirmed-vehicles.html`
    - `gta6-leonida-map-size.html`
    - `gta6-weapon-customization.html`
  - `_redirects` preserves 301 permanent redirects from legacy paths.
- **Search Verification & Crawlers**:
  - **Bing Webmaster Tools**: Meta tag and verification file `BingSiteAuth.xml`.
  - **Yandex**: Verification token file `yandex_4f71a467a9c8cec3.html`.
  - **IndexNow**: Automatic indexing key `8f7f1ad4b9714ebca808d4b3c95e1d90.txt`.
  - **Sitemap**: Clean XML entities in `sitemap.xml` pointing to `https://vicevault.linkwa.in`.
- **Structured Data**:
  - Validated JSON-LD schemas (`Product`, `NewsArticle`, `Organization`, `BreadcrumbList`) across `preorder.html`, `weekly.html`, and guide pages.
- **Off-Page SEO**:
  - `backlink-seo-kit.md`: Outlines forum outreach, Reddit gaming community threads, and gaming directory listings.

---

## 5. Development & Deployment Commands

```bash
# Run local frontend server (port 3000)
npm run dev:site

# Run local Cloudflare Worker API
npm run dev:api

# Run both frontend and backend concurrently
npm run dev

# Deploy Cloudflare Worker API
npm run deploy:api
```
