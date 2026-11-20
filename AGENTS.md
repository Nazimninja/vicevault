# Vice Vault - Agent Guidelines & Project Memory

Please refer to [GEMINI.md](file:///D:/Social%20Ninja's/projects/vicevault/GEMINI.md) for full project architecture, technical specifications, design standards, GEO/SEO optimizations, Cloudflare Worker backend endpoints, and operational rules.

### Quick Reference:
1. **Authoritative Domain**: `https://vicevault.linkwa.in` (hosted via Cloudflare Pages and Cloudflare Workers).
2. **Parent Brand**: **Social Ninja's** (`https://socialninjas.in`), Founder Nazim (`nazim.socialninja@gmail.com`).
3. **Core Billing Rules**: One-time payments, no auto-renewal: Soldier ₹299 / Pro ₹499 for 30 days, Elite ₹999 for 365 days. Early renewals stack on remaining time.
4. **Subscription Paywall & Grace Period**: Access lasts until the paid-until date plus a 7-day grace period to renew, then ends (`hasActiveAccess` in `worker.js`). Cancelling never shortens a paid period.
5. **Mobile & Performance Standards**: Never enable Lenis smooth scrolling or animated background canvas on mobile/touch viewports (`pointer: coarse`). Always use `translate3d` and `scale` for GPU-accelerated cursor animations to prevent layout reflows.
6. **Content Separation**: Keep gameplay guides (`guides.html`) strictly separated from gaming news/articles (`blog.html`).
