const fetch = require('node-fetch');
const cron = require('node-cron');
const http = require('http');

// Environment variables
const KEEPA_API_KEY = process.env.KEEPA_API_KEY;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const AMAZON_ASSOCIATES_ID = process.env.AMAZON_ASSOCIATES_ID || 'pricedropuk0c-21';

if (!KEEPA_API_KEY) {
  console.error('ERROR: KEEPA_API_KEY not set in environment variables');
  process.exit(1);
}

if (!DISCORD_WEBHOOK_URL) {
  console.error('ERROR: DISCORD_WEBHOOK_URL not set in environment variables');
  process.exit(1);
}

// Function to fetch deals from Keepa Browsing Deals API
async function fetchDealsFromKeepa() {
  console.log('DEBUG: fetchDealsFromKeepa() called');
  try {
    console.log('🔍 Querying Keepa for deals...');
    
    // Keepa Browsing Deals endpoint
    const keepaUrl = 'https://api.keepa.com/deal';
    
    // Build the queryJSON according to Keepa API documentation
    const queryJSON = {
      page: 0,                           // Start at page 0
      domainId: 2,                       // UK Amazon - REQUIRED
      priceTypes: [0],                   // AMAZON price type - REQUIRED
      dateRange: 0,                      // Last 24 hours
      deltaPercentRange: [50, 100],      // 50-100% price drop - LOWERED TO TEST
      isFilterEnabled: true              // Enable filters
    };

    console.log('📤 Sending POST request to Keepa API...');
    console.log('Query:', JSON.stringify(queryJSON, null, 2));

    // Build URL with key in query string (not in body)
    const urlWithKey = `${keepaUrl}?key=${KEEPA_API_KEY}`;

    const response = await fetch(urlWithKey, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(queryJSON)
    });

    const responseData = await response.json();

    console.log(`API Response Status: ${response.status}`);
    console.log('DEBUG: Response received, parsing...');

    if (!response.ok) {
      console.error(`Keepa API error: ${response.status} ${response.statusText}`);
      console.error('Response:', JSON.stringify(responseData, null, 2));
      return [];
    }

    // Check for API errors in response
    if (responseData.error) {
      console.error('❌ Keepa API Error:', responseData.error.message);
      console.error('Details:', responseData.error.details);
      return [];
    }

    // Debug: log what fields exist in response
    console.log('Response keys:', Object.keys(responseData).slice(0, 10));

    // Check if we got products - they might be directly in the response or in a different field
    let products = responseData.products || responseData.data || Object.values(responseData).find(item => Array.isArray(item) && item.length > 0);
    
    console.log('Products found via:', responseData.products ? 'responseData.products' : responseData.data ? 'responseData.data' : 'Object.values search');
    console.log('Products array length:', products ? products.length : 0);
    
    if (!products || products.length === 0) {
      console.log('ℹ️  No deals found matching criteria');
      console.log('Full response keys:', Object.keys(responseData));
      return [];
    }

    console.log(`✅ Got ${products.length} deals from Keepa`);

    // Process products into formatted deals
    const deals = products
      .map(product => {
        // Extract prices - Keepa stores prices as integers (pence for UK)
        const currentPrice = product.current && product.current.length > 0
          ? (product.current[0] / 100).toFixed(2)
          : 'N/A';
        
        // Get average price (for comparison)
        const avgPrice = product.avg && product.avg.length > 0
          ? (product.avg[0] / 100).toFixed(2)
          : currentPrice;

        return {
          asin: product.asin || 'N/A',
          title: product.title || 'Product',
          currentPrice: currentPrice,
          avgPrice: avgPrice,
          discount: Math.abs(product.delta || 0), // Delta is the percentage discount
          rating: product.rating ? product.rating / 10 : 0, // Keepa stores as 0-50
          reviews: product.reviews || 0,
          link: `https://amazon.co.uk/dp/${product.asin}`
        };
      })
      .sort((a, b) => b.discount - a.discount) // Sort by highest discount first
      .slice(0, 5); // Top 5 deals

    console.log(`✅ Formatted ${deals.length} deals for Discord`);
    return deals;
    
  } catch (error) {
    console.error('❌ Error fetching from Keepa:', error.message);
    if (error.stack) {
      console.error('Stack:', error.stack);
    }
    return [];
  }
}

