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

// Get ASINs from /deal endpoint
async function getDealsASINs() {
  try {
    console.log('📋 Getting deal ASINs from Keepa...');
    
    const keepaUrl = 'https://api.keepa.com/deal';
    const queryJSON = {
      page: 0,
      domainId: 1,
      priceTypes: [0],
      dateRange: 1,
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
    console.log(`Tokens left: ${data.tokensLeft}`);

    if (!data.products || data.products.length === 0) {
      console.log('No deals found');
      return [];
    }

    // Extract ASINs from products
    const asins = data.products.map(p => p.asin).slice(0, 5);
    console.log(`Found ${asins.length} deal ASINs: ${asins.join(', ')}`);
    return asins;

  } catch (error) {
    console.error('Error getting ASINs:', error.message);
    return [];
  }
}

// Get detailed product info including prices
async function getProductDetails(asin) {
  try {
    const keepaUrl = 'https://api.keepa.com/product';
    const params = new URLSearchParams({
      key: KEEPA_API_KEY,
      domain: 1,
      asin: asin,
      stats: 1
    });

    const response = await fetch(`${keepaUrl}?${params.toString()}`);
    const data = await response.json();

    if (!data.products || data.products.length === 0) {
      return null;
    }

    const product = data.products[0];
    
    // Extract price data from stats
    let currentPrice = 0;
    let avgPrice = 0;
    
    if (product.stats && Array.isArray(product.stats)) {
      // stats[0] is typically the buy box price stats
      const buyBoxStats = product.stats[0];
      if (Array.isArray(buyBoxStats) && buyBoxStats.length > 0) {
        currentPrice = buyBoxStats[0] || 0;  // First element is current price
        
        // Average is usually found by analyzing the array
        // For now use current as fallback
        if (buyBoxStats.length > 10) {
          avgPrice = buyBoxStats[1] || currentPrice;
        } else {
          avgPrice = currentPrice;
        }
      }
    }

    // Fallback: try direct price fields if available
    if (currentPrice === 0 && product.current) {
      currentPrice = Array.isArray(product.current) ? product.current[0] : product.current;
    }
    if (avgPrice === 0 && product.avg) {
      avgPrice = Array.isArray(product.avg) ? 
        (Array.isArray(product.avg[0]) ? product.avg[0][0] : product.avg[0]) : 
        product.avg;
    }

    // Calculate discount
    let discount = 0;
    if (currentPrice > 0 && avgPrice > currentPrice) {
      discount = Math.round(((avgPrice - currentPrice) / avgPrice) * 100);
    }

    console.log(`${product.title?.substring(0, 40)} | Discount: ${discount}% | Current: $${(currentPrice/100).toFixed(2)} | Avg: $${(avgPrice/100).toFixed(2)}`);

    return {
      asin: asin,
      title: product.title || 'Product',
      currentPrice: (currentPrice / 100).toFixed(2),
      avgPrice: (avgPrice / 100).toFixed(2),
      discount: discount,
      link: `https://amazon.com/dp/${asin}`
    };

  } catch (error) {
    console.error(`Error getting details for ${asin}:`, error.message);
    return null;
  }
}

async function fetchDealsFromKeepa() {
  try {
    console.log('🔍 Fetching deals...');
    
    // Step 1: Get ASINs from /deal endpoint
    const asins = await getDealsASINs();
    
    if (asins.length === 0) {
      return [];
    }

    // Step 2: Get details for each ASIN using /product endpoint
    console.log('📊 Verifying prices with /product endpoint...');
    const deals = [];
    
    for (const asin of asins) {
      const details = await getProductDetails(asin);
      if (details && details.discount > 50) {
        deals.push(details);
      }
    }

    console.log(`✅ Found ${deals.length} verified deals >50% off`);
    return deals;

  } catch (error) {
    console.error('Error fetching deals:', error.message);
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
