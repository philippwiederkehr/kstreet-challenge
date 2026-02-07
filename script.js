/* =============================================
   KSTREET CHALLENGE - Main Script
   ============================================= */

// ── Configuration ──────────────────────────────
const CONFIG = {
  SHEET_ID: 'PASTE_YOUR_SHEET_ID_HERE',
  CHALLENGES_SHEET: 'Challenges',
  COMPLETIONS_SHEET: 'Completions',
  START_DATE: '2026-02-20',
  END_DATE: '2026-03-14',
  CACHE_MINUTES: 5,
  TOTAL_RESIDENTS: 42
};

// ── State ──────────────────────────────────────
let challengesData = [];
let completionsData = [];

// ── Initialization ─────────────────────────────
document.addEventListener('DOMContentLoaded', init);

async function init() {
  setupFilterTabs();
  setupKonamiCode();
  updateCountdown();
  setInterval(updateCountdown, 60000);

  try {
    const [challenges, completions] = await Promise.all([
      fetchSheetCSV(CONFIG.CHALLENGES_SHEET),
      fetchSheetCSV(CONFIG.COMPLETIONS_SHEET)
    ]);

    challengesData = challenges;
    completionsData = completions.filter(r => r['Confirmed'] && r['Confirmed'].toUpperCase() === 'YES');

    renderAll();
    showApp();
    checkConfetti();
  } catch (err) {
    console.error('Failed to load data:', err);
    showError(err.message);
  }
}

// ── Google Sheets CSV Fetch ────────────────────
function getSheetURL(sheetName) {
  return `https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
}

async function fetchSheetCSV(sheetName) {
  const cacheKey = `kstreet_${sheetName}`;
  const cacheTimeKey = `kstreet_${sheetName}_time`;

  // Check localStorage cache
  const cached = localStorage.getItem(cacheKey);
  const cachedTime = localStorage.getItem(cacheTimeKey);
  if (cached && cachedTime) {
    const age = (Date.now() - parseInt(cachedTime, 10)) / 60000;
    if (age < CONFIG.CACHE_MINUTES) {
      return JSON.parse(cached);
    }
  }

  const url = getSheetURL(sheetName);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${sheetName} (HTTP ${response.status})`);
  }

  const text = await response.text();
  const rows = parseCSV(text);

  // Cache
  localStorage.setItem(cacheKey, JSON.stringify(rows));
  localStorage.setItem(cacheTimeKey, String(Date.now()));

  return rows;
}

// ── Robust CSV Parser ──────────────────────────
function parseCSV(text) {
  const lines = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === '\n' || ch === '\r') {
        if (current.length > 0 || lines.length > 0) {
          lines.push(current);
          current = '';
        }
        if (ch === '\r' && i + 1 < text.length && text[i + 1] === '\n') {
          i++;
        }
      } else {
        current += ch;
      }
    }
  }
  if (current.length > 0) {
    lines.push(current);
  }

  if (lines.length === 0) return [];

  // Parse each line into fields
  const parseLine = (line) => {
    const fields = [];
    let field = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQ = false;
          }
        } else {
          field += ch;
        }
      } else {
        if (ch === '"') {
          inQ = true;
        } else if (ch === ',') {
          fields.push(field.trim());
          field = '';
        } else {
          field += ch;
        }
      }
    }
    fields.push(field.trim());
    return fields;
  };

  // First line reassembled from raw text may have issues;
  // Re-parse from the raw text properly
  const rawLines = splitCSVLines(text);
  if (rawLines.length === 0) return [];

  const headers = parseLine(rawLines[0]);
  const rows = [];

  for (let i = 1; i < rawLines.length; i++) {
    const fields = parseLine(rawLines[i]);
    if (fields.length === 0 || (fields.length === 1 && fields[0] === '')) continue;
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = idx < fields.length ? fields[idx] : '';
    });
    rows.push(obj);
  }

  return rows;
}

function splitCSVLines(text) {
  const lines = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (current.trim().length > 0) {
        lines.push(current);
      }
      current = '';
      if (ch === '\r' && i + 1 < text.length && text[i + 1] === '\n') {
        i++;
      }
    } else {
      current += ch;
    }
  }
  if (current.trim().length > 0) {
    lines.push(current);
  }

  return lines;
}

