const axios = require('axios');

/**
 * Parses a Japanese relative date string to "days ago" number.
 * Returns null if the date is too old to classify.
 */
function parseDaysAgo(dateStr) {
  if (!dateStr) return null;
  if (dateStr.includes('分前') || dateStr.includes('時間前')) return 0; // hours/mins ago = today
  const dayMatch = dateStr.match(/^(\d+)日前/);
  if (dayMatch) return parseInt(dayMatch[1]);
  return null; // older than tracked
}

/**
 * Fetches the latest sealed-box price + sales counts from SNKRDUNK's internal API.
 * For sealed boxes, the relevant condition is "New" (新品/未使用).
 * @param {number|string} productId
 * @returns {{ price: number|null, sales24h: number, sales7d: number }}
 */
async function scrapeSnkrdunkPrice(productId) {
  if (!productId) {
    console.log('[SNKRDUNK] No productId — skipping.');
    return { price: null, sales24h: 0, sales7d: 0 };
  }

  const commonHeaders = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Referer': `https://snkrdunk.com/apparels/${productId}`,
    'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
  };

  let price = null;
  let sales24h = 0;
  let sales7d = 0;

  try {
    // Fetch recent sales history (50 items) — used for price + sales counts
    const histRes = await axios.get(
      `https://snkrdunk.com/v1/apparels/${productId}/sales-history`,
      { params: { size_id: 0, page: 1, per_page: 50 }, headers: commonHeaders, timeout: 15000 }
    );

    const history = histRes.data?.history || [];

    // For sealed boxes, condition is "New" (未使用/新品). Filter accordingly.
    const newSales = history.filter(item =>
      item.condition === 'New' ||
      item.condition === '新品' ||
      item.condition === '未使用'
    );

    // Fall back to all sales if no "New" sales found (some listings use no condition)
    const relevantSales = newSales.length > 0 ? newSales : history;

    // Most recent last-sale price
    if (relevantSales.length > 0) {
      price = relevantSales[0].price;
    }

    // Count sales by recency
    for (const sale of relevantSales) {
      const daysAgo = parseDaysAgo(sale.date);
      if (daysAgo === null) continue;
      if (daysAgo <= 7) sales7d++;
      if (daysAgo === 0) sales24h++;
    }

    console.log(`[SNKRDUNK] ID ${productId}: ¥${price?.toLocaleString() ?? '-'} | 24h: ${sales24h} sales | 7d: ${sales7d} sales`);

  } catch (err) {
    console.warn(`[SNKRDUNK] sales-history failed for ID ${productId}: ${err.message}`);
  }

  // Fallback price from chart API if sales-history gave no price
  if (price === null) {
    try {
      const chartRes = await axios.get(
        `https://snkrdunk.com/v1/apparels/${productId}/sales-chart/used`,
        // salesChartOptionId: 1 = New/未使用 for boxes (22 was PSA10 for cards)
        { params: { range: 'all', salesChartOptionId: 1 }, headers: commonHeaders, timeout: 15000 }
      );
      const points = chartRes.data?.points || [];
      if (points.length > 0) {
        price = points[points.length - 1][1];
        console.log(`[SNKRDUNK] ID ${productId}: chart fallback price = ¥${price.toLocaleString()}`);
      }
    } catch (err) {
      console.error(`[SNKRDUNK ERROR] ID ${productId}:`, err.message);
    }
  }

  return { price, sales24h, sales7d };
}

/**
 * Fetches full price history (all-time) for a sealed box for initial seeding.
 * Returns array of { date: "YYYY-MM-DD", snkrdunk_jpy: number, ... }
 */
async function fetchSnkrdunkHistory(productId) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Referer': `https://snkrdunk.com/apparels/${productId}`,
  };
  try {
    const res = await axios.get(
      `https://snkrdunk.com/v1/apparels/${productId}/sales-chart/used`,
      // Try salesChartOptionId 1 (New) first for boxes
      { params: { range: 'all', salesChartOptionId: 1 }, headers, timeout: 20000 }
    );
    const points = res.data?.points || [];
    return points.map(([ts, price]) => ({
      date: new Date(ts).toISOString().slice(0, 10),
      snkrdunk_jpy: price,
      snkrdunk_sales_24h: null,
      snkrdunk_sales_7d: null,
    }));
  } catch (err) {
    console.warn(`[SNKRDUNK HISTORY] ID ${productId}: ${err.message}`);
    return [];
  }
}

module.exports = { scrapeSnkrdunkPrice, fetchSnkrdunkHistory };
