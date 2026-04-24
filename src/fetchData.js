const fs = require('fs');
const path = require('path');
const { format } = require('date-fns');
const box = require('./config.json');
const { scrapeSnkrdunkPrice, fetchSnkrdunkHistory } = require('./scrapers/snkrdunk');

const DATA_FILE  = path.join(__dirname, '../data/prices.json');
const LOGS_DIR   = path.join(__dirname, '../data/logs');

// Price spike alert threshold (15% increase triggers alert)
const ALERT_THRESHOLD = 0.15;

function initializeFiles() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify({}, null, 2));
  }
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
}

function checkPriceAlert(name, newPrice, history) {
  if (!newPrice || history.length < 2) return;
  const prevEntry = [...history].reverse().find(e =>
    e.snkrdunk_jpy && e.date !== format(new Date(), 'yyyy-MM-dd')
  );
  if (!prevEntry?.snkrdunk_jpy) return;
  const change = (newPrice - prevEntry.snkrdunk_jpy) / prevEntry.snkrdunk_jpy;
  if (change >= ALERT_THRESHOLD) {
    console.log(`\n🚨 PRICE ALERT: ${name}`);
    console.log(`   ¥${prevEntry.snkrdunk_jpy.toLocaleString()} → ¥${newPrice.toLocaleString()} (+${(change * 100).toFixed(1)}%)`);
  }
}

/**
 * Writes a daily log file: data/logs/YYYY-MM-DD.json
 * Contains 24h summary — price, sales, and delta vs previous day.
 */
function writeDailyLog(boxMeta, today, todayEntry, previousEntry, availableSizes) {
  const logPath = path.join(LOGS_DIR, `${today}.json`);

  const prevPrice = previousEntry?.snkrdunk_jpy ?? null;
  const currPrice = todayEntry.snkrdunk_jpy;
  const changeJpy = (currPrice != null && prevPrice != null) ? currPrice - prevPrice : null;
  const changePct = (changeJpy != null && prevPrice)
    ? parseFloat(((changeJpy / prevPrice) * 100).toFixed(2))
    : null;

  const log = {
    date: today,
    fetched_at: new Date().toISOString(),
    box: {
      id:      boxMeta.id,
      name_en: boxMeta.name_en,
      name_ja: boxMeta.name_ja || '',
      snkrdunk_product_id: box.snkrdunk_product_id,
      snkrdunk_size_id:    box.snkrdunk_size_id ?? 1,
    },
    price: {
      current_jpy:  currPrice,
      previous_jpy: prevPrice,
      change_jpy:   changeJpy,
      change_pct:   changePct,
      direction:    changeJpy == null ? null : changeJpy > 0 ? 'up' : changeJpy < 0 ? 'down' : 'flat',
    },
    sales: {
      last_24h: todayEntry.snkrdunk_sales_24h ?? null,
      last_7d:  todayEntry.snkrdunk_sales_7d  ?? null,
    },
    debug: {
      available_sizes_in_response: availableSizes,
    },
  };

  fs.writeFileSync(logPath, JSON.stringify(log, null, 2));
  console.log(`\n📋 Daily log written → data/logs/${today}.json`);
  console.log(`   Price: ¥${currPrice?.toLocaleString() ?? 'N/A'} | Change: ${changePct != null ? (changePct >= 0 ? '+' : '') + changePct + '%' : 'N/A'} | 24h sales: ${todayEntry.snkrdunk_sales_24h ?? 'N/A'}`);
}

async function main() {
  console.log(`Starting ポケtracker — tracking: ${box.name_en}`);
  initializeFiles();

  const rawData = fs.readFileSync(DATA_FILE, 'utf-8');
  let pricesDb = {};
  try {
    pricesDb = JSON.parse(rawData);
  } catch (e) {
    console.error('prices.json syntax error, resetting.');
  }

  const today   = format(new Date(), 'yyyy-MM-dd');
  const sizeId  = box.snkrdunk_size_id ?? 1;

  // Initialize record if new
  if (!pricesDb[box.id]) {
    pricesDb[box.id] = {
      metadata: {
        name_en: box.name_en,
        name_ja: box.name_ja || '',
        imageUrl: box.imageUrl || null,
      },
      history: [],
    };
  }

  // Keep metadata in sync with config
  pricesDb[box.id].metadata = {
    name_en: box.name_en,
    name_ja: box.name_ja || '',
    imageUrl: box.imageUrl || pricesDb[box.id].metadata.imageUrl || null,
  };

  // Backfill historical data on first run
  if (pricesDb[box.id].history.length === 0 && box.snkrdunk_product_id) {
    console.log(' -> First run: backfilling historical chart data...');
    const historicalPoints = await fetchSnkrdunkHistory(box.snkrdunk_product_id, sizeId);
    pricesDb[box.id].history = historicalPoints;
    console.log(` -> Loaded ${historicalPoints.length} historical data points`);
    await new Promise(r => setTimeout(r, 1000));
  }

  // Fetch current price
  console.log(`\n--- Fetching SNKRDUNK (product: ${box.snkrdunk_product_id}, size_id: ${sizeId}) ---`);
  const { price, sales24h, sales7d, availableSizes } = await scrapeSnkrdunkPrice(
    box.snkrdunk_product_id,
    sizeId
  );

  // Check for price spike
  checkPriceAlert(box.name_en, price, pricesDb[box.id].history);

  // Find the previous day's entry (for the daily log delta)
  const previousEntry = [...pricesDb[box.id].history]
    .reverse()
    .find(e => e.date !== today && e.snkrdunk_jpy != null);

  // Upsert today's entry
  const history = pricesDb[box.id].history;
  const existingIdx = history.findIndex(e => e.date === today);
  const newEntry = {
    date: today,
    snkrdunk_jpy:       price ?? null,
    snkrdunk_sales_24h: sales24h,
    snkrdunk_sales_7d:  sales7d,
  };

  if (existingIdx > -1) {
    history[existingIdx] = { ...history[existingIdx], ...newEntry };
  } else {
    history.push(newEntry);
  }

  // Write prices.json
  fs.writeFileSync(DATA_FILE, JSON.stringify(pricesDb, null, 2));
  console.log('\nprices.json updated.');

  // Write daily log
  writeDailyLog(
    pricesDb[box.id].metadata,
    today,
    newEntry,
    previousEntry,
    availableSizes
  );
}

main();
