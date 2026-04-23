// app.js — ポケtracker (Sealed Box Mode)
let priceChart;
let globalData = {};
let currentBoxId = null;
let currentRange = 'all';
let currentLang = 'en';
let frontendConfig = [];

// ─── Alert System ────────────────────────────────────────────────────────────
const POLL_INTERVAL_MS = 5 * 60 * 1000;
const ALERT_DEFAULTS = { threshold: 10, muted: false };

function alertSettings() {
    try { return { ...ALERT_DEFAULTS, ...JSON.parse(localStorage.getItem('poke_alert_settings') || '{}') }; }
    catch { return ALERT_DEFAULTS; }
}
function saveAlertSettings(obj) {
    localStorage.setItem('poke_alert_settings', JSON.stringify({ ...alertSettings(), ...obj }));
}

/** Plays a pleasant two-tone chime using the Web Audio API. */
function playAlertChime() {
    if (alertSettings().muted) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const notes = [880, 1109];
    notes.forEach((freq, i) => {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.value = freq;
        const start = ctx.currentTime + i * 0.18;
        const end   = start + 0.45;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.35, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, end);
        osc.start(start);
        osc.stop(end);
    });
}

/** Shows a macOS-style browser notification. */
async function showNotification(title, body) {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') await Notification.requestPermission();
    if (Notification.permission !== 'granted') return;
    const n = new Notification(title, { body, icon: 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>📦</text></svg>' });
    setTimeout(() => n.close(), 8000);
}

/** Snapshot of the latest known price per box (for change detection). */
let lastKnownPrices = {};

function initLastKnownPrices(data) {
    Object.entries(data).forEach(([key, record]) => {
        const history = record.history || [];
        const last = [...history].reverse().find(e => e.snkrdunk_jpy != null);
        if (last) lastKnownPrices[key] = last.snkrdunk_jpy;
    });
}

function checkForAlerts(newData) {
    const { threshold } = alertSettings();
    const triggered = [];

    Object.entries(newData).forEach(([key, record]) => {
        const history = record.history || [];
        const latest = [...history].reverse().find(e => e.snkrdunk_jpy != null);
        if (!latest) return;

        const newPrice  = latest.snkrdunk_jpy;
        const prevPrice = lastKnownPrices[key];

        if (prevPrice && newPrice > prevPrice) {
            const pct = ((newPrice - prevPrice) / prevPrice) * 100;
            if (pct >= threshold) {
                triggered.push({ key, record, newPrice, prevPrice, pct });
            }
        }
        lastKnownPrices[key] = newPrice;
    });

    if (triggered.length > 0) {
        playAlertChime();
        triggered.forEach(({ record, newPrice, prevPrice, pct }) => {
            const name = record.metadata?.name_en || 'Box';
            showNotification(
                `🚨 ポケtracker Alert: ${name}`,
                `Price up +${pct.toFixed(1)}%  ¥${prevPrice.toLocaleString()} → ¥${newPrice.toLocaleString()}`
            );
        });
        flashAlertBanner(triggered);
    }
}

/** Shows a dismissible banner at the top of the main view. */
function flashAlertBanner(items) {
    let banner = document.getElementById('alert-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'alert-banner';
        document.querySelector('.main-view').prepend(banner);
    }
    const lines = items.map(({ record, newPrice, pct }) => {
        const name = record.metadata?.name_en || 'Box';
        return `<strong>${name}</strong>: ¥${newPrice.toLocaleString()} <span style="color:var(--green)">▲+${pct.toFixed(1)}%</span>`;
    }).join('<br>');
    banner.innerHTML = `<span>🚨 Price Alert</span><div style="flex:1">${lines}</div><button onclick="this.parentElement.remove()" style="background:none;border:none;cursor:pointer;font-size:16px;color:inherit">✕</button>`;
}

/** Polls prices.json every POLL_INTERVAL_MS and checks for price alerts. */
async function startPolling() {
    await Notification.requestPermission().catch(() => {});
    setInterval(async () => {
        try {
            const res  = await fetch(`data/prices.json?t=${Date.now()}`);
            const data = await res.json();
            checkForAlerts(data);
            globalData = data;
            if (currentBoxId) refreshChartData();
        } catch (e) { /* network hiccup, skip */ }
    }, POLL_INTERVAL_MS);
}
// ─────────────────────────────────────────────────────────────────────────────

const translations = {
    en: {
        title:        "ポケtracker",
        searchbox:    "Search box name...",
        tracked:      "Tracked Boxes",
        live:         "Market Data Live",
        source:       "Source: SNKRDUNK",
        select:       "Select a Box",
        subtitle:     "Sealed box market history & trends",
        latest_price: "Latest Price (JPY)",
        all_time:     "All Time",
        monthly:      "30 Days",
        weekly:       "7 Days",
        sales_today:  "Sales Today",
        sales_week:   "Sales This Week",
        price_change: "Price Change",
        vs_prev:      "vs. previous entry",
        box_sales:    "Sealed box transactions",
        no_data:      "No data yet",
    },
    ja: {
        title:        "ポケtracker",
        searchbox:    "BOX名で検索...",
        tracked:      "トラッキング中",
        live:         "マーケットデータ稼働中",
        source:       "ソース: SNKRDUNK",
        select:       "BOXを選択",
        subtitle:     "封入BOXの市場履歴とトレンド",
        latest_price: "最新価格 (JPY)",
        all_time:     "全期間",
        monthly:      "30日間",
        weekly:       "7日間",
        sales_today:  "本日の売買",
        sales_week:   "週間売買数",
        price_change: "価格変動",
        vs_prev:      "前回比",
        box_sales:    "未使用BOX 取引",
        no_data:      "データなし",
    }
};

async function init() {
    setupTimeButtons();
    setupSearch();
    setupAlertSettings();
    document.getElementById('lang-toggle').addEventListener('click', toggleLang);

    try {
        const response = await fetch(`data/prices.json?t=${Date.now()}`);
        globalData = await response.json();

        frontendConfig = Object.keys(globalData).map(key => {
            const meta = globalData[key].metadata || {};
            return {
                id:       key,
                name:     meta.name_en || key,
                name_ja:  meta.name_ja || '',
                imageUrl: meta.imageUrl || '',
            };
        });

        initLastKnownPrices(globalData);
        renderSidebar();
        if (frontendConfig.length > 0) selectBox(frontendConfig[0].id);
        setLanguageDOM();
        startPolling();
    } catch (e) {
        console.error("Failed to load price data", e);
        document.getElementById('selected-card-name').innerText = "Data Load Error";
    }
}

function toggleLang() {
    currentLang = currentLang === 'en' ? 'ja' : 'en';
    document.getElementById('lang-toggle').innerText = currentLang === 'en' ? 'JP / EN' : 'EN / JP';
    setLanguageDOM();
    renderSidebar(document.getElementById('card-search').value);
    if (currentBoxId) selectBox(currentBoxId);
}

function setLanguageDOM() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const val = translations[currentLang][key];
        if (!val) return;
        if (el.tagName === 'INPUT' && el.type === 'text') el.placeholder = val;
        else el.innerText = val;
    });
}

