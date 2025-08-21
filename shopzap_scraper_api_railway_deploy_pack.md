# Shopzap Scraper API – Railway Deploy Pack

A ready-to-deploy **Playwright + Node.js** microservice for scraping competitor product data (price, stock, title) and serving it via a simple REST API. Optimized for **Railway.app** deployment.

> **Use case**: Power the MVP for **shopzap.io – Competitor Watcher & Price Alert Bot**. Start cheap, scale later.

---

## ✅ What you get
- **/scrape** API endpoint with smart, site-aware parsing (Amazon.in, Flipkart) + generic fallback
- **Global browser reuse** for performance
- **Retries, timeouts, randomized headers** to reduce blocks
- **Rate limiting** to prevent abuse
- **Dockerfile** using official Playwright image → painless Railway deploy
- **Env-driven** proxy support (optional)

---

## 📁 Project Structure
```
shopzap-scraper/
├─ Dockerfile
├─ package.json
├─ server.js
├─ scraper/
│  ├─ index.js
│  ├─ strategies.js
│  └─ selectors.js
├─ utils/
│  ├─ headers.js
│  └─ wait.js
├─ .env.example
└─ README.md
```

---

## 📦 package.json
```json
{
  "name": "shopzap-scraper",
  "version": "1.0.0",
  "type": "commonjs",
  "main": "server.js",
  "license": "MIT",
  "scripts": {
    "start": "node server.js",
    "dev": "NODE_ENV=development nodemon server.js",
    "postinstall": "npx playwright install chromium"
  },
  "dependencies": {
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "express-rate-limit": "^7.4.0",
    "morgan": "^1.10.0",
    "playwright": "^1.45.0"
  }
}
```

---

## 🐳 Dockerfile
```dockerfile
FROM mcr.microsoft.com/playwright:v1.45.0-jammy
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ENV PORT=8080 NODE_ENV=production
EXPOSE 8080
CMD ["npm","start"]
```

---

## 🔐 .env.example
```env
PORT=8080
SCRAPE_TIMEOUT_MS=20000
SCRAPE_RETRIES=2
HEADLESS=true
# Optional proxy (e.g., http://user:pass@host:port)
PROXY_URL=
# Comma-separated domains to allow (CORS). Empty = all
CORS_ORIGINS=
```

---

## 🧠 scraper/selectors.js
```js
module.exports = {
  amazon: {
    title: "#productTitle",
    price: ".a-price .a-offscreen, span.a-price-whole",
    inStock: "#availability .a-color-success"
  },
  flipkart: {
    title: "span.B_NuCI",
    price: "div._30jeq3._16Jk6d, div._25b18c ._30jeq3",
    inStock: "div._16FRp0\n, div._16FRp0:has(text('Out of stock'))" // heuristic
  }
};
```

---

## 🧠 scraper/strategies.js
```js
const selectors = require('./selectors');

function detectSite(url) {
  const host = new URL(url).hostname;
  if (/amazon\.in$/.test(host)) return 'amazon';
  if (/flipkart\.com$/.test(host)) return 'flipkart';
  return 'generic';
}

async function extractBySelectors(page, rules) {
  const getText = async (sel) => {
    if (!sel) return null;
    const el = await page.$(sel);
    if (!el) return null;
    const txt = (await el.textContent()) || '';
    return txt.trim();
  };
  const title = await getText(rules.title);
  const priceRaw = await getText(rules.price);
  const inStockTxt = (await getText(rules.inStock)) || '';
  return { title, priceRaw, inStockTxt };
}

function normalizePrice(txt) {
  if (!txt) return null;
  const cleaned = txt.replace(/[,\s₹]/g, '').replace(/[^0-9.]/g, '');
  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? num : null;
}

module.exports = {
  detectSite,
  async parse(page, url) {
    const site = detectSite(url);
    if (site !== 'generic') {
      const rules = selectors[site];
      const res = await extractBySelectors(page, rules);
      const price = normalizePrice(res.priceRaw);
      const inStock = /in stock|available|only/.test((res.inStockTxt||'').toLowerCase());
      return { site, title: res.title, price, inStock };
    }

    // Generic fallback: try common meta tags and price patterns
    const title = await page.title().catch(() => null);
    const priceCandidates = await page.$$eval('meta, [itemprop], [class*="price" i], [id*="price" i]', els =>
      els.map(e => e.textContent).filter(Boolean).slice(0, 50)
    ).catch(() => []);
    const priceRaw = priceCandidates.find(t => /\d[\d,\.]*\s?(rs|₹)?/i.test(t || '')) || null;
    const price = priceRaw ? parseFloat((priceRaw.match(/\d[\d,\.]*/)||[''])[0].replace(/[\,]/g,'')) : null;

    return { site, title, price, inStock: null };
  }
};
```

