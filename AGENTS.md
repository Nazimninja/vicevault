# Vice Vault - Agent Guidelines & Project Memory

Please refer to [GEMINI.md](file:///D:/Social%20Ninja's/projects/vicevault/GEMINI.md) for full project architecture, technical specifications, design standards, GEO/SEO optimizations, Cloudflare Worker backend endpoints, and operational rules.

### Quick Reference:
1. **Authoritative Domain**: `https://vicevault.linkwa.in` (hosted via Cloudflare Pages and Cloudflare Workers).
2. **Parent Brand**: **Social Ninja's** (`https://socialninjas.in`), Founder Nazim (`nazim.socialninja@gmail.com`).
3. **Core Billing Rules**: Pre-order payment collected upfront to reserve waitlist at discount; 30-day recurring billing starts on official GTA 6 game launch day.
4. **Subscription Paywall & Grace Period**: 7-day grace period for failed/cancelled subscriptions before revoking access. Pre-launch paid members receive immediate preview access and welcome status to ensure purchase satisfaction.
5. **Mobile & Performance Standards**: Never enable Lenis smooth scrolling or animated background canvas on mobile/touch viewports (`pointer: coarse`). Always use `translate3d` and `scale` for GPU-accelerated cursor animations to prevent layout reflows.
6. **Content Separation**: Keep gameplay guides (`guides.html`) strictly separated from gaming news/articles (`blog.html`).