// ── Data Processing ────────────────────────────
function buildLeaderboard(completions) {
  const scores = {};

  completions.forEach(row => {
    const name = (row['Name'] || '').trim();
    const points = parseFloat(row['Points']) || 0;
    if (!name) return;
    scores[name] = (scores[name] || 0) + points;
  });

  const sorted = Object.entries(scores)
    .map(([name, points]) => ({ name, points }))
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));

  // Assign ranks (handle ties)
  let rank = 1;
  sorted.forEach((entry, i) => {
    if (i > 0 && entry.points === sorted[i - 1].points) {
      entry.rank = sorted[i - 1].rank;
    } else {
      entry.rank = rank;
    }
    rank++;
  });

  return sorted;
}

function getCompletionCounts(completions) {
  const counts = {};
  completions.forEach(row => {
    const challenge = (row['Challenge'] || '').trim();
    if (challenge) {
      counts[challenge] = (counts[challenge] || 0) + 1;
    }
  });
  return counts;
}

// ── Rendering ──────────────────────────────────
function renderAll() {
  const rankings = buildLeaderboard(completionsData);
  const completionCounts = getCompletionCounts(completionsData);

  renderPodium(rankings);
  renderRankings(rankings);
  renderChallenges(challengesData, completionCounts);
  renderFeed(completionsData);
  renderStats(rankings, completionCounts);
}

function renderPodium(rankings) {
  const podium = document.getElementById('podium');
  if (rankings.length === 0) {
    podium.innerHTML = '<div class="feed-empty">NO SCORES YET - BE THE FIRST!</div>';
    return;
  }

  const places = [
    { idx: 1, cls: 'silver', crown: '\u{1F948}' },
    { idx: 0, cls: 'gold',   crown: '\u{1F451}' },
    { idx: 2, cls: 'bronze', crown: '\u{1F949}' }
  ];

  let html = '';
  places.forEach(p => {
    if (rankings[p.idx]) {
      const r = rankings[p.idx];
      html += `
        <div class="podium-place ${p.cls}">
          <div class="podium-crown">${p.crown}</div>
          <div class="podium-name">${escapeHTML(r.name)}</div>
          <div class="podium-score">${r.points} PTS</div>
          <div class="podium-bar"></div>
        </div>`;
    }
  });

  podium.innerHTML = html;
}

function renderRankings(rankings) {
  const table = document.getElementById('rankings-table');

  // Show ranks 4+ (top 3 are on podium)
  const rest = rankings.slice(3);

  if (rest.length === 0 && rankings.length <= 3) {
    table.innerHTML = '';
    return;
  }

  let html = '';
  rest.forEach(r => {
    const zeroClass = r.points === 0 ? ' zero-points' : '';
    html += `
      <div class="rank-row${zeroClass}">
        <span class="rank-number">${r.rank}.</span>
        <span class="rank-name">${escapeHTML(r.name)}</span>
        <span class="rank-score">${r.points}</span>
      </div>`;
  });

  table.innerHTML = html;
}

function renderChallenges(challenges, completionCounts) {
  const grid = document.getElementById('challenge-grid');

  if (challenges.length === 0) {
    grid.innerHTML = '<div class="feed-empty">NO CHALLENGES LOADED</div>';
    return;
  }

  let html = '';
  challenges.forEach(ch => {
    const cat = (ch['Category'] || '').trim();
    const name = (ch['Challenge Name'] || '').trim();
    const desc = (ch['Description'] || '').trim();
    const points = parseFloat(ch['Points']) || 0;
    const count = completionCounts[name] || 0;
    const catClass = categoryToClass(cat);
    const catTagClass = 'cat-tag-' + catClass.replace('cat-', '');
    const pointsClass = points < 0 ? ' negative' : '';

    html += `
      <div class="challenge-card ${catClass}" data-category="${escapeAttr(cat)}">
        <div class="challenge-card-header">
          <span class="challenge-name">${escapeHTML(name)}</span>
          <span class="challenge-points${pointsClass}">${points > 0 ? '+' : ''}${points}</span>
        </div>
        <span class="challenge-category-tag ${catTagClass}">${escapeHTML(cat)}</span>
        <div class="challenge-desc">${escapeHTML(desc)}</div>
        <div class="challenge-completions">${count > 0 ? `<strong>${count}x</strong> completed` : 'Not yet completed'}</div>
      </div>`;
  });

  grid.innerHTML = html;
}

