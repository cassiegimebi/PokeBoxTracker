const axios = require('axios');
const cheerio = require('cheerio');

async function scrapeCardRushPrice(url) {
  try {
    const { data } = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8'
      }
    });

    const $ = cheerio.load(data);
    
    // Card Rush typically uses .sell-price, .price, or specific ID for pricing.
    let priceText = $('.sell-price').first().text() || 
                    $('.price').first().text() ||
                    $('.product-price').first().text();
                    
    if (!priceText.trim()) {
      // Fallback regex looking for yen values with commas. Card Rush yen format: 12,345円
      const allText = $('body').text();
      const match = allText.match(/([\d,]+)円/);
      if (match) {
        priceText = match[1];
      }
    }

    if (!priceText) {
      console.log(`[CARDRUSH] Could not parse price on ${url}`);
      return null;
    }

    const numericPrice = parseInt(priceText.replace(/[^\d]/g, ''), 10);
    return isNaN(numericPrice) ? null : numericPrice;

  } catch (err) {
    console.error(`[CARDRUSH SCRAPE ERROR] for ${url}:`, err.message);
    return null;
  }
}

module.exports = { scrapeCardRushPrice };