// Function to post to Discord
async function postToDiscord(deals) {
  console.log('DEBUG: postToDiscord() called with', deals.length, 'deals');
  if (deals.length === 0) {
    console.log('ℹ️  No deals to post to Discord');
    return;
  }

  try {
    console.log(`📤 Posting ${deals.length} deals to Discord...`);

    // Create embed messages for Discord
    const embeds = deals.map(deal => ({
      title: `🔥 ${deal.title.substring(0, 100)}${deal.title.length > 100 ? '...' : ''}`,
      description: `**${deal.discount}% OFF** 💰`,
      fields: [
        {
          name: '💷 Current Price',
          value: `£${deal.currentPrice}`,
          inline: true
        },
        {
          name: 'Average Price',
          value: `£${deal.avgPrice}`,
          inline: true
        },
        {
          name: '📊 Discount',
          value: `${deal.discount}%`,
          inline: true
        },
        {
          name: '⭐ Rating',
          value: `${(deal.rating).toFixed(1)}/5 (${deal.reviews} reviews)`,
          inline: true
        },
        {
          name: '🔗 Buy Now',
          value: `[View on Amazon](${deal.link}?tag=${AMAZON_ASSOCIATES_ID})`,
          inline: false
        }
      ],
      color: 16711680, // Red color for hot deals
      footer: {
        text: 'Deal Finder Bot | Amazon UK | Keepa API'
      },
      timestamp: new Date().toISOString()
    }));

    const payload = {
      content: `🎉 **Found ${deals.length} Hot Amazon Deals!** 🔥\n_70%+ discounts from the last 24 hours_`,
      embeds: embeds,
      username: 'Deal Finder Bot',
      avatar_url: 'https://cdn-icons-png.flaticon.com/512/2721/2721215.png'
    };

    const response = await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Discord webhook error: ${response.status} - ${errorBody}`);
    }

    console.log(`✅ Successfully posted ${deals.length} deals to Discord`);
    return true;
    
  } catch (error) {
    console.error('❌ Error posting to Discord:', error.message);
    return false;
  }
}

// Main function to run the bot
async function runBot() {
  console.log('DEBUG: runBot() started');
  console.log(`\n${'='.repeat(60)}`);
  console.log(`⏰ [${new Date().toLocaleString()}] Running deal search...`);
  console.log(`${'='.repeat(60)}`);
  
  console.log('DEBUG: Calling fetchDealsFromKeepa()');
  const deals = await fetchDealsFromKeepa();
  console.log('DEBUG: Got deals back:', deals.length);
  
  console.log('DEBUG: Calling postToDiscord()');
  await postToDiscord(deals);
  console.log('DEBUG: postToDiscord() complete');
  
  console.log(`${'='.repeat(60)}\n`);
}

// Start the bot
console.log('🤖 Deal Finder Bot Starting...');
console.log('📡 Environment:', {
  keepa_api_key: KEEPA_API_KEY ? '✅ Set' : '❌ Missing',
  discord_webhook: DISCORD_WEBHOOK_URL ? '✅ Set' : '❌ Missing',
  affiliate_id: AMAZON_ASSOCIATES_ID
});

// Run once immediately on startup
runBot();

// Schedule to run every 6 hours (0, 6, 12, 18 UTC)
cron.schedule('0 */6 * * *', () => {
  runBot();
});

console.log('✅ Bot is running. Deals will be fetched every 6 hours.');
console.log('⏸️  Press Ctrl+C to stop.\n');

// Create HTTP server to satisfy Render's port requirement
const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'Deal Finder Bot is running', timestamp: new Date().toISOString() }));
  } else if (req.url === '/trigger') {
    console.log('DEBUG: /trigger endpoint called at', new Date().toLocaleString());
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'Triggering bot manually...', timestamp: new Date().toISOString() }));
    // Run bot immediately
    console.log('DEBUG: About to call runBot()');
    runBot().catch(err => console.error('DEBUG: Error in runBot():', err));
    console.log('DEBUG: runBot() called');
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

server.listen(PORT, () => {
  console.log(`📡 HTTP server listening on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Manual trigger: http://localhost:${PORT}/trigger`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Bot shutting down gracefully...');
  server.close();
  process.exit(0);
});
