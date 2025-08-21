const express = require('express');
const { chromium } = require('playwright');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');
const { nanoid } = require('nanoid');
const axios = require('axios');
const { SocksProxyAgent } = require('socks-proxy-agent');
const express = require('express');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');
require('dotenv').config();

const app = express();

// In-memory API keys for demonstration
const API_KEYS = process.env.API_KEYS ? process.env.API_KEYS.split(',') : ["test-key-123", "pro-user-456"];

// Middleware for API Key Authentication
const apiKeyAuth = (req, res, next) => {
    const apiKey = req.header('x-api-key');
    if (!apiKey) {
        return res.status(401).json({ error: 'Unauthorized: x-api-key header missing.' });
    }
    if (!API_KEYS.includes(apiKey)) {
        return res.status(403).json({ error: 'Forbidden: Invalid x-api-key.' });
    }
    next();
};

// Rate Limiting Middleware
const limiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 20, // 20 requests per minute per IP
    message: { error: 'Rate limit exceeded. Try again later.' },
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});
const PORT = process.env.PORT || 3000;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const PROXY_LIST = process.env.PROXY_LIST ? process.env.PROXY_LIST.split(',') : [];

// Configure lowdb
const file = './db.json';
const adapter = new JSONFile(file);
const db = new Low(adapter, { products: [], scheduledTasks: [] });

// Read data from JSON file, this will set db.data content
db.read();

app.use(express.json());

// Map to store running cron jobs
const runningCronJobs = new Map();

// Function to schedule a task
async function scheduleScrapingTask(task) {
    const { id, url, selector, frequency } = task;
    if (runningCronJobs.has(id)) {
        console.log(`Task ${id} already scheduled.`);
        return;
    }

    const job = cron.schedule(frequency, async () => {
        console.log(`Running scheduled task ${id} for URL: ${url}`);
        await scrapeProduct(url, selector);
    }, {
        scheduled: true,
        timezone: "Asia/Kolkata" // Or appropriate timezone
    });
    runningCronJobs.set(id, job);
    console.log(`Task ${id} scheduled to run with frequency: ${frequency}`);
}

// Load and schedule existing tasks on startup
db.data.scheduledTasks.forEach(task => {
    scheduleScrapingTask(task);
});

app.get('/', (req, res) => {
    res.send('Shopzap Scraper API is running!');
});

// Helper to send stock alert notification
async function sendStockAlert(productName, productUrl) {
    if (!WEBHOOK_URL) {
        console.warn('WEBHOOK_URL not configured. Skipping stock alert.');
        return;
    }
    try {
        await axios.post(WEBHOOK_URL, {
            text: `Stock Alert: ${productName} is now IN STOCK! \n${productUrl}`
        });
        console.log(`Stock alert sent for ${productName}`);
    } catch (error) {
        console.error('Failed to send stock alert:', error.message);
    }
}

// Scraper functions for different sites
const scrapers = {
    'amazon': async (page) => {
        const title = await page.$eval('#productTitle', el => el.innerText.trim()).catch(() => null);
        const raw_price = await page.$eval('.a-price-whole', el => el.innerText.trim()).catch(() => null);
        const numeric_price = raw_price ? parseFloat(raw_price.replace(/[^0-9.-]+/g," ").trim().split(' ')[0]) : null;
        const stock = await page.$eval('#availability span', el => el.innerText.trim()).catch(() => null);
        const seller = await page.$eval('#sellerProfileTriggerId', el => el.innerText.trim()).catch(() => null);
        return { title, raw_price, numeric_price, stock, seller };
    },
    'flipkart': async (page) => {
        const title = await page.$eval('h1.yhB1K5 span', el => el.innerText.trim()).catch(() => null);
        const raw_price = await page.$eval('div._30jeq3._16Jk6d', el => el.innerText.trim()).catch(() => null);
        const numeric_price = raw_price ? parseFloat(raw_price.replace(/[^0-9.-]+/g," ").trim().split(' ')[0]) : null;
        const stock = await page.$eval('div._16Jk6d', el => el.innerText.includes('Out of Stock') ? 'Out of Stock' : 'In Stock').catch(() => null);
        const seller = await page.$eval('div._1RLi3', el => el.innerText.trim()).catch(() => null);
        return { title, raw_price, numeric_price, stock, seller };
    },
    'myntra': async (page) => {
        const title = await page.$eval('.pdp-title', el => el.innerText.trim()).catch(() => null);
        const raw_price = await page.$eval('.pdp-price .pdp-discounted-price', el => el.innerText.trim()).catch(() => null);
        const numeric_price = raw_price ? parseFloat(raw_price.replace(/[^0-9.-]+/g," ").trim().split(' ')[0]) : null;
        const stock = await page.$eval('.pdp-size-buttons', el => el.innerText.includes('Out of stock') ? 'Out of Stock' : 'In Stock').catch(() => null);
        const seller = await page.$eval('.supplier-info a', el => el.innerText.trim()).catch(() => null);
        return { title, raw_price, numeric_price, stock, seller };
    },
    'default': async (page, selector) => {
        const data = await page.evaluate((sel) => {
            const element = document.querySelector(sel);
            return element ? element.innerText : null;
        }, selector);
        return { data };
    }
};

