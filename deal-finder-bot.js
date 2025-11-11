const fetch = require('node-fetch');
const cron = require('node-cron');

// Configuration
const KEEPA_API_KEY = process.env.KEEPA_API_KEY;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const AMAZON_ASSOCIATES_ID = process.env.AMAZON_ASSOCIATES_ID || 'pricedropuk0c-21';

// Keepa API endpoint for deals
const KEEPA_DEALS_URL = 'https://api.keepa.com/deal';

// Function to fetch deals from Keepa
async function fetchDealsFromKeepa() {
  try {
    const params = new URLSearchParams({
      key: KEEPA_API_KEY,
      selection: JSON.stringify({
        page: 0,
        domainId: 3, // UK Amazon
        minDiscount: 70 // 70%+ off
      })
    });

    const url = `${KEEPA_DEALS_URL}?${params.toString()}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Keepa API error: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.deals || data.deals.length === 0) {
      console.log('No deals found');
      return [];
    }

    // Process top 5 deals
    return data.deals.slice(0, 5).map(deal => ({
      title: deal.title || 'Unknown Product',
      asin: deal.asin,
      currentPrice: deal.current ? (deal.current[4] / 100000).toFixed(2) : 'N/A',
      discount: deal.percent || 0,
      category: deal.category || 'N/A'
    }));
  } catch (error) {
    console.error('Error fetching deals:', error);
    return [];
  }
}

// Function to post to Discord
async function postToDiscord(deals) {
  if (deals.length === 0) {
    console.log('No deals to post');
    return;
  }

  try {
    // Create embed messages for Discord
    const embeds = deals.map(deal => ({
      title: `🔍 ${deal.title}`,
      description: `**${deal.discount}% OFF**`,
      fields: [
        {
          name: 'Price',
          value: `£${deal.currentPrice}`,
          inline: true
        },
        {
          name: 'Discount',
          value: `${deal.discount}%`,
          inline: true
        },
        {
          name: 'Link',
          value: `[View Deal](https://amazon.co.uk/dp/${deal.asin}?tag=${AMAZON_ASSOCIATES_ID})`,
          inline: false
        }
      ],
      color: 0xFF6B35, // Orange color
      footer: {
        text: 'Deal Finder Bot'
      }
    }));

    const payload = {
      content: `🎉 Found ${deals.length} deals with 70%+ off!`,
      embeds: embeds
    };

    const response = await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Discord webhook error: ${response.status}`);
    }

    console.log(`Posted ${deals.length} deals to Discord`);
  } catch (error) {
    console.error('Error posting to Discord:', error);
  }
}

// Main function to run the bot
async function runBot() {
  console.log('🤖 Deal Finder Bot started');
  console.log('⏰ Fetching deals now...');
  
  const deals = await fetchDealsFromKeepa();
  await postToDiscord(deals);
}

// Schedule to run every 6 hours (0 0 */6 * * *)
cron.schedule('0 */6 * * *', async () => {
  console.log(`\n📅 Running scheduled deal fetch at ${new Date().toISOString()}`);
  await runBot();
});

// Run once on startup
runBot();

console.log('✅ Bot is running. Deals will be fetched every 6 hours.');
console.log('Press Ctrl+C to stop.');
