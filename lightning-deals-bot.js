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
    
    // Add realistic browser headers to bypass blocking
    const customParser = new Parser({
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/html;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://camelcamelcamel.com/'
      }
    });
    
    const feed = await customParser.parseURL('https://camelcamelcamel.com/popular?deal=1');
    
    console.log(`📰 Got ${feed.items.length} items from RSS feed`);
    
    const deals = [];

    feed.items.forEach(item => {
      try {
        // Extract ASIN from link
        let asin = '';
        if (item.link) {
          const match = item.link.match(/\/product\/([A-Z0-9]+)/);
          if (match) asin = match[1];
        }
        if (!asin) return;

        const title = item.title || 'Product';
        const description = item.description || '';

        // Parse prices from description
        // Format: "Current Price: $X | List Price: $Y | Avg. Price: $Z"
        const currentMatch = description.match(/Current Price:.*?\$?([\d,]+\.?\d*)/);
        const avgMatch = description.match(/Avg\.\s*Price:.*?\$?([\d,]+\.?\d*)/);
        const listMatch = description.match(/List Price:.*?\$?([\d,]+\.?\d*)/);

        if (!currentMatch || !avgMatch) return;

        const currentPrice = parseFloat(currentMatch[1].replace(/,/g, ''));
        const avgPrice = parseFloat(avgMatch[1].replace(/,/g, ''));
        const listPrice = listMatch ? parseFloat(listMatch[1].replace(/,/g, '')) : avgPrice;

        if (currentPrice <= 0 || avgPrice <= 0) return;

        // Calculate discount using Avg Price as baseline
        let discount = 0;
        if (avgPrice > currentPrice) {
          discount = Math.round(((avgPrice - currentPrice) / avgPrice) * 100);
        }

        console.log(`${title.substring(0, 40)} | ${discount}% | $${currentPrice.toFixed(2)}`);

        // Only include if >50% off
        if (discount >= MIN_DISCOUNT) {
          deals.push({
            asin: asin,
            title: title,
            currentPrice: currentPrice.toFixed(2),
            avgPrice: avgPrice.toFixed(2),
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
        { name: 'Avg Price', value: `$${d.avgPrice}`, inline: true },
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