function renderFeed(completions) {
  const feedList = document.getElementById('feed-list');

  // Sort by date descending, take latest 10
  const sorted = [...completions]
    .sort((a, b) => {
      const da = parseDate(a['Date']);
      const db = parseDate(b['Date']);
      return db - da;
    })
    .slice(0, 10);

  if (sorted.length === 0) {
    feedList.innerHTML = '<div class="feed-empty">NO COMPLETIONS YET - GET STARTED!</div>';
    return;
  }

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  let html = '';
  sorted.forEach(row => {
    const name = (row['Name'] || '').trim();
    const challenge = (row['Challenge'] || '').trim();
    const points = parseFloat(row['Points']) || 0;
    const date = (row['Date'] || '').trim();
    const rowDate = parseDate(date);
    const isNew = (now - rowDate.getTime()) < dayMs;
    const pointSign = points >= 0 ? '+' : '';

    html += `
      <div class="feed-item">
        <span class="feed-icon">\u{1F3AE}</span>
        <div class="feed-content">
          <div class="feed-text">
            <span class="feed-name">${escapeHTML(name)}</span>
            completed
            <span class="feed-challenge">${escapeHTML(challenge)}</span>
            <span class="feed-points">(${pointSign}${points} pts)</span>
          </div>
          <div class="feed-date">${escapeHTML(date)}</div>
        </div>
        ${isNew ? '<span class="feed-new-badge">NEW!</span>' : ''}
      </div>`;
  });

  feedList.innerHTML = html;
}

function renderStats(rankings, completionCounts) {
  // Participants with > 0 points
  const activeParticipants = rankings.filter(r => r.points > 0).length;
  document.getElementById('stat-participants').textContent = activeParticipants;

  // Total completions
  const totalCompletions = completionsData.length;
  document.getElementById('stat-completions').textContent = totalCompletions;

  // Most popular challenge
  let mostPopular = '-';
  let maxCount = 0;
  for (const [name, count] of Object.entries(completionCounts)) {
    if (count > maxCount) {
      maxCount = count;
      mostPopular = name;
    }
  }
  const popularEl = document.getElementById('stat-popular');
  popularEl.textContent = mostPopular;
  popularEl.style.fontSize = mostPopular.length > 12 ? '8px' : '12px';

  // Participation rate
  const rate = Math.round((activeParticipants / CONFIG.TOTAL_RESIDENTS) * 100);
  document.getElementById('stat-rate').textContent = rate + '%';
}

// ── Countdown Timer ────────────────────────────
function updateCountdown() {
  const now = new Date();
  const start = new Date(CONFIG.START_DATE + 'T00:00:00');
  const end = new Date(CONFIG.END_DATE + 'T23:59:59');
  const textEl = document.getElementById('countdown-text');
  const xpFill = document.getElementById('xp-bar-fill');

  if (!textEl || !xpFill) return;

  if (now < start) {
    const days = Math.ceil((start - now) / (1000 * 60 * 60 * 24));
    textEl.textContent = `STARTS IN ${days} DAY${days !== 1 ? 'S' : ''}`;
    textEl.className = 'countdown-text blink';
    xpFill.style.width = '0%';
  } else if (now > end) {
    textEl.textContent = 'CHALLENGE ENDED';
    textEl.className = 'countdown-text';
    xpFill.style.width = '100%';
  } else {
    const totalDuration = end - start;
    const elapsed = now - start;
    const remaining = end - now;
    const days = Math.ceil(remaining / (1000 * 60 * 60 * 24));
    textEl.textContent = `${days} DAY${days !== 1 ? 'S' : ''} REMAINING`;
    textEl.className = 'countdown-text blink';
    const progress = Math.min(100, Math.max(0, (elapsed / totalDuration) * 100));
    xpFill.style.width = progress + '%';
  }
}

// ── Category Filtering ─────────────────────────
function setupFilterTabs() {
  const tabs = document.querySelectorAll('.filter-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      filterByCategory(tab.dataset.category);
    });
  });
}

function filterByCategory(category) {
  const cards = document.querySelectorAll('.challenge-card');
  cards.forEach(card => {
    if (category === 'all' || card.dataset.category === category) {
      card.style.display = '';
    } else {
      card.style.display = 'none';
    }
  });
}

