const fetch = require('node-fetch');
const cron = require('node-cron');

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

// Function to fetch deals from Keepa API
async function fetchDealsFromKeepa() {
  try {
    console.log('🔍 Querying Keepa for deals...');
    
    // Keepa API endpoint for product query
    const keepaUrl = 'https://api.keepa.com/query';
    
    // Build the queryJSON parameter - this is what Keepa expects
    const queryJSON = {
      domain: 1,           // UK Amazon (1 = Amazon.co.uk)
      sort: "SALES_RANK",  // Sort by sales rank (most popular)
      range: 0,            // Price range filter - any price
      minRating: 3,        // Minimum 3 stars
      minReviews: 5,       // Minimum 5 reviews
      productType: -1,     // All product types
      maxAge: 365,         // Products updated in last 365 days
      maxPrice: 50000,     // Max price in GBP pence (£500)
      minPrice: 100        // Min price in GBP pence (£1)
    };

    // URL encode the queryJSON parameter
    const queryParam = encodeURIComponent(JSON.stringify(queryJSON));
    
    // Build the full URL
    const fullUrl = `${keepaUrl}?key=${KEEPA_API_KEY}&queryJSON=${queryParam}`;

    console.log('📤 Sending request to Keepa API...');
    
    const response = await fetch(fullUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Deal-Finder-Bot/1.0'
      }
    });

    const responseData = await response.json();

    if (!response.ok) {
      console.error(`Keepa API error: ${response.status} ${response.statusText}`);
      console.error('Response:', JSON.stringify(responseData, null, 2));
      return [];
    }

    // Check for API errors in response
    if (responseData.error) {
      console.error('Keepa API Error:', responseData.error.message);
      return [];
    }

    // Check if we got products
    if (!responseData.products || responseData.products.length === 0) {
      console.log('ℹ️  No products found matching criteria');
      return [];
    }

    console.log(`📦 Got ${responseData.products.length} products from Keepa`);

    // Process products into deals
    const deals = responseData.products
      .map(product => {
        // Extract prices - Keepa stores prices as integers (pence)
        const currentPrice = product.current 
          ? (product.current[0] / 100).toFixed(2) 
          : 'N/A';
        
        const originalPrice = product.historyPrice && product.historyPrice.length > 0
          ? (product.historyPrice[0] / 100).toFixed(2)
          : currentPrice;

        // Calculate discount if we have original price
        let discount = 0;
        if (product.historyPrice && product.historyPrice.length > 0 && product.current) {
          discount = Math.round(
            ((product.historyPrice[0] - product.current[0]) / product.historyPrice[0]) * 100
          );
        }

        return {
          asin: product.asin || 'N/A',
          title: product.title || 'Product',
          currentPrice: currentPrice,
          originalPrice: originalPrice,
          discount: discount,
          rating: product.rating || 0,
          reviews: product.reviews || 0,
          category: product.categoryName || 'N/A',
          link: `https://amazon.co.uk/dp/${product.asin}`
        };
      })
      .filter(deal => deal.discount >= 20) // Filter for 20%+ off (adjust as needed)
      .sort((a, b) => b.discount - a.discount) // Sort by highest discount first
      .slice(0, 5); // Top 5 deals

    console.log(`✅ Found ${deals.length} deals with 20%+ off`);
    return deals;
    
  } catch (error) {
    console.error('❌ Error fetching from Keepa:', error.message);
    if (error.response) {
      console.error('Response body:', error.response.body);
    }
    return [];
  }
}

// Function to post to Discord
async function postToDiscord(deals) {
  if (deals.length === 0) {
    console.log('ℹ️  No deals to post');
    return;
  }

  try {
    // Create embed messages for Discord
    const embeds = deals.map(deal => ({
      title: `🔥 ${deal.title.substring(0, 100)}${deal.title.length > 100 ? '...' : ''}`,
      description: `**${deal.discount}% OFF**`,
      fields: [
        {
          name: '💰 Current Price',
          value: `£${deal.currentPrice}`,
          inline: true
        },
        {
          name: 'Was',
          value: `£${deal.originalPrice}`,
          inline: true
        },
        {
          name: '📊 Discount',
          value: `${deal.discount}%`,
          inline: true
        },
        {
          name: '⭐ Rating',
          value: `${deal.rating}/5 (${deal.reviews} reviews)`,
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
        text: 'Deal Finder Bot | Amazon UK'
      },
      timestamp: new Date().toISOString()
    }));

    const payload = {
      content: `🎉 **Found ${deals.length} Hot Deals!** 🔥\n_Top discounted products on Amazon UK_`,
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

    console.log(`✅ Posted ${deals.length} deals to Discord`);
    return true;
    
  } catch (error) {
    console.error('❌ Error posting to Discord:', error.message);
    return false;
  }
}

// Main function to run the bot
async function runBot() {
  console.log(`\n⏰ [${new Date().toLocaleString()}] Running deal search...`);
  const deals = await fetchDealsFromKeepa();
  await postToDiscord(deals);
}

// Listen for the bot to start
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

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Bot shutting down gracefully...');
  process.exit(0);
});