function detectSite(url) {
    if (url.includes('amazon.in') || url.includes('amazon.com')) return 'amazon';
    if (url.includes('flipkart.com')) return 'flipkart';
    if (url.includes('myntra.com')) return 'myntra';
    return 'default';
}

// Main scraping logic encapsulated in a function for reusability
async function scrapeProduct(url, selector) {
    let browser;
    let result = { url };
    let proxyAgent;

    try {
        const launchOptions = {};
        if (PROXY_LIST.length > 0) {
            const proxy = PROXY_LIST[Math.floor(Math.random() * PROXY_LIST.length)];
            // Playwright's launch options for proxy are for HTTP/HTTPS proxies.
            // For SOCKS proxies, we need to use an agent for Node.js http/https requests.
            // However, Playwright itself needs to be configured for the browser's network.
            // For chromium, --proxy-server is the way.
            launchOptions.proxy = { server: proxy };
            console.log(`Using proxy: ${proxy}`);
        }

        browser = await chromium.launch(launchOptions);
        const page = await browser.newPage();

        // Set up a route to handle requests and potentially use a SOCKS proxy agent
        // This part is more complex as Playwright's page.route doesn't directly support socks-proxy-agent for browser requests.
        // The --proxy-server launch option is generally preferred for Playwright for full browser traffic.
        // If SOCKS proxy is strictly needed and --proxy-server doesn't work, consider a custom proxy setup or a different Playwright configuration.

        await page.goto(url, { waitUntil: 'domcontentloaded' });

        const site = detectSite(url);
        let scrapedData;

        if (site === 'default' && !selector) {
            throw new Error('Selector is required for default scraping.');
        }

        if (site === 'default') {
            scrapedData = await scrapers[site](page, selector);
        } else {
            scrapedData = await scrapers[site](page);
        }

        if (!scrapedData || Object.values(scrapedData).every(val => val === null)) {
            throw new Error('Could not scrape data. Element(s) not found or site not supported.');
        }

        // Price History Tracking
        const productId = url; // Using URL as a simple product ID for now
        let product = db.data.products.find(p => p.id === productId);

        if (!product) {
            product = { id: productId, history: [] };
            db.data.products.push(product);
        }

        const currentPrice = scrapedData.numeric_price; // Using numeric_price for history tracking
        const currentStock = scrapedData.stock; // Assuming stock is part of scrapedData

        // Check for stock alert
        const previousStock = product.history.length > 0 ? product.history[product.history.length - 1].stock : null;
        if (previousStock === 'Out of Stock' && currentStock === 'In Stock') {
            sendStockAlert(scrapedData.title || url, url);
        }

        if (currentPrice !== null || currentStock !== null) {
            product.history.push({ price: currentPrice, stock: currentStock, timestamp: new Date().toISOString() });
            // Keep only the last 5 price changes
            if (product.history.length > 5) {
                product.history = product.history.slice(-5);
            }
        }
        await db.write();

        result = { ...scrapedData, url, priceHistory: product.history };

    } catch (error) {
        console.error('Scraping error:', error);
        result.error = error.message;
    } finally {
        if (browser) {
            await browser.close();
        }
    }
    return result;
}

app.post('/scrape', apiKeyAuth, limiter, async (req, res) => {
    const { url, selector } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'URL is required.' });
    }

    const result = await scrapeProduct(url, selector);

    if (result.error) {
        if (result.error.includes('Selector is required')) {
            return res.status(400).json({ error: result.error });
        } else if (result.error.includes('Could not scrape data')) {
            return res.status(404).json({ error: result.error });
        } else {
            return res.status(500).json({ error: 'Failed to scrape data.', details: result.error });
        }
    }
    res.json(result);
});

