const fs = require('fs');
const path = require('path');
const { format } = require('date-fns');
const configBoxes = require('./config.json');
const { scrapeSnkrdunkPrice, fetchSnkrdunkHistory } = require('./scrapers/snkrdunk');
const axios = require('axios');

const DATA_FILE = path.join(__dirname, '../data/prices.json');

// Price spike alert threshold (15% increase triggers alert)
const ALERT_THRESHOLD = 0.15;

function initializeDataFile() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify({}, null, 2));
  }
}

function checkPriceAlert(boxName, newPrice, history) {
  if (!newPrice || history.length < 2) return;
  const prevEntry = [...history].reverse().find(e =>
    e.snkrdunk_jpy &&
    e.date !== format(new Date(), 'yyyy-MM-dd')
  );
  if (!prevEntry) return;
  const prevPrice = prevEntry.snkrdunk_jpy;
  if (!prevPrice) return;
  const change = (newPrice - prevPrice) / prevPrice;
  if (change >= ALERT_THRESHOLD) {
    console.log(`\n🚨 PRICE ALERT: ${boxName}`);
    console.log(`   ¥${prevPrice.toLocaleString()} → ¥${newPrice.toLocaleString()} (+${(change * 100).toFixed(1)}%)`);
    // TODO: replace with Discord/LINE webhook call
  }
}

async function main() {
  console.log('Starting ポケtracker Sealed Box Fetch Pipeline...');
  initializeDataFile();

  const rawData = fs.readFileSync(DATA_FILE, 'utf-8');
  let pricesDb = {};
  try {
    pricesDb = JSON.parse(rawData);
  } catch (e) {
    console.error('prices.json syntax error, resetting.');
  }

  const today = format(new Date(), 'yyyy-MM-dd');

  // Prune removed boxes
  const activeKeys = configBoxes.map(box => box.id);
  for (const key of Object.keys(pricesDb)) {
    if (!activeKeys.includes(key)) {
      console.log(`Pruning removed entry: ${key}`);
      delete pricesDb[key];
    }
  }

  for (const box of configBoxes) {
    const objectKey = box.id;
    console.log(`\n--- Tracking ${box.name_en} (${objectKey}) ---`);

    // Initialize record if new
    if (!pricesDb[objectKey]) {
      pricesDb[objectKey] = {
        metadata: {
          name_en: box.name_en,
          name_ja: box.name_ja || '',
          imageUrl: box.imageUrl || null,
        },
        history: [],
      };
    }

    // Always keep metadata up to date from config
    pricesDb[objectKey].metadata = {
      name_en: box.name_en,
      name_ja: box.name_ja || '',
      imageUrl: box.imageUrl || pricesDb[objectKey].metadata.imageUrl || null,
    };

    // Backfill historical data on first run (no history yet)
    if (pricesDb[objectKey].history.length === 0 && box.snkrdunk_product_id) {
      console.log(` -> First run: backfilling historical chart data...`);
      const historicalPoints = await fetchSnkrdunkHistory(box.snkrdunk_product_id);
      pricesDb[objectKey].history = historicalPoints;
      console.log(` -> Loaded ${historicalPoints.length} historical data points`);
      await new Promise(r => setTimeout(r, 1000));
    }

    let snkrResult = { price: null, sales24h: 0, sales7d: 0 };

    if (box.snkrdunk_product_id) {
      console.log(` -> Fetching SNKRDUNK (product ID: ${box.snkrdunk_product_id})...`);
      snkrResult = await scrapeSnkrdunkPrice(box.snkrdunk_product_id);
    }

    // Check for price spike before updating
    checkPriceAlert(box.name_en, snkrResult.price, pricesDb[objectKey].history);

    const history = pricesDb[objectKey].history;
    const existingIdx = history.findIndex(e => e.date === today);
    const newEntry = {
      date: today,
      snkrdunk_jpy: snkrResult.price || null,
      snkrdunk_sales_24h: snkrResult.sales24h,
      snkrdunk_sales_7d: snkrResult.sales7d,
    };

    if (existingIdx > -1) {
      history[existingIdx] = { ...history[existingIdx], ...newEntry };
    } else {
      history.push(newEntry);
    }

    console.log(
      ` -> SNKR: ¥${snkrResult.price?.toLocaleString() ?? '-'} | 24h: ${snkrResult.sales24h} | 7d: ${snkrResult.sales7d}`
    );

    await new Promise(r => setTimeout(r, 2000));
  }

  fs.writeFileSync(DATA_FILE, JSON.stringify(pricesDb, null, 2));
  console.log('\nData successfully saved to prices.json.');
}

main();