function setupSearch() {
    document.getElementById('card-search').addEventListener('input', e => renderSidebar(e.target.value));
}

function renderSidebar(filterText = '') {
    const ul = document.getElementById('card-list');
    ul.innerHTML = '';
    const lower = filterText.toLowerCase();

    frontendConfig
        .filter(b =>
            b.name.toLowerCase().includes(lower) ||
            (b.name_ja && b.name_ja.toLowerCase().includes(lower))
        )
        .forEach(box => {
            const li = document.createElement('li');
            li.className = 'list-item';
            if (box.id === currentBoxId) li.classList.add('active');
            li.dataset.id = box.id;

            const nameText = currentLang === 'ja' && box.name_ja ? box.name_ja : box.name;

            li.innerHTML = `
                <div style="display:flex; align-items:center; gap:10px; min-width:0; overflow:hidden;">
                    ${box.imageUrl
                        ? `<img src="${box.imageUrl}" alt="" style="width:36px;height:36px;object-fit:contain;border-radius:4px;flex-shrink:0;">`
                        : `<span style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;">📦</span>`
                    }
                    <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-size:13px;">${nameText}</span>
                </div>`;

            li.addEventListener('click', () => selectBox(box.id));
            ul.appendChild(li);
        });
}

function selectBox(id) {
    currentBoxId = id;
    document.querySelectorAll('.list-item').forEach(el => el.classList.remove('active'));
    document.querySelector(`.list-item[data-id="${id}"]`)?.classList.add('active');

    const boxInfo = frontendConfig.find(b => b.id === id);
    if (!boxInfo) return;

    const nameText = currentLang === 'ja' && boxInfo.name_ja ? boxInfo.name_ja : boxInfo.name;
    document.getElementById('selected-card-name').innerText = nameText;
    document.getElementById('selected-card-meta').innerText = `ID: ${id} | Source: SNKRDUNK`;

    // Box image
    const imgEl   = document.getElementById('card-image');
    const noImgEl = document.getElementById('card-no-image');
    if (boxInfo.imageUrl) {
        imgEl.src = boxInfo.imageUrl;
        imgEl.classList.remove('hidden');
        noImgEl.classList.add('hidden');
    } else {
        imgEl.classList.add('hidden');
        noImgEl.classList.remove('hidden');
        noImgEl.innerText = '📦';
    }

    document.getElementById('chart-source-label').innerText = 'SNKRDUNK Sealed Box Price History';

    refreshChartData();
}

function setupTimeButtons() {
    document.querySelectorAll('.time-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentRange = e.target.dataset.range;
            refreshChartData();
        });
    });
}

function refreshChartData() {
    if (!currentBoxId) return;

    const record = globalData[currentBoxId] || { history: [] };
    let dataPoints = [...record.history];

    if (currentRange !== 'all') {
        const now  = new Date();
        const days = currentRange === 'weekly' ? 7 : 30;
        const cutoff = new Date(now.setDate(now.getDate() - days));
        dataPoints = dataPoints.filter(dp => new Date(dp.date) >= cutoff);
    }

    // ── Latest price ──
    const latestWithPrice = [...dataPoints].reverse().find(dp => dp.snkrdunk_jpy != null);
    document.getElementById('latest-price-jpy').innerText = latestWithPrice
        ? `¥${latestWithPrice.snkrdunk_jpy.toLocaleString()}`
        : translations[currentLang].no_data;

    // ── Sales stats ──
    const latestEntry = [...(record.history)].reverse().find(dp => dp.snkrdunk_sales_24h != null);
    const s24h = latestEntry?.snkrdunk_sales_24h ?? null;
    const s7d  = latestEntry?.snkrdunk_sales_7d  ?? null;

    document.getElementById('sales-today').innerText = s24h != null ? s24h : '—';
    document.getElementById('sales-week').innerText  = s7d  != null ? s7d  : '—';

    const barPct = s7d != null ? Math.min((s7d / 20) * 100, 100) : 0;
    document.getElementById('sales-bar').style.width = barPct + '%';
    document.getElementById('sales-bar-label').innerText = s7d != null ? `of 20+ threshold` : '—';

    // ── Price change ──
    const pricesOnly = record.history.filter(dp => dp.snkrdunk_jpy != null).map(dp => dp.snkrdunk_jpy);
    const changeEl      = document.getElementById('price-change');
    const changeLabelEl = document.getElementById('price-change-label');
    if (pricesOnly.length >= 2) {
        const prev = pricesOnly[pricesOnly.length - 2];
        const curr = pricesOnly[pricesOnly.length - 1];
        const pct  = ((curr - prev) / prev) * 100;
        const sign = pct >= 0 ? '+' : '';
        changeEl.innerText = `${sign}${pct.toFixed(1)}%`;
        changeLabelEl.className = 'trend-label ' + (pct > 0 ? 'positive' : pct < 0 ? 'negative' : 'neutral');
    } else {
        changeEl.innerText = '—';
        changeLabelEl.className = 'trend-label neutral';
    }

    renderChart(dataPoints);
}

function renderChart(dataPoints) {
    const ctx      = document.getElementById('priceChart').getContext('2d');
    const isDark   = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
    const textColor = isDark ? '#636366' : '#a1a1a6';

    const lineColor = '#007aff';
    const fillColor = 'rgba(0,122,255,0.08)';

    const labels   = dataPoints.map(dp => dp.date);
    const plotData = dataPoints.map(dp => dp.snkrdunk_jpy);

    if (priceChart) priceChart.destroy();

    priceChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'SNKRDUNK (¥)',
                data: plotData,
                borderColor: lineColor,
                backgroundColor: fillColor,
                borderWidth: 1.5,
                pointRadius: labels.length > 100 ? 0 : 3,
                pointHoverRadius: 5,
                pointBackgroundColor: lineColor,
                fill: true,
                tension: 0.35,
                spanGaps: true,
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    mode: 'index', intersect: false,
                    backgroundColor: isDark ? 'rgba(28,28,30,0.95)' : 'rgba(255,255,255,0.95)',
                    titleColor: isDark ? '#f5f5f7' : '#1d1d1f',
                    bodyColor:  isDark ? '#f5f5f7' : '#1d1d1f',
                    borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
                    borderWidth: 1, padding: 10,
                    callbacks: {
                        label: ctx => ` ¥${ctx.raw?.toLocaleString() ?? 'N/A'}`
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: gridColor, drawBorder: false },
                    ticks: { color: textColor, maxTicksLimit: 8, maxRotation: 0, autoSkip: true }
                },
                y: {
                    grid: { color: gridColor, drawBorder: false },
                    ticks: {
                        color: textColor,
                        callback: v => '¥' + (v >= 10000
                            ? (v / 10000).toFixed(v % 10000 === 0 ? 0 : 1) + '万'
                            : v.toLocaleString())
                    }
                }
            },
            interaction: { mode: 'nearest', axis: 'x', intersect: false }
        }
    });
}

/** Renders alert controls in the sidebar footer. */
function setupAlertSettings() {
    const footer = document.querySelector('.sidebar-footer');
    if (!footer) return;

    const s = alertSettings();
    const panel = document.createElement('div');
    panel.id = 'alert-panel';
    panel.innerHTML = `
        <div class="alert-row">
            <span class="alert-label">🔔 Alerts</span>
            <label class="mute-toggle" title="Mute sound">
                <input type="checkbox" id="alert-muted" ${s.muted ? 'checked' : ''}>
                <span>Mute</span>
            </label>
        </div>
        <div class="alert-row">
            <span class="alert-label">Threshold</span>
            <div class="threshold-wrap">
                <input type="number" id="alert-threshold" value="${s.threshold}" min="1" max="100" step="1">
                <span class="alert-label">%</span>
            </div>
        </div>
        <div class="alert-row">
            <button id="test-chime-btn" class="test-btn">▶ Test chime</button>
            <span id="notif-status" class="notif-status"></span>
        </div>`;
    footer.prepend(panel);

    document.getElementById('alert-muted').addEventListener('change', e => {
        saveAlertSettings({ muted: e.target.checked });
    });
    document.getElementById('alert-threshold').addEventListener('change', e => {
        const val = Math.max(1, Math.min(100, Number(e.target.value)));
        e.target.value = val;
        saveAlertSettings({ threshold: val });
    });
    document.getElementById('test-chime-btn').addEventListener('click', async () => {
        playAlertChime();
        await showNotification('📦 ポケtracker Test', 'Alerts are working! You will be notified of price spikes.');
        const status = document.getElementById('notif-status');
        status.innerText = Notification.permission === 'granted' ? '✓ Active' : '✗ Blocked';
        status.style.color = Notification.permission === 'granted' ? 'var(--green)' : 'var(--red)';
    });

    const status = document.getElementById('notif-status');
    if (Notification.permission === 'granted') {
        status.innerText = '✓ Active';
        status.style.color = 'var(--green)';
    } else if (Notification.permission === 'denied') {
        status.innerText = '✗ Blocked';
        status.style.color = 'var(--red)';
    }
}

document.addEventListener('DOMContentLoaded', init);
