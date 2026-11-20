# Vice Vault — Meta Ads plan (budget under ₹300/day)

**Product:** Vault Pass — ₹499 for 30 days, one-time payment, no auto-renewal.
**Market:** India · INR · English · ages 18–34 suggested (Advantage+ treats this as a hint).

---

## 1. The strategy in one paragraph

At under ₹300/day, Meta will see too few ₹499 purchases to learn who buys. So we don't ask it to find buyers yet. We ask it to find **email signups** (the free "cheat sheet by email" box), which are cheap and frequent enough for Meta to learn from. Each signup gets the cheat sheet immediately, beginner tips 2 days later, and the ₹499 Vault Pass offer 5 days later, all automatic. Emails do the selling for free. Once there are enough site visitors and sales, a small retargeting campaign sells the pass directly. Every sale (≈ ₹414 net) goes back into the budget.

```
Ad (cheats / cash creative) → free page with lead box → email signup ("Lead")
      → cheat sheet now → tips on day 2 → ₹499 offer on day 5 → Purchase
Site visitors (30 days) → retargeting ad (offer creative) → /preorder → Purchase
```

## 2. Unit economics — your ceilings

| | Value |
|---|---|
| Price | ₹499 (includes 18% GST) |
| Net per sale after GST and ~2% Razorpay | **≈ ₹414** |
| Break-even cost per sale | **₹414** |
| Break-even cost per lead | **₹414 × (your lead→sale rate)** |

Example: if 4 in every 100 signups end up buying, a lead is worth ₹414 × 0.04 ≈ ₹16, so pay less than ₹16 per lead. **You will only know your real lead→sale rate after week 1–2**, so the first week is a measured test, not a profit week. (GST and fee figures: confirm with your accountant.)

## 3. Before spending anything (all must be ✅)

- [ ] Pay the ad account balance (account 1075331757249207 shows "Account unsettled")
- [ ] `npx wrangler secret put SESSION_SECRET` and `npx wrangler secret put ADMIN_EMAIL`
- [ ] Vice Vault Pixel created; its ID set in `vv-global.js` (`META_PIXEL_ID`) and `wrangler.toml` (`META_PIXEL_ID`)
- [ ] Conversions API token: Events Manager → Vice Vault dataset → Settings → Generate access token → `npx wrangler secret put META_CAPI_TOKEN`
- [ ] `npx wrangler deploy`, then commit + push (Pages redeploys the site)
- [ ] Test: Events Manager → Test events → `npx wrangler secret put META_TEST_EVENT_CODE` → sign up with your own email in the cheat-sheet box (expect **Lead**, browser + server) and make one ₹499 purchase (expect **Purchase**) → `npx wrangler secret delete META_TEST_EVENT_CODE`
- [ ] Check your inbox: cheat-sheet email arrived, unsubscribe link works
- [ ] Domain `linkwa.in` verified in Business Settings → Brand safety → Domains
- [ ] Discord: give the **Pro role** access to every member channel (new buyers all get the Pro role); remove or reassign the old #elite-crew / #analyst-direct channels

## 4. Campaigns

### Phase 1 — Days 1–14: **one** campaign, ₹250/day

**`VV | Leads | Cheat sheet`**
- Objective **Leads** · Conversion location **Website** · Performance goal **Maximise number of conversions** · Event **Lead** (Vice Vault dataset)
- Budget: ₹250/day (campaign budget) · Advantage+ audience · India · Advantage+ placements
- Ads (2), each its own ad so you can see which wins:
  - `cheats-lead` → `/cheat-codes` · creatives `vv-cheats-4x5` + `vv-cheats-9x16`
  - `cash-lead` → `/gta-6-beginners-guide-tips` · creatives `vv-cash-4x5` + `vv-cash-9x16`
- Turn **off** all Advantage+ creative AI options (music, animation, overlays, text improvements, visual touch-ups, "add details/product images")
- URL parameters: `utm_source=meta&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}`

Why not Sales from day 1: Meta needs roughly 50 conversions a week per ad set to optimise well. At ₹250/day that's impossible with ₹499 purchases, but realistic with free signups.

### Phase 2 — when the site has 1,000+ visitors in 30 days *or* 3+ sales: add retargeting, ₹50–80/day

