const fetch = require('node-fetch');
const cron = require('node-cron');
const http = require('http');

const KEEPA_API_KEY = process.env.KEEPA_API_KEY;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const AMAZON_ASSOCIATES_ID = process.env.AMAZON_ASSOCIATES_ID || 'pricedropuk0c-21';

if (!KEEPA_API_KEY || !DISCORD_WEBHOOK_URL) {
  console.error('Missing environment variables');
  process.exit(1);
}

async function fetchDealsFromKeepa() {
  try {
    console.log('🔍 Fetching deals...');
    
    const keepaUrl = 'https://api.keepa.com/deal';
    const queryJSON = {
      page: 0,
      domainId: 1,
      priceTypes: [0],
      dateRange: 1,
      deltaPercentRange: [10, 100],  // Get broader range, filter >50% ourselves
      isFilterEnabled: true
    };

    const urlWithKey = `${keepaUrl}?key=${KEEPA_API_KEY}`;
    const response = await fetch(urlWithKey, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(queryJSON)
    });

    const data = await response.json();
    console.log(`Tokens left: ${data.tokensLeft}`);

    // Recursively find products array
    function findProductsArray(obj, depth = 0) {
      if (depth > 5) return [];
      if (!obj) return [];
      
      if (Array.isArray(obj)) {
        if (obj.length > 0 && obj[0].asin && obj[0].current && obj[0].avg) {
          return obj;
        }
        for (let item of obj) {
          const found = findProductsArray(item, depth + 1);
          if (found.length > 0) return found;
        }
      } else if (typeof obj === 'object') {
        for (let key in obj) {
          const found = findProductsArray(obj[key], depth + 1);
          if (found.length > 0) return found;
        }
      }
      return [];
    }

    const products = findProductsArray(data);
    
    if (!products || products.length === 0) {
      console.log('No products found');
      return [];
    }

    // Calculate discount for each product
    const allDeals = products.map(p => {
      const currentPrice = (Array.isArray(p.current) && p.current[0]) ? p.current[0] : 0;
      const avgPrice = (Array.isArray(p.avg) && Array.isArray(p.avg[0]) && p.avg[0][0]) ? p.avg[0][0] : 0;
      
      // USE deltaPercent[0][0] - KEEPA'S CURRENT DISCOUNT PERCENTAGE
      let discount = 0;
      if (Array.isArray(p.deltaPercent) && Array.isArray(p.deltaPercent[0])) {
        discount = Math.abs(p.deltaPercent[0][0]);
      }
      
      return {
        asin: p.asin,
        title: p.title || 'Product',
        currentPrice: (currentPrice / 100).toFixed(2),
        avgPrice: (avgPrice / 100).toFixed(2),
        discount: discount,
        link: `https://amazon.com/dp/${p.asin}`
      };
    });
    
    // Log stats
    const maxDiscount = Math.max(...allDeals.map(d => d.discount));
    console.log(`Max discount found: ${maxDiscount}%`);
    
    // Filter for >50%
    const deals = allDeals.filter(d => d.discount > 50).slice(0, 5);

    console.log(`✅ Found ${deals.length} verified deals >50% off`);
    return deals;

  } catch (error) {
    console.error('Error:', error.message);
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
        { name: 'Was', value: `$${d.avgPrice}`, inline: true },
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
        username: 'Deal Finder Bot',
        avatar_url: 'https://cdn-icons-png.flaticon.com/512/2721/2721215.png'
      })
    });

    if (response.ok) {
      console.log('✅ Posted to Discord');
    }
  } catch (error) {
    console.error('Discord error:', error.message);
  }
}

async function runBot() {
  console.log('\n🤖 Running bot...');
  const deals = await fetchDealsFromKeepa();
  await postToDiscord(deals);
}

console.log('🤖 Deal Finder Bot Started');
runBot();

// Schedule every 6 hours
cron.schedule('0 */6 * * *', runBot);

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
