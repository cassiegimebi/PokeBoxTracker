const axios = require('axios');
const cheerio = require('cheerio');

async function scrapePPTPrice(url) {
  try {
    const { data } = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });

    const $ = cheerio.load(data);
    
    // PokemonPriceTracker structure is mocked here.
    // This looks for common price classes.
    let priceText = $('.price-display').first().text() || 
                    $('.current-price').first().text() ||
                    $('.market-value').first().text();
                    
    if (!priceText.trim()) {
      // Fallback regex looking for dollar values
      const match = $('body').text().match(/\$(\d{1,3}(,\d{3})*(\.\d+)?)/);
      if (match) {
        priceText = match[1];
      }
    }

    if (!priceText) {
      console.log(`[PPT] Could not parse price on ${url}`);
      return null;
    }

    const numericPrice = parseFloat(priceText.replace(/[^\d.]/g, ''));
    return isNaN(numericPrice) ? null : numericPrice;

  } catch (err) {
    console.error(`[PPT SCRAPE ERROR] for ${url}:`, err.message);
    return null;
  }
}

module.exports = { scrapePPTPrice };
