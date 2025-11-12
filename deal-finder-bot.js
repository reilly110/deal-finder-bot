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
      dateRange: 0,
      deltaPercentRange: [50, 100],
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
    
    // deals is NOT an array, it's metadata. Look for products array
    let products = [];
    
    // Try to find an array of products
    for (const key in data) {
      if (Array.isArray(data[key]) && data[key].length > 0) {
        if (typeof data[key][0] === 'object' && data[key][0].asin) {
          products = data[key];
          console.log(`Found products in field: ${key} (${products.length} items)`);
          break;
        }
      }
    }

    if (products.length === 0) {
      console.log('No products array found');
      return [];
    }

    const deals = products.slice(0, 5).map(p => ({
      asin: p.asin,
      title: p.title || 'Product',
      currentPrice: p.current ? (p.current[0] / 100).toFixed(2) : 'N/A',
      avgPrice: p.avg ? (p.avg[0] / 100).toFixed(2) : 'N/A',
      discount: Math.abs(p.delta || 0),
      link: `https://amazon.co.uk/dp/${p.asin}`
    }));

    console.log(`✅ Found ${deals.length} deals`);
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
      description: `**${d.discount}% OFF**`,
      fields: [
        { name: 'Price', value: `£${d.currentPrice}`, inline: true },
        { name: 'Discount', value: `${d.discount}%`, inline: true },
        { name: 'Link', value: `[Buy](${d.link}?tag=${AMAZON_ASSOCIATES_ID})`, inline: false }
      ],
      color: 16711680
    }));

    const response = await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `🎉 Found ${deals.length} deals!`,
        embeds: embeds,
        username: 'Deal Finder Bot'
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
        dateRange: 0,
        deltaPercentRange: [50, 100],
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
        responseKeys: Object.keys(data),
        deals: typeof data.deals,
        dealsIsArray: Array.isArray(data.deals),
        sample: JSON.stringify(data.deals).substring(0, 200)
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