---

## 🧠 scraper/index.js
```js
const { chromium } = require('playwright');
const { parse } = require('./strategies');
const { withJitter } = require('../utils/wait');
const { makeHeaders } = require('../utils/headers');

let browser; // reuse across requests

async function getBrowser() {
  if (browser) return browser;
  const args = [
    '--disable-dev-shm-usage',
    '--no-sandbox',
  ];
  browser = await chromium.launch({
    headless: process.env.HEADLESS !== 'false',
    args,
    proxy: process.env.PROXY_URL ? { server: process.env.PROXY_URL } : undefined,
  });
  return browser;
}

async function fetchProduct(url, { timeoutMs = 20000, retries = 2 } = {}) {
  const br = await getBrowser();
  const ctx = await br.newContext({ extraHTTPHeaders: makeHeaders() });
  const page = await ctx.newPage();
  page.setDefaultTimeout(timeoutMs);

  let attempt = 0, lastErr;
  while (attempt <= retries) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      // Small scroll to trigger lazy content
      await page.evaluate(() => window.scrollBy(0, 400));
      await withJitter(200, 600);
      const data = await parse(page, url);
      await ctx.close();
      return { ok: true, data };
    } catch (err) {
      lastErr = err;
      attempt++;
      await withJitter(400, 1200);
    }
  }
  await ctx.close();
  return { ok: false, error: String(lastErr) };
}

module.exports = { fetchProduct };
```

---

## 🧰 utils/headers.js
```js
const uas = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
];

function makeHeaders() {
  const ua = uas[Math.floor(Math.random()*uas.length)];
  return { 'user-agent': ua };
}

module.exports = { makeHeaders };
```

---

## 🧰 utils/wait.js
```js
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function withJitter(min = 200, max = 800) {
  const d = Math.floor(Math.random()*(max-min+1))+min;
  await sleep(d);
}
module.exports = { sleep, withJitter };
```

---

## 🚏 server.js
```js
require('dotenv').config();
const express = require('express');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { fetchProduct } = require('./scraper');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(morgan('tiny'));
app.use(express.json());

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30, // 30 req/min per IP
});
app.use(limiter);

app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/scrape', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ ok: false, error: 'Missing ?url' });

  const timeoutMs = Number(process.env.SCRAPE_TIMEOUT_MS || 20000);
  const retries = Number(process.env.SCRAPE_RETRIES || 2);

  try {
    const result = await fetchProduct(url, { timeoutMs, retries });
    if (!result.ok) return res.status(502).json(result);
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.listen(PORT, () => console.log(`Shopzap Scraper API listening on :${PORT}`));
```

---

## 🚀 Deploy to Railway (Step-by-step)
1. **Create a new project** in Railway.
2. **New Service → Deploy from Repo** (connect your GitHub repo containing this code).
3. Railway will detect the **Dockerfile** and build automatically.
4. **Set Environment Variables** (in Railway → Variables):
   - `PORT` = `8080`
   - `SCRAPE_TIMEOUT_MS` = `20000`
   - `SCRAPE_RETRIES` = `2`
   - `HEADLESS` = `true`
   - `PROXY_URL` = *(optional, if you have a proxy)*
5. **Deploy** → wait for “Deployed” status.
6. Test the API:
   ```bash
   curl "https://<your-railway-subdomain>.up.railway.app/health"
   curl "https://<your-railway-subdomain>.up.railway.app/scrape?url=https://www.amazon.in/dp/B0C7SGRQHR"
   ```

> **Note**: On some sites, scraping may be restricted by robots.txt or ToS. Stick to public pages, use moderate frequency, and comply with local law. This is not legal advice.

---

## 🧪 Quick local run
```bash
npm install
npm start
# in a new terminal:
curl "http://localhost:8080/scrape?url=https://www.amazon.in/dp/B0C7SGRQHR"
```

---

## 🔧 Tips for Reliability
- Add a small **delay/jitter** between requests (already included).
- **Per-domain throttling** (future: queue by hostname).
- Use **selector overrides** per domain if parsing breaks.
- For higher accuracy, add a **screenshot-on-change** (Playwright `page.screenshot`).

---

## 🔜 Next (optional)
- Add `POST /batch` to scrape multiple URLs.
- Persist results to Supabase + build a dashboard.
- Add Telegram/Email alerts from the API.
- Add basic auth or API key for your endpoint.
```

