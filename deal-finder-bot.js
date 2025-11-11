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
    
    // Keepa API endpoint for product search
    const keepaUrl = 'https://api.keepa.com/query';
    
    // Properly formatted query parameters - this is the FIX
    const params = new URLSearchParams({
      key: KEEPA_API_KEY,
      domain: 1, // UK Amazon
      min_price: 1,
      max_price: 500,
      min_rating: 3,
      rating_count_min: 5,
      buy_box_won: 0, // Available but out of stock or low price deals
      category: 1, // Electronics - change as needed
      only_prime: 0, // Include all products
      update_existing_only: 0 // Find new products
    });

    const response = await fetch(`${keepaUrl}?${params.toString()}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      console.error(`Keepa API error: ${response.status} ${response.statusText}`);
      
      // Log response body for debugging
      const errorBody = await response.text();
      console.error('Response:', errorBody);
      
      return [];
    }

    const data = await response.json();
    
    if (!data.products || data.products.length === 0) {
      console.log('ℹ️  No products found in response');
      return [];
    }

    // Filter and process deals (70%+ off)
    const deals = data.products
      .filter(product => {
        const discount = product.discounts?.[0] || 0;
        return discount >= 70; // Only 70%+ off
      })
      .slice(0, 5) // Top 5 deals
      .map(deal => {
        // Extract current price (stored as integer representing price in smallest currency unit)
        const currentPrice = deal.current ? (deal.current[0] / 100).toFixed(2) : 'N/A';
        const originalPrice = deal.historyPrice?.length > 0 
          ? (deal.historyPrice[0] / 100).toFixed(2) 
          : 'N/A';
        
        return {
          asin: deal.asin || 'N/A',
          title: deal.title || 'Product',
          currentPrice: currentPrice,
          originalPrice: originalPrice,
          discount: deal.discounts?.[0] || 0,
          category: deal.categoryName || 'N/A',
          link: `https://amazon.co.uk/dp/${deal.asin}`
        };
      });

    console.log(`✅ Found ${deals.length} deals with 70%+ off`);
    return deals;
    
  } catch (error) {
    console.error('❌ Error fetching from Keepa:', error.message);
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
          name: 'Original Price',
          value: `£${deal.originalPrice}`,
          inline: true
        },
        {
          name: '📊 Discount',
          value: `${deal.discount}%`,
          inline: true
        },
        {
          name: '🔗 Link',
          value: `[View Deal on Amazon](${deal.link}?tag=${AMAZON_ASSOCIATES_ID})`,
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
      content: `🎉 **Found ${deals.length} Hot Deals!** 🎉\n_70%+ off products on Amazon UK_`,
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