// Scraper functions for search results
const searchScrapers = {
    'amazon': async (page, keyword) => {
        await page.goto(`https://www.amazon.in/s?k=${encodeURIComponent(keyword)}`, { waitUntil: 'domcontentloaded' });
        const products = await page.$$eval('.s-result-item', (items) => {
            return items.slice(0, 5).map(item => {
                const title = item.querySelector('h2 a span')?.innerText.trim();
                const raw_price = item.querySelector('.a-price-whole')?.innerText.trim();
                const numeric_price = raw_price ? parseFloat(raw_price.replace(/[^0-9.-]+/g," ").trim().split(' ')[0]) : null;
                const stock = item.querySelector('.a-color-price')?.innerText.trim(); // Amazon often shows 'Currently unavailable' here
                const url = item.querySelector('h2 a')?.href;
                return { title, raw_price, numeric_price, stock, url };
            }).filter(product => product.title && product.raw_price);
        });
        return products;
    },
    'flipkart': async (page, keyword) => {
        await page.goto(`https://www.flipkart.com/search?q=${encodeURIComponent(keyword)}`, { waitUntil: 'domcontentloaded' });
        const products = await page.$$eval('div._1AtVbE', (items) => {
            return items.slice(0, 5).map(item => {
                const title = item.querySelector('div._4rR01T')?.innerText.trim();
                const raw_price = item.querySelector('div._30jeq3')?.innerText.trim();
                const numeric_price = raw_price ? parseFloat(raw_price.replace(/[^0-9.-]+/g," ").trim().split(' ')[0]) : null;
                const stock = item.querySelector('div.gUuXy-._16Jk6d')?.innerText.trim(); // Flipkart often shows 'Out of Stock' or 'In Stock'
                const url = item.querySelector('a._1fQZEK')?.href;
                return { title, raw_price, numeric_price, stock, url: url ? `https://www.flipkart.com${url}` : null };
            }).filter(product => product.title && product.raw_price);
        });
        return products;
    },
    'myntra': async (page, keyword) => {
        await page.goto(`https://www.myntra.com/${encodeURIComponent(keyword)}`, { waitUntil: 'domcontentloaded' });
        const products = await page.$$eval('.product-base', (items) => {
            return items.slice(0, 5).map(item => {
                const title = item.querySelector('.product-productMetaInfo .product-brand')?.innerText.trim() + ' ' + item.querySelector('.product-productMetaInfo .product-product')?.innerText.trim();
                const raw_price = item.querySelector('.product-price .product-discountedPrice')?.innerText.trim();
                const numeric_price = raw_price ? parseFloat(raw_price.replace(/[^0-9.-]+/g," ").trim().split(' ')[0]) : null;
                const stock = item.querySelector('.product-sizes')?.innerText.trim() ? 'In Stock' : 'Out of Stock'; // Myntra doesn't explicitly show stock, infer from sizes
                const url = item.querySelector('.product-base a')?.href;
                return { title, raw_price, numeric_price, stock, url: url ? `https://www.myntra.com/${url}` : null };
            }).filter(product => product.title && product.raw_price);
        });
        return products;
    }
};

app.get('/search', async (req, res) => {
    const { site, keyword } = req.query;

    if (!site || !keyword) {
        return res.status(400).json({ error: 'Site and keyword are required.' });
    }

    const scraper = searchScrapers[site.toLowerCase()];
    if (!scraper) {
        return res.status(400).json({ error: `Search not supported for site: ${site}. Supported sites: ${Object.keys(searchScrapers).join(', ')}` });
    }

    let browser;
    let results = [];
    try {
        const launchOptions = {};
        if (PROXY_LIST.length > 0) {
            const proxy = PROXY_LIST[Math.floor(Math.random() * PROXY_LIST.length)];
            launchOptions.proxy = { server: proxy };
            console.log(`Using proxy: ${proxy}`);
        }

        browser = await chromium.launch(launchOptions);
        const page = await browser.newPage();

        results = await scraper(page, keyword);

        if (results.length === 0) {
            return res.status(404).json({ message: 'No products found for the given keyword on this site.' });
        }

        res.json(results);

    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ error: 'Failed to perform search.', details: error.message });
    } finally {
        if (browser) {
            await browser.close();
        }
    }
});

// Endpoint to schedule a scraping task
app.post('/schedule', async (req, res) => {
    const { url, selector, frequency } = req.body;

    if (!url || !frequency) {
        return res.status(400).json({ error: 'URL and frequency are required.' });
    }

    // Basic frequency validation (e.g., cron string format)
    // More robust validation can be added here
    if (!cron.validate(frequency)) {
        return res.status(400).json({ error: 'Invalid cron frequency format.' });
    }

    const taskId = nanoid();
    const newTask = { id: taskId, url, selector, frequency };

    db.data.scheduledTasks.push(newTask);
    await db.write();

    scheduleScrapingTask(newTask);

    res.status(201).json({ message: 'Task scheduled successfully', taskId });
});

// Endpoint to list all scheduled tasks
app.get('/schedules', (req, res) => {
    res.json(db.data.scheduledTasks);
});

// Endpoint to remove a scheduled task
app.delete('/schedule/:id', async (req, res) => {
    const { id } = req.params;

    const taskIndex = db.data.scheduledTasks.findIndex(task => task.id === id);

    if (taskIndex === -1) {
        return res.status(404).json({ error: 'Scheduled task not found.' });
    }

    // Stop the cron job if it's running
    const job = runningCronJobs.get(id);
    if (job) {
        job.stop();
        runningCronJobs.delete(id);
        console.log(`Stopped cron job for task ${id}`);
    }

    db.data.scheduledTasks.splice(taskIndex, 1);
    await db.write();

    res.json({ message: 'Task unscheduled successfully', taskId: id });
});

app.post('/bulk-scrape', async (req, res) => {
    const { urls } = req.body;

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
        return res.status(400).json({ error: 'An array of URLs is required for bulk scraping.' });
    }

    const results = [];
    for (const item of urls) {
        const url = typeof item === 'string' ? item : item.url;
        const selector = typeof item === 'object' ? item.selector : undefined;
        results.push(await scrapeProduct(url, selector));
    }

    res.json(results);
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});