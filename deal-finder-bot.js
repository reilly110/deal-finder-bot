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
      deltaPercentRange: [1, 100],  // Get ANY deals from Keepa
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

    const deals = products.slice(0, 20).map(p => {
      const currentPrice = (Array.isArray(p.current) && p.current[0]) ? p.current[0] : null;
      const avgPrice = (Array.isArray(p.avg) && p.avg[0]) ? p.avg[0] : null;
      
      let discount = 0;
      if (currentPrice && avgPrice && currentPrice > 0 && avgPrice > 0 && currentPrice < avgPrice) {
        discount = Math.round(((avgPrice - currentPrice) / avgPrice) * 100);
      }
      
      if (products.indexOf(p) < 3) {
        console.log(`DEBUG: ${p.title?.substring(0, 30)} | Avg: ${avgPrice} | Current: ${currentPrice} | Discount: ${discount}%`);
      }
      
      return {
        asin: p.asin,
        title: p.title || 'Product',
        currentPrice: currentPrice ? (currentPrice / 100).toFixed(2) : 'N/A',
        avgPrice: avgPrice ? (avgPrice / 100).toFixed(2) : 'N/A',
        discount: discount,
        available: currentPrice && currentPrice > 0,
        link: `https://amazon.co.uk/dp/${p.asin}`
      };
    })
    .filter(d => d.available && d.discount > 50)  // Back to 50% for real posts
    .slice(0, 5);
    
    console.log(`✅ Found ${deals.length} valid deals >50% off`);
    return deals;

  } catch (error) {
    console.error('Error:', error.message);
    return [];
  }
}

async function getProductCoupons(asin) {
  try {
    const keepaUrl = 'https://api.keepa.com/product';
    const params = new URLSearchParams({
      key: KEEPA_API_KEY,
      domain: 2,  // UK
      asin: asin,
      offers: 20  // Get offer details including coupons
    });

    const response = await fetch(`${keepaUrl}?${params.toString()}`);
    const data = await response.json();

    if (data.products && data.products.length > 0) {
      const product = data.products[0];
      let couponText = '';

      // Check marketplace offers for coupons
      if (product.offers && Array.isArray(product.offers)) {
        product.offers.forEach(offer => {
          if (offer.coupon !== undefined) {
            if (offer.coupon < 0) {
              couponText += `💰 ${Math.abs(offer.coupon)}% coupon\n`;
            } else if (offer.coupon > 0) {
              couponText += `💰 £${(offer.coupon/100).toFixed(2)} coupon\n`;
            }
          }
        });
      }

      return couponText.trim() || null;
    }
  } catch (error) {
    console.error(`Error fetching coupons for ${asin}:`, error.message);
  }
  return null;
}

async function postToDiscord(deals) {
  if (deals.length === 0) {
    console.log('No deals to post');
    return;
  }

  try {
    // Fetch coupons for each deal
    console.log('Fetching coupon details...');
    const dealsWithCoupons = await Promise.all(
      deals.map(async (d) => {
        const couponInfo = await getProductCoupons(d.asin);
        return { ...d, couponInfo };
      })
    );

    const embeds = dealsWithCoupons.map(d => {
      const fields = [
        { name: 'Was', value: `£${d.avgPrice}`, inline: true },
        { name: 'Now', value: `£${d.currentPrice}`, inline: true },
        { name: '📱 Share on X', value: `${d.title.substring(0, 50)}... 🔥 ${d.discount}% OFF! £${d.currentPrice} #AmazonDeals`, inline: false }
      ];

      // Add coupon field if available
      if (d.couponInfo) {
        fields.push({ name: '🎟️ Available Coupons', value: d.couponInfo, inline: false });
      }

      fields.push({ name: 'Link', value: `[Buy Now](${d.link}?tag=${AMAZON_ASSOCIATES_ID})`, inline: false });

      return {
        title: `🔥 ${d.title.substring(0, 80)}`,
        description: `**${d.discount}% OFF** - £${d.currentPrice}`,
        fields: fields,
        color: 16711680
      };
    });

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
        deltaPercentRange: [1, 100],
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