// ── Show/Hide App ──────────────────────────────
function showApp() {
  const loading = document.getElementById('loading-screen');
  const app = document.getElementById('app');

  loading.classList.add('fade-out');
  setTimeout(() => {
    loading.style.display = 'none';
    app.classList.remove('hidden');
  }, 400);
}

function showError(message) {
  const loading = document.getElementById('loading-screen');
  const app = document.getElementById('app');

  loading.style.display = 'none';
  app.classList.remove('hidden');

  app.innerHTML = `
    <header class="hero">
      <div class="scanline-overlay"></div>
      <div class="hero-content">
        <h1 class="hero-title">KSTREET<br>CHALLENGE</h1>
      </div>
    </header>
    <div class="error-message">
      <p>FAILED TO LOAD DATA</p>
      <p class="error-hint">${escapeHTML(message)}</p>
      <p class="error-hint" style="margin-top: 20px;">
        Make sure the Google Sheet is published to the web<br>
        and the SHEET_ID in script.js is correct.
      </p>
    </div>`;
}

// ── Confetti ───────────────────────────────────
function checkConfetti() {
  const now = new Date();
  const start = new Date(CONFIG.START_DATE + 'T00:00:00');
  const end = new Date(CONFIG.END_DATE + 'T00:00:00');
  const dayMs = 24 * 60 * 60 * 1000;

  const isFirstDay = now >= start && now < new Date(start.getTime() + dayMs);
  const isLastDay = now >= end && now < new Date(end.getTime() + dayMs);

  if (isFirstDay || isLastDay) {
    launchConfetti();
  }
}

function launchConfetti() {
  const canvas = document.getElementById('confetti-canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const pieces = [];
  const colors = ['#00ff41', '#ff6600', '#ffd700', '#ff6b9d', '#c44dff', '#4ecdc4', '#ffe66d', '#ff4444'];

  for (let i = 0; i < 120; i++) {
    pieces.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height - canvas.height,
      w: 4 + Math.random() * 6,
      h: 4 + Math.random() * 6,
      color: colors[Math.floor(Math.random() * colors.length)],
      vx: (Math.random() - 0.5) * 3,
      vy: 1 + Math.random() * 3,
      rot: Math.random() * 360,
      rotSpeed: (Math.random() - 0.5) * 10
    });
  }

  let frame = 0;
  const maxFrames = 300;

  function animate() {
    if (frame > maxFrames) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    pieces.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.rotSpeed;
      p.vy += 0.03;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rot * Math.PI) / 180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });

    frame++;
    requestAnimationFrame(animate);
  }

  animate();

  // Resize handler
  window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }, { once: true });
}

// ── Konami Code Easter Egg ─────────────────────
function setupKonamiCode() {
  const code = [
    'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
    'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight',
    'KeyB', 'KeyA'
  ];
  let index = 0;

  document.addEventListener('keydown', (e) => {
    if (e.code === code[index]) {
      index++;
      if (index === code.length) {
        index = 0;
        triggerEasterEgg();
      }
    } else {
      index = 0;
    }
  });
}

function triggerEasterEgg() {
  launchConfetti();

  // Flash the page
  document.body.style.transition = 'background 0.1s';
  document.body.style.background = '#00ff41';
  setTimeout(() => {
    document.body.style.background = '';
    setTimeout(() => {
      document.body.style.transition = '';
    }, 200);
  }, 150);
}

// ── Helpers ────────────────────────────────────
function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function categoryToClass(category) {
  const map = {
    'House Heros': 'cat-house-heros',
    'Kstreet Chemistry': 'cat-kstreet-chemistry',
    'Chaos Entertainment': 'cat-chaos-entertainment',
    'Unhinged Legends': 'cat-unhinged-legends',
    'Opening Night': 'cat-opening-night'
  };
  return map[category] || '';
}

function parseDate(str) {
  if (!str) return new Date(0);
  // Handle YYYY-MM-DD or DD/MM/YYYY or other formats
  const d = new Date(str);
  if (!isNaN(d.getTime())) return d;
  // Try DD.MM.YYYY (common Swiss format)
  const parts = str.split(/[./-]/);
  if (parts.length === 3) {
    const [a, b, c] = parts.map(Number);
    if (a > 31) return new Date(a, b - 1, c); // YYYY-MM-DD
    if (c > 31) return new Date(c, b - 1, a); // DD.MM.YYYY
  }
  return new Date(0);
}
