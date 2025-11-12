const puppeteer = require('puppeteer');
const cron = require('node-cron');
const http = require('http');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const AMAZON_ASSOCIATES_ID = process.env.AMAZON_ASSOCIATES_ID || 'pricedropuk0c-21';
const MIN_PRICE = 50;
const MIN_DISCOUNT = 10;
const MAX_DISCOUNT = 90;

if (!DISCORD_WEBHOOK_URL) {
  console.error('Missing DISCORD_WEBHOOK_URL');
  process.exit(1);
}

async function scrapeLightningDeals() {
  let browser;
  try {
    console.log('🔍 Scraping Amazon Lightning Deals with Puppeteer...');
    
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage'
      ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    
    console.log('⏳ Loading page...');
    await page.goto('https://amazon.com/gp/goldbox', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    console.log('⏳ Waiting for deals to load...');
    await page.waitForSelector('[data-component-type="s-deal-card"]', { timeout: 10000 }).catch(() => {
      console.log('⚠️  Deal cards selector not found, trying alternate');
    });

    // Extract deals using page.evaluate
    const deals = await page.evaluate(() => {
      const dealElements = document.querySelectorAll('[data-component-type="s-deal-card"]');
      const deals = [];

      dealElements.forEach(el => {
        try {
          // Extract ASIN from link
          const link = el.querySelector('a[href*="/dp/"]');
          if (!link) return;
          
          const href = link.getAttribute('href');
          const asinMatch = href.match(/\/dp\/([A-Z0-9]+)/);
          if (!asinMatch) return;
          const asin = asinMatch[1];

          // Extract title
          const titleEl = el.querySelector('[data-a-size="base"]');
          const title = titleEl ? titleEl.textContent.trim() : 'Product';

          // Extract prices
          const priceEl = el.querySelector('[data-a-color="price"]');
          const originalPriceEl = el.querySelector('[data-a-strike="true"]');

          if (!priceEl) return;

          const priceText = priceEl.textContent.trim();
          const originalPriceText = originalPriceEl ? originalPriceEl.textContent.trim() : null;

          // Parse current price
          const priceMatch = priceText.match(/\$?([\d,]+\.?\d*)/);
          if (!priceMatch) return;
          const currentPrice = parseFloat(priceMatch[1].replace(/,/g, ''));

          // Parse original price
          let originalPrice = currentPrice;
          if (originalPriceText) {
            const origMatch = originalPriceText.match(/\$?([\d,]+\.?\d*)/);
            if (origMatch) {
              originalPrice = parseFloat(origMatch[1].replace(/,/g, ''));
            }
          }

          // Calculate discount
          let discount = 0;
          if (originalPrice > currentPrice) {
            discount = Math.round(((originalPrice - currentPrice) / originalPrice) * 100);
          }

          deals.push({
            asin: asin,
            title: title,
            currentPrice: currentPrice,
            originalPrice: originalPrice,
            discount: discount,
            link: `https://amazon.com/dp/${asin}`
          });
        } catch (e) {
          // Skip malformed deals
        }
      });

      return deals;
    });

    console.log(`✅ Found ${deals.length} total deals from page`);

    // Filter deals
    const filtered = deals.filter(d => 
      d.currentPrice >= MIN_PRICE && 
      d.discount >= MIN_DISCOUNT && 
      d.discount <= MAX_DISCOUNT
    );

    console.log(`✅ Filtered to ${filtered.length} deals: $${MIN_PRICE}+ with ${MIN_DISCOUNT}-${MAX_DISCOUNT}% off`);
    return filtered.slice(0, 5);

  } catch (error) {
    console.error('Scraping error:', error.message);
    return [];
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

async function postToDiscord(deals) {
  if (deals.length === 0) {
    console.log('No deals to post');
    return;
  }

  try {
    console.log(`📤 Posting ${deals.length} deals to Discord...`);

    const embeds = deals.map(d => ({
      title: `🔥 ${d.title.substring(0, 80)}`,
      description: `**${d.discount}% OFF** - $${d.currentPrice.toFixed(2)}`,
      fields: [
        { name: 'Was', value: `$${d.originalPrice.toFixed(2)}`, inline: true },
        { name: 'Now', value: `$${d.currentPrice.toFixed(2)}`, inline: true },
        { name: '📱 Share on X', value: `${d.title.substring(0, 50)}... 🔥 ${d.discount}% OFF! $${d.currentPrice.toFixed(2)} #AmazonDeals`, inline: false },
        { name: 'Link', value: `[Buy Now](${d.link}?tag=${AMAZON_ASSOCIATES_ID})`, inline: false }
      ],
      color: 16711680
    }));

    const response = await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `🚨 **LIGHTNING DEALS ALERT** 🚨\n🔥 **${deals.length} Amazon deals ${MIN_DISCOUNT}-${MAX_DISCOUNT}% OFF** ($${MIN_PRICE}+)\n_Last updated: ${new Date().toLocaleString()}_\n\n⬇️ Copy & Paste Ready 👇`,
        embeds: embeds,
        username: 'Lightning Deals Bot',
        avatar_url: 'https://cdn-icons-png.flaticon.com/512/2721/2721215.png'
      })
    });

    if (response.ok) {
      console.log('✅ Posted to Discord');
    } else {
      console.error(`Discord error: ${response.status}`);
    }
  } catch (error) {
    console.error('Discord error:', error.message);
  }
}

async function runBot() {
  console.log('\n🤖 Running Lightning Deals Bot...');
  const deals = await scrapeLightningDeals();
  await postToDiscord(deals);
}

console.log('🤖 Lightning Deals Bot Started');
runBot();

// Run every 2 hours
cron.schedule('0 */2 * * *', runBot);

// HTTP Server
const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'running' }));
  } else if (req.url === '/trigger') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'triggered' }));
    runBot();
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

server.listen(PORT, () => {
  console.log(`📡 Listening on port ${PORT}`);
  console.log(`Trigger: https://deal-finder-bot-sbd8.onrender.com/trigger`);
});
