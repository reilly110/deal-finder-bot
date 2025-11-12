const cheerio = require('cheerio');
const cron = require('node-cron');
const http = require('http');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const AMAZON_ASSOCIATES_ID = process.env.AMAZON_ASSOCIATES_ID || 'pricedropuk0c-21';
const MIN_PRICE = 50;  // Lowered to $50 to test
const MIN_DISCOUNT = 10; // Lowered to 10% to test
const MAX_DISCOUNT = 90;

if (!DISCORD_WEBHOOK_URL) {
  console.error('Missing DISCORD_WEBHOOK_URL');
  process.exit(1);
}

async function scrapeLightningDeals() {
  try {
    console.log('🔍 Scraping Amazon Lightning Deals...');
    
    const response = await fetch('https://amazon.com/gp/goldbox', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Referer': 'https://www.amazon.com/',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      }
    });

    if (!response.ok) {
      console.error(`Failed to fetch: ${response.status}`);
      return [];
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    
    // Debug: check if we got actual Amazon page
    const pageTitle = $('title').text();
    console.log(`Page title: ${pageTitle}`);
    console.log(`HTML length: ${html.length} characters`);
    
    // Look for deal card selectors
    const dealCards = $('[data-component-type="s-deal-card"]');
    console.log(`Found ${dealCards.length} deal cards with selector 1`);
    
    // Try alternate selectors
    const dealCards2 = $('.s-deal-card');
    console.log(`Found ${dealCards2.length} deal cards with selector 2`);
    
    const allDivs = $('div[class*="deal"]');
    console.log(`Found ${allDivs.length} divs with "deal" in class`);
    
    const deals = [];
    
    // Amazon Lightning Deals structure - look for deal items
    $('[data-component-type="s-deal-card"]').each((idx, element) => {
      try {
        const $el = $(element);
        
        // Extract ASIN from link
        const link = $el.find('a[href*="/dp/"]').attr('href');
        if (!link) return;
        
        const asinMatch = link.match(/\/dp\/([A-Z0-9]+)/);
        if (!asinMatch) return;
        const asin = asinMatch[1];
        
        // Extract title
        const title = $el.find('[data-a-size="base"]').first().text().trim();
        if (!title) return;
        
        // Extract prices - look for current and original
        const priceText = $el.find('[data-a-color="price"]').text().trim();
        const originalPriceText = $el.find('[data-a-strike="true"]').text().trim();
        
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
        
        // Filter: price >= MIN_PRICE AND discount between MIN_DISCOUNT and MAX_DISCOUNT
        if (currentPrice >= MIN_PRICE && discount >= MIN_DISCOUNT && discount <= MAX_DISCOUNT) {
          deals.push({
            asin: asin,
            title: title,
            currentPrice: currentPrice.toFixed(2),
            originalPrice: originalPrice.toFixed(2),
            discount: discount,
            link: `https://amazon.com/dp/${asin}`
          });
        }
      } catch (e) {
        // Skip malformed deals
      }
    });
    
    console.log(`✅ Found ${deals.length} deals: $${MIN_PRICE}+ with ${MIN_DISCOUNT}-${MAX_DISCOUNT}% off`);
    return deals.slice(0, 5);  // Top 5

  } catch (error) {
    console.error('Scraping error:', error.message);
    return [];
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
      description: `**${d.discount}% OFF** - $${d.currentPrice}`,
      fields: [
        { name: 'Was', value: `$${d.originalPrice}`, inline: true },
        { name: 'Now', value: `$${d.currentPrice}`, inline: true },
        { name: '📱 Share on X', value: `${d.title.substring(0, 50)}... 🔥 ${d.discount}% OFF! $${d.currentPrice} #AmazonDeals`, inline: false },
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

// Run every hour (lightning deals refresh frequently)
cron.schedule('0 * * * *', runBot);

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
