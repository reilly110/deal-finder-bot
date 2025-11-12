const Parser = require('rss-parser');
const cron = require('node-cron');
const http = require('http');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const AMAZON_ASSOCIATES_ID = process.env.AMAZON_ASSOCIATES_ID || 'pricedropuk0c-21';
const MIN_DISCOUNT = 50;  // Only >50% off

if (!DISCORD_WEBHOOK_URL) {
  console.error('Missing DISCORD_WEBHOOK_URL');
  process.exit(1);
}

const parser = new Parser();

async function scrapeDeals() {
  try {
    console.log('🔍 Fetching CamelCamelCamel deals RSS feed...');
    
    // CamelCamelCamel RSS feed for deals
    const feed = await parser.parseURL('https://www.camelcamelcamel.com/rss/deals');
    
    console.log(`📰 Got ${feed.items.length} items from RSS feed`);
    
    const deals = [];

    feed.items.forEach(item => {
      try {
        // Extract ASIN from title or link
        let asin = '';
        
        // Try to extract from link (usually has /dp/ASIN)
        if (item.link) {
          const match = item.link.match(/\/dp\/([A-Z0-9]+)/);
          if (match) asin = match[1];
        }
        
        if (!asin) return;

        const title = item.title || 'Product';
        const description = item.content || item.description || '';

        // Parse description for prices
        // Format usually: "Current Price: $XX.XX | List Price: $YY.YY"
        const currentPriceMatch = description.match(/\$?([\d,]+\.?\d*)/);
        const prices = description.match(/\$([\d,]+\.?\d*)/g);

        if (!currentPriceMatch || prices.length < 2) return;

        const currentPrice = parseFloat(currentPriceMatch[1].replace(/,/g, ''));
        const originalPrice = parseFloat(prices[prices.length - 1].replace(/\$/g, '').replace(/,/g, ''));

        if (currentPrice <= 0 || originalPrice <= 0) return;

        // Calculate discount
        let discount = 0;
        if (originalPrice > currentPrice) {
          discount = Math.round(((originalPrice - currentPrice) / originalPrice) * 100);
        }

        // Only include if >50% off
        if (discount >= MIN_DISCOUNT) {
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
        // Skip malformed items
      }
    });

    console.log(`✅ Found ${deals.length} deals >50% off`);
    return deals.slice(0, 5);  // Top 5

  } catch (error) {
    console.error('Error fetching RSS:', error.message);
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
        content: `🚨 **MEGA DEALS ALERT** 🚨\n🔥 **${deals.length} Amazon deals >50% OFF** 🔥\n_Last updated: ${new Date().toLocaleString()}_\n\n⬇️ Copy & Paste Ready 👇`,
        embeds: embeds,
        username: 'Deals Bot',
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
  console.log('\n🤖 Running Deals Bot...');
  const deals = await scrapeDeals();
  await postToDiscord(deals);
}

console.log('🤖 Deals Bot Started');
runBot();

// Run every hour
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