**`VV | Sales | Retarget`**
- Objective **Sales** · Event **Purchase** · ₹50–80/day (taken from the reinvested sales, total still under ₹300/day at first)
- Audience: Custom audience **website visitors last 30 days**, **exclude** Purchase last 30 days
- Ad: `offer-retarget` → `/preorder` · creatives `vv-offer-4x5` + `vv-offer-9x16` (shows ₹499 Vault Pass)

### Phase 3 — when you have ~20+ purchases total and cost per sale < ₹414
Switch the Leads campaign's event to **Purchase** (or duplicate it as Sales) and move most budget there; keep Leads running small for list growth.

## 5. Ad copy (paste into the ads)

**Primary text — cheats-lead**
> Finished the GTA 6 story? All 61 cheats just unlocked. Get the 18 D-pad codes found so far on one cheat sheet, free by email, plus how to enter them on PS5 and Xbox.

**Primary text — cash-lead**
> Lost all your cash after getting busted? Carried cash is gone when you die or get arrested. Get our free GTA 6 cheat sheet and the beginner tips that save your money, straight to your inbox.

**Primary text — offer-retarget**
> Every sourced GTA 6 guide, all 61 cheats with unlock challenges, the verified locations board and the Discord crew. One Vault Pass, ₹499 for 30 days. No auto-renewal.

**Headlines:** Free GTA 6 cheat sheet · All 18 known cheat codes · Stop losing your cash in GTA 6 · Every guide for ₹499 · Fact-checked GTA 6 guides
**Description:** Fan-made guide · Not affiliated with Rockstar Games
**Buttons:** Lead ads: *Learn more* or *Sign up* · Retargeting: *Shop now* or *See details*

## 6. Daily routine (5 minutes) and rules

| When | Look at | Action |
|---|---|---|
| Days 1–3 | Nothing | Don't touch the campaign (learning phase) |
| Day 4+ | Cost per lead per ad | Pause an ad whose cost per lead is ≥ 2× the other after ₹500+ spend on it |
| Day 7 | Leads, sales (Razorpay + admin page), emails sent | Work out lead→sale rate and your real max cost per lead (section 2) |
| Ongoing | Frequency | Above 3 → add a new creative (duplicate the ad, swap the image) |
| Ongoing | Profit | Raise budget by **≤ 20% every 3 days**, only while cost per sale stays under ₹414 |

**Reinvestment rule:** of each ₹414 net sale, put **₹200 back into ads** until daily budget reaches ₹500, keep the rest. Stop raising the budget if cost per sale goes above ₹414 for 3 days in a row; fix the funnel first (more guides, better landing page) rather than spending more.

**Stop-loss:** if after ₹3,500 spent (about 2 weeks) there are 0 sales, pause and fix the product before spending more. The usual causes: too few guides for ₹499, or the email offer not reaching inboxes (check Resend logs).

## 7. Free channels (do these the same week — they cost nothing)

- Post each creative on the Vice Vault Facebook Page and Instagram; share the cheat-codes page in GTA groups where self-promotion is allowed.
- Discord: pin the cheat-codes link and the cheat-sheet signup in your server.
- Publish 2–3 more sourced guides a week. More guides = more reasons to pay ₹499, more Google traffic, more AdSense.

## 8. Limits to watch

- **Resend free tier = 100 emails/day.** The follow-up sequence is capped at 30/hour-run to leave room, but once you pass ~40 signups/day, upgrade Resend or emails will queue.
- **Paywall is cosmetic.** Paid guide text is in the page source. Fine for launch; move guide content behind the Worker before scaling spend.
- **Rockstar IP:** creatives use no Rockstar art. Keep it that way; if an ad is rejected for IP, request review and point to the disclaimer.

## 9. Files

| File | Use |
|---|---|
| `vv-cheats-4x5.png` / `-9x16.png` | Lead ad: cheats hook |
| `vv-cash-4x5.png` / `-9x16.png` | Lead ad: beginner pain point |
| `vv-offer-4x5.png` / `-9x16.png` | Retargeting: ₹499 Vault Pass |
| `creatives.html` | Source for all creatives (edit, then re-render with headless Edge) |
