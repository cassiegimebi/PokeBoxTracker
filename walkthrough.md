# ポケtracker — Complete Walkthrough

## What it does

A self-updating Pokémon card market dashboard that:
- Fetches real PSA10 last-sale prices from **SNKRDUNK's internal JSON API** every 3 hours via GitHub Actions
- Stores price history (going back to **2023**) in `data/prices.json`
- Serves a static dashboard on **GitHub Pages** — no server needed
- Shows sales activity (today / this week), price trend, and full history chart
- Plays a **chime + browser notification** when a price spikes above your threshold

---

## Project Structure

```
ポケtracker/
├── index.html                  ← Dashboard layout (HTML skeleton only)
├── styles.css                  ← All UI styling
├── app.js                      ← Dashboard logic, chart, alert system
├── data/
│   └── prices.json             ← THE DATA FILE — read by frontend, written by scraper
├── src/
│   ├── config.json             ← Cards you want to track
│   ├── fetchData.js            ← Main scraper pipeline (runs in GitHub Actions)
│   └── scrapers/
│       ├── snkrdunk.js         ← SNKRDUNK API calls (PSA10 prices + sales counts)
│       ├── cardrush.js         ← Card Rush scraper (Raw prices)
│       └── pokemonpricetracker.js ← PPT scraper (USD prices)
└── .github/
    └── workflows/
        └── update-prices.yml   ← Cron job: runs every 3 hours, commits new prices
```

---

## The Data File — `data/prices.json`

This is the source of truth. Everything the dashboard shows comes from here.

**Structure:**
```json
{
  "sv2a-173_PSA10": {
    "metadata": {
      "name_en": "Pikachu AR",
      "name_ja": "ピカチュウ AR",
      "number": "173/165",
      "condition": "PSA10",
      "imageUrl": "https://assets.tcgdex.net/..."
    },
    "history": [
      {
        "date": "2023-06-21",
        "snkrdunk_jpy": 85999,
        "cardrush_jpy": null,
        "ppt_usd": null,
        "snkrdunk_sales_24h": null,
        "snkrdunk_sales_7d": null
      },
      {
        "date": "2026-04-06",
        "snkrdunk_jpy": 96800,
        "cardrush_jpy": null,
        "ppt_usd": null,
        "snkrdunk_sales_24h": 2,
        "snkrdunk_sales_7d": 32
      }
    ]
  }
}
```

**Key:** `{tcgdex_id}_{condition}` — e.g. `sv2a-173_PSA10` or `sv2a-173_Raw`

> Historical entries (before Apr 2026) have `null` for `sales_24h`/`sales_7d` — that's normal, only daily scrape runs populate those.

---

## Adding / Removing a Card

Edit **`src/config.json`**. Each entry is one tracked variant:

```json
{
  "tcgdex_id": "sv2a-173",        ← TCGdex card ID (used for image lookup)
  "name_en": "Pikachu AR",        ← Display name (English)
  "name_ja": "ピカチュウ AR",     ← Display name (Japanese)
  "condition": "PSA10",           ← "PSA10" or "Raw"
  "snkrdunk_product_id": 105553,  ← SNKRDUNK numeric product ID (PSA10 only)
  "imageUrl": "https://..."       ← Optional override if TCGdex doesn't have the card
}
```

**For Raw cards**, use `cardrush_url` instead of `snkrdunk_product_id`:
```json
{
  "tcgdex_id": "sv2a-173",
  "name_en": "Pikachu AR",
  "name_ja": "ピカチュウ AR",
  "condition": "Raw",
  "cardrush_url": "https://www.cardrush-pokemon.jp/product-list?keyword=sv2a+173"
}
```

### How to find a SNKRDUNK product ID
1. Go to the card's page on `snkrdunk.com`
2. The URL is: `https://snkrdunk.com/apparels/{NUMBER}` — that number is the product ID

> ⚠️ If you **remove** a card from `config.json`, its data will be **deleted** from `prices.json` on the next scraper run (by the pruning logic in `fetchData.js`).

---

## The Scraper — `src/scrapers/snkrdunk.js`

Calls two SNKRDUNK API endpoints:

| Endpoint | Used for |
|---|---|
| `GET /v1/apparels/{id}/sales-history?size_id=0&page=1&per_page=50` | Last 50 sales → get latest PSA10 price + count sales by date |
| `GET /v1/apparels/{id}/sales-chart/used?range=all&salesChartOptionId=22` | Full price history chart (PSA10 only) — fallback if no recent PSA10 sales |

**`salesChartOptionId=22` = PSA10 grade filter** on SNKRDUNK.

**Returns:** `{ price: number|null, sales24h: number, sales7d: number }`

Sales counts work by parsing Japanese relative date strings from the sales-history API:
- `"21時間前"` (21 hours ago) → counts as **today**
- `"3日前"` (3 days ago) → counts in **7-day** total

---

## The Pipeline — `src/fetchData.js`

Runs in GitHub Actions on every trigger. For each card in `config.json`:

1. Fetch metadata from TCGdex API (card name, image URL)
2. **First run only:** Backfill full price history from SNKRDUNK chart API
3. Fetch fresh price + sales counts from SNKRDUNK
4. Fetch Card Rush price (for Raw cards)
5. Check for price spike → log alert (webhook TODO)
6. Write to `data/prices.json`

