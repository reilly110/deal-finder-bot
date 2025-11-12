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
    console.log('🔍 Querying Keepa...');
    
    const keepaUrl = 'https://api.keepa.com/deal';
    const queryJSON = {
      page: 0,
      domainId: 2,
      priceTypes: [0],
      dateRange: 1,  // Last 7 days instead of 24 hours
      deltaPercentRange: [51, 100],  // >50% off (strictly greater)
      isFilterEnabled: true
    };

    const urlWithKey = `${keepaUrl}?key=${KEEPA_API_KEY}`;

    const response = await fetch(urlWithKey, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(queryJSON)
    });

    const data = await response.json();
    
    console.log('Response keys:', Object.keys(data));
    console.log('deals field exists:', !!data.deals);
    console.log('deals is array:', Array.isArray(data.deals));
    
    let products = [];
    
    // Recursively find objects with asin field
    function findProducts(obj, depth = 0) {
      if (depth > 3) return [];
      if (!obj) return [];
      
      if (Array.isArray(obj)) {
        if (obj.length > 0 && obj[0].asin) {
          return obj;
        }
        for (let item of obj) {
          const found = findProducts(item, depth + 1);
          if (found.length > 0) return found;
        }
      } else if (typeof obj === 'object') {
        for (let key in obj) {
          const found = findProducts(obj[key], depth + 1);
          if (found.length > 0) return found;
        }
      }
      return [];
    }
    
    products = findProducts(data);

    if (products.length === 0) {
      console.log('No products array found');
      return [];
    }

    const deals = products.slice(0, 10).map(p => {
      const currentPrice = p.current && p.current[0] ? p.current[0] : 0;
      const avgPrice = p.avg && p.avg[0] ? p.avg[0] : currentPrice;
      
      // Calculate discount percentage from prices
      let discount = 0;
      if (avgPrice > 0 && currentPrice > 0) {
        discount = Math.round(((avgPrice - currentPrice) / avgPrice) * 100);
      }
      
      return {
        asin: p.asin,
        title: p.title || 'Product',
        currentPrice: (currentPrice / 100).toFixed(2),
        avgPrice: (avgPrice / 100).toFixed(2),
        discount: discount,
        link: `https://amazon.co.uk/dp/${p.asin}`
      };
    }).filter(d => d.discount > 50);  // Filter >50% off
    
    console.log(`✅ Found ${deals.length} deals >50% off`);
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
    const embeds = deals.map(d => ({
      title: `🔥 ${d.title.substring(0, 80)}`,
      description: `**${d.discount}% OFF** - £${d.currentPrice}`,
      fields: [
        { name: 'Was', value: `£${d.avgPrice}`, inline: true },
        { name: 'Now', value: `£${d.currentPrice}`, inline: true },
        { name: '📱 Share on X', value: `${d.title.substring(0, 50)}... 🔥 ${d.discount}% OFF! £${d.currentPrice} #AmazonDeals`, inline: false },
        { name: 'Link', value: `[Buy Now](${d.link}?tag=${AMAZON_ASSOCIATES_ID})`, inline: false }
      ],
      color: 16711680
    }));

    const response = await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `🚨 **MEGA DEALS ALERT** 🚨\n🔥 **${deals.length} Amazon UK deals >50% OFF** 🔥\n_Last updated: ${new Date().toLocaleString()}_\n\n⬇️ Copy & Paste Ready 👇`,
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

// Run immediately
runBot();

// Schedule every 6 hours
cron.schedule('0 */6 * * *', runBot);

// HTTP Server
const PORT = process.env.PORT || 3000;
const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'running' }));
  } else if (req.url === '/trigger') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'triggered' }));
    runBot();
  } else if (req.url === '/debug') {
    try {
      const keepaUrl = 'https://api.keepa.com/deal';
      const queryJSON = {
        page: 0,
        domainId: 2,
        priceTypes: [0],
        dateRange: 1,
        deltaPercentRange: [51, 100],
        isFilterEnabled: true
      };

      const urlWithKey = `${keepaUrl}?key=${KEEPA_API_KEY}`;
      const resp = await fetch(urlWithKey, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(queryJSON)
      });

      const data = await resp.json();
      
      res.writeHead(200);
      res.end(JSON.stringify({
        allKeys: Object.keys(data),
        fullResponse: data
      }, null, 2));
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: error.message }));
    }
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

server.listen(PORT, () => {
  console.log(`📡 Listening on port ${PORT}`);
  console.log(`Health: http://localhost:${PORT}/health`);
  console.log(`Trigger: http://localhost:${PORT}/trigger`);
  console.log(`Debug: http://localhost:${PORT}/debug`);
});