**Price spike threshold:** `ALERT_THRESHOLD = 0.15` (15%) — change this constant to adjust.

---

## The Alert System — `app.js`

Three-layer alert when a price rises above your threshold:

| Layer | What happens |
|---|---|
| **Chime** | Two-tone sine wave (A5 → C#6) via Web Audio API — no audio file needed |
| **Browser notification** | macOS system notification popup (also plays system sound) |
| **Banner** | Green slide-down banner in the dashboard with the card name + % change |

**Settings (stored in `localStorage`):**

| Setting | Default | What it does |
|---|---|---|
| `threshold` | 10% | Min % price increase to trigger alert |
| `muted` | false | Silences the chime (notifications still fire) |

**How it works:**
- On page load, `initLastKnownPrices()` snapshots all current PSA10 prices
- `startPolling()` re-fetches `prices.json` every **5 minutes**
- `checkForAlerts()` compares the new prices to the snapshot → triggers if `(new - old) / old >= threshold`

> The alerts **only work while the dashboard tab is open**. For background alerts, LINE Notify or a native macOS cron script would be needed.

**Test it:** Click **▶ Test chime** in the sidebar — it plays the sound and asks for notification permission.

---

## GitHub Deployment — What to Push

### Files changed in this session:

```
✅ src/scrapers/snkrdunk.js   ← Complete rewrite (API-based, returns sales counts)
✅ src/fetchData.js           ← New pipeline (backfill, sales fields, alert stub)
✅ src/config.json            ← 18 entries with real product IDs + Raw cards
✅ data/prices.json           ← 5,394 real data points from 2023
✅ index.html                 ← New 4-stat layout
✅ styles.css                 ← New styles + alert panel + banner
✅ app.js                     ← Full dashboard logic + alert system
```

### Push commands (run in your Terminal.app):

```bash
cd ~/Documents/Antigravity/ポケtracker

# Stage all changes
git add .

# Commit
git commit -m "feat: real SNKRDUNK API, 3y price history, sales stats, alerts"

# Push
git push origin main
```

> After pushing, go to your repo on GitHub → **Actions** tab → you'll see the `update-prices.yml` workflow. You can also click **Run workflow** manually to trigger a fresh scrape right away.

### Fix `npm ci` in GitHub Actions

The workflow uses `npm ci` which requires a `package-lock.json`. To fix this, **open Terminal.app** and run:

```bash
cd ~/Documents/Antigravity/ポケtracker
# Use nvm to get npm working
nvm use 20
npm install          # generates package-lock.json
git add package-lock.json
git commit -m "chore: add package-lock.json for CI"
git push
```

---

## Running Locally

**Frontend only** (no npm needed):
```bash
python3 -m http.server 3000 --directory ~/Documents/Antigravity/ポケtracker
# Open: http://localhost:3000
```

**Refresh prices manually** (needs npm install first):
```bash
cd ~/Documents/Antigravity/ポケtracker
nvm use 20
npm install          # only needed once
node src/fetchData.js
```

---

## Modifying Things

### Change the price spike threshold in the dashboard
- Open `http://localhost:3000`
- In the sidebar, change the **Threshold %** field (default: 10%)
- It saves automatically to `localStorage`

### Change the polling interval (how often dashboard checks for updates)
In `app.js`, change:
```js
const POLL_INTERVAL_MS = 5 * 60 * 1000;  // currently 5 minutes
```

### Change how often GitHub Actions scrapes
In `.github/workflows/update-prices.yml`:
```yaml
schedule:
  - cron: '0 */3 * * *'   # every 3 hours — change to your liking
```

### Add a new card
1. Find the SNKRDUNK product ID from the URL
2. Add an entry to `src/config.json`
3. Push → the next GitHub Actions run will backfill its full price history automatically

### Change the backend spike threshold (for future webhook alerts)
In `src/fetchData.js`:
```js
const ALERT_THRESHOLD = 0.15;  // 15% — logs to console currently
```
The `checkPriceAlert()` function has a `// TODO` comment where you'd add a LINE / Discord webhook call.

---

## Current Data (Live as of Apr 6, 2026)

| Card | Condition | Last PSA10 Sale | Sales Today | Sales 7d |
|---|---|---|---|---|
| Pikachu AR | PSA10 | ¥96,800 | 2 | 32 |
| Pikachu VMAX CSR | PSA10 | ¥54,299 | 1 | 15 |
| Mew ex SAR | PSA10 | ¥153,000 | 5 | 13 |
| Mew ex UR | PSA10 | ¥46,400 | 3 | 27 |
| Umbreon Star 25th | PSA10 | ¥58,400 | 13 | 45 |
| Umbreon VMAX SA | PSA10 | ¥705,000 | 0 | 7 |
| Eevee AR | PSA10 | ¥14,300 | 5 | 16 |
| Charizard ex SAR 151 | PSA10 | ¥153,000 | 0 | 23 |
| Charizard ex SAR Shiny | PSA10 | ¥87,000 | 9 | 24 |
