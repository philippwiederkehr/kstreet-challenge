/* =============================================
   KSTREET CHALLENGE - Main Script
   ============================================= */

// ── Configuration ──────────────────────────────
const CONFIG = {
  SHEET_ID: '195wQUuZLInuKr94VusgKgf1GhfoEKUelvvJOOC9-itE',
  CHALLENGES_SHEET: 'Missions V2.0',
  COMPLETIONS_SHEET: 'Pointtracking',
  START_DATE: '2026-09-19',
  END_DATE: null,
  END_DATE_LABEL: 'FINALE TBC',
  CACHE_NAMESPACE: 'kstreet_v2',
  CACHE_MINUTES: 5,
  TOTAL_RESIDENTS: 42,
  FEED_RECENT_LIMIT: 10
};

// Week missions are available until the next published kickoff.
// End dates are exclusive so adjacent weeks never overlap.
const WEEK_WINDOWS = {
  'week 1': { start: '2026-09-19', end: '2026-09-25' },
  'week 2': { start: '2026-09-25', end: '2026-10-02' },
  'week 3': { start: '2026-10-02', end: '2026-10-09' }
};

const AVATAR_STORAGE_KEY = 'kstreet_v2_avatars';
const AVATAR_DEFAULTS = { character: 'human', mood: 'happy', theme: 'pink' };
const AVATAR_CHARACTERS = {
  human: '🙂',
  cat: '🐱',
  dog: '🐶',
  frog: '🐸',
  alien: '👽'
};
const AVATAR_MOODS = {
  happy: '✨',
  cool: '🕶️',
  silly: '😈',
  sleepy: '💤'
};

// ── State ──────────────────────────────────────
let challengesData = [];
let completionsData = [];
let avatarProfiles = {};
let activeAvatarName = '';
let avatarDraft = { ...AVATAR_DEFAULTS };
let avatarReturnFocus = null;
let hasRenderedData = false;
let refreshInFlight = null;
const challengeState = {
  filter: 'all',
  query: '',
  sort: 'category'
};
const feedState = {
  query: '',
  showAll: false
};

// ── Initialization ─────────────────────────────
document.addEventListener('DOMContentLoaded', startApp);

function startApp() {
  setupChallengeSearch();
  setupChallengeSort();
  setupFeedControls();
  avatarProfiles = loadAvatarProfiles();
  setupAvatarEditor();
  setupKonamiCode();
  updateCountdown();
  window.setInterval(updateCountdown, 60000);
  window.setInterval(() => {
    renderChallenges(
      challengesData,
      getCompletionCounts(completionsData),
      getChallengeCompletions(completionsData)
    );
  }, 60000);
  refreshData();
}

async function refreshData() {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const [challenges, completions] = await Promise.all([
        fetchSheetCSV(CONFIG.CHALLENGES_SHEET),
        fetchSheetCSV(CONFIG.COMPLETIONS_SHEET)
      ]);

      challengesData = normalizeChallenges(challenges);
      completionsData = normalizeCompletions(completions);

      clearError();
      renderFilterTabs(challengesData);
      setupFilterTabs();
      renderAll();
      showApp();
      hasRenderedData = true;
      checkConfetti();
    } catch (err) {
      console.error('Failed to load data:', err);
      if (hasRenderedData) {
        showOfflineBanner();
      } else {
        showError(err.message);
      }
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

// ── Google Sheets CSV Fetch ────────────────────
function getSheetURL(sheetName) {
  return `https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
}

async function fetchSheetCSV(sheetName) {
  const cacheKey = `${CONFIG.CACHE_NAMESPACE}_${sheetName}`;
  const cacheTimeKey = `${CONFIG.CACHE_NAMESPACE}_${sheetName}_time`;

  const cachedData = readCachedSheet(cacheKey, cacheTimeKey);
  const cacheAge = cachedData ? (Date.now() - cachedData.timestamp) / 60000 : Infinity;

  // If cache is fresh, use it
  if (cachedData && cacheAge < CONFIG.CACHE_MINUTES) {
    return cachedData.rows;
  }

  // If offline, serve stale cache or throw
  if (!navigator.onLine) {
    if (cachedData) {
      showOfflineBanner();
      return cachedData.rows;
    }
    throw new Error('No internet connection and no cached data available');
  }

  const url = getSheetURL(sheetName);
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${sheetName} (HTTP ${response.status})`);
    }

    const text = await response.text();
    const rows = text.trim() ? parseCSV(text) : [];
    writeCachedSheet(cacheKey, cacheTimeKey, rows);
    return rows;
  } catch (err) {
    if (cachedData) {
      showOfflineBanner();
      return cachedData.rows;
    }
    throw err;
  }
}

function readCachedSheet(cacheKey, cacheTimeKey) {
  try {
    const cached = localStorage.getItem(cacheKey);
    const cachedTime = Number.parseInt(localStorage.getItem(cacheTimeKey), 10);
    if (!cached || !Number.isFinite(cachedTime)) return null;

    const rows = JSON.parse(cached);
    if (!Array.isArray(rows)) throw new Error('Cached sheet data is not an array');
    return { rows, timestamp: cachedTime };
  } catch {
    try {
      localStorage.removeItem(cacheKey);
      localStorage.removeItem(cacheTimeKey);
    } catch {
      // Storage may be unavailable or read-only; the network path can still work.
    }
    return null;
  }
}

function writeCachedSheet(cacheKey, cacheTimeKey, rows) {
  try {
    localStorage.setItem(cacheKey, JSON.stringify(rows));
    localStorage.setItem(cacheTimeKey, String(Date.now()));
  } catch {
    // A full or blocked cache must not prevent fresh sheet data from rendering.
  }
}

// ── Robust CSV Parser ──────────────────────────
function parseCSV(text) {
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

// ── Normalize V2 Sheets ────────────────────────
// V2 uses explicit columns: Name, Description, Points, When, Type, Category.
// Pointtracking intentionally starts empty, so an empty export is valid.
function normalizeChallenges(raw) {
  if (raw.length === 0) return [];

  const sampleKeys = Object.keys(raw[0]);
  const keyFor = (names) => findColumnKey(sampleKeys, names);
  const columns = {
    name: keyFor(['name', 'challenge name', 'mission', 'mission name']),
    description: keyFor(['description', 'challenge description', 'mission description']),
    points: [
      keyFor(['points adjusted', 'adjusted points']),
      keyFor(['points', 'score'])
    ],
    when: keyFor(['when', 'date', 'week']),
    type: keyFor(['type', 'mission type']),
    category: keyFor(['category', 'challenge category'])
  };

  return raw.map(row => ({
    'Category': normalizeValue(row[columns.category]),
    'Challenge Name': normalizeValue(row[columns.name]),
    'Description': normalizeValue(row[columns.description]),
    'Points': firstNonEmptyValue(row, columns.points),
    'When': normalizeValue(row[columns.when]),
    'Type': normalizeValue(row[columns.type])
  })).filter(challenge => {
    const name = challenge['Challenge Name'];
    return name && !/^ONLY\s+/i.test(name);
  });
}

function normalizeCompletions(raw) {
  if (raw.length === 0) return [];

  const sampleKeys = Object.keys(raw[0]);
  const keyFor = (names) => findColumnKey(sampleKeys, names);
  const columns = {
    date: keyFor(['date', 'completed on', 'completion date']),
    name: keyFor(['name', 'person', 'participant', 'done by', 'completed by']),
    challenge: keyFor(['challenge', 'challenge name', 'mission', 'mission name']),
    points: keyFor(['points', 'score'])
  };

  return raw.map(row => ({
    Date: normalizeValue(row[columns.date]),
    Name: normalizeValue(row[columns.name]),
    Challenge: normalizeValue(row[columns.challenge]),
    Points: normalizeValue(row[columns.points])
  })).filter(row => {
    return row.Name && row.Challenge && Number.isFinite(parsePoints(row.Points));
  });
}

function normalizeHeader(value) {
  return String(value || '').replace(/[\u00a0\s]+/g, ' ').trim().toLowerCase();
}

function findColumnKey(sampleKeys, names) {
  const normalizedNames = names.map(normalizeHeader);
  const exact = sampleKeys.find(key => normalizedNames.includes(normalizeHeader(key)));
  if (exact) return exact;

  // Google Sheets can export a header with a note or line break appended
  // (for example: "Category ONLY REGULAR MISSION"). Match its real column
  // name without depending on that extra cell text.
  return sampleKeys.find(key => {
    const normalizedKey = normalizeHeader(key);
    return normalizedNames.some(name => normalizedKey.startsWith(`${name} `));
  });
}

function normalizeValue(value) {
  return String(value == null ? '' : value).replace(/[\u00a0\s]+/g, ' ').trim();
}

function firstNonEmptyValue(row, keys) {
  return keys.map(key => normalizeValue(key ? row[key] : '')).find(Boolean) || '';
}

function parsePoints(value) {
  const normalized = normalizeValue(value).replace(',', '.');
  const match = normalized.match(/^-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : Number.NaN;
}

// ── Data Processing ────────────────────────────
function buildLeaderboard(completions) {
  const scores = {};

  completions.forEach(row => {
    const name = (row['Name'] || '').trim();
    const points = parsePoints(row['Points']);
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

function getChallengeCompletions(completions) {
  const completionsByChallenge = {};
  const seenNamesByChallenge = {};

  [...completions]
    .sort((a, b) => parseDate(b['Date']) - parseDate(a['Date']))
    .forEach(row => {
      const challenge = (row['Challenge'] || '').trim();
      const name = (row['Name'] || '').trim();
      if (!challenge || !name) return;

      if (!completionsByChallenge[challenge]) {
        completionsByChallenge[challenge] = [];
        seenNamesByChallenge[challenge] = new Set();
      }

      const normalizedName = normalizeHeader(name);
      if (seenNamesByChallenge[challenge].has(normalizedName)) return;
      seenNamesByChallenge[challenge].add(normalizedName);
      completionsByChallenge[challenge].push(name);
    });

  return completionsByChallenge;
}

function isChallengeActive(challenge, now = new Date()) {
  const when = normalizeHeader(challenge['When']);
  if (!when || when === 'always' || when === 'open') return true;

  const window = WEEK_WINDOWS[when];
  if (!window) return !when.startsWith('week');

  const start = new Date(`${window.start}T00:00:00`);
  const end = new Date(`${window.end}T00:00:00`);
  return now >= start && now < end;
}

function isLimitedChallenge(challenge) {
  return Boolean(WEEK_WINDOWS[normalizeHeader(challenge['When'])]);
}

// ── Rendering ──────────────────────────────────
function renderAll() {
  const rankings = buildLeaderboard(completionsData);
  const completionCounts = getCompletionCounts(completionsData);
  const challengeCompletions = getChallengeCompletions(completionsData);

  renderPodium(rankings);
  renderRankings(rankings);
  renderChallenges(challengesData, completionCounts, challengeCompletions);
  renderFeed(completionsData);
  renderStats(rankings, completionCounts);
}

function renderPodium(rankings) {
  const podium = document.getElementById('podium');
  if (rankings.length === 0) {
    podium.innerHTML = `
      <div class="leaderboard-empty" role="status">
        <div class="empty-arcade" aria-hidden="true">
          <span class="empty-star star-a">✦</span>
          <span class="empty-star star-b">✦</span>
          <span class="empty-star star-c">✧</span>
          <div class="empty-trophy">🏆</div>
        </div>
        <strong>THE PODIUM IS WAITING</strong>
        <span>Add a completion to enter.</span>
      </div>`;
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
        <div class="podium-place ${p.cls}" aria-label="${p.idx + 1}. place: ${escapeAttr(r.name)}, ${r.points} points">
          <div class="podium-crown" aria-hidden="true">${p.crown}</div>
          ${avatarNameMarkup(r.name, 'podium-name')}
          <div class="podium-score"><strong>${r.points}</strong><span>PTS</span></div>
          <div class="podium-bar"><span class="podium-rank">${p.idx + 1}</span></div>
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
        ${avatarNameMarkup(r.name, 'rank-name')}
        <span class="rank-score">${r.points}</span>
      </div>`;
  });

  table.innerHTML = html;
}

function renderChallenges(challenges, completionCounts, challengeCompletions = {}) {
  const grid = document.getElementById('challenge-grid');
  const activeChallenges = challenges.filter(challenge => isChallengeActive(challenge));

  if (activeChallenges.length === 0) {
    grid.innerHTML = '<div class="feed-empty">NO MISSIONS LIVE RIGHT NOW</div>';
    const meta = document.getElementById('challenge-meta');
    const emptyState = document.getElementById('challenge-empty-state');
    if (meta) meta.textContent = '0 missions shown';
    if (emptyState) emptyState.classList.add('hidden');
    return;
  }

  const sorted = sortChallenges(activeChallenges, completionCounts);

  let html = '';
  sorted.forEach(ch => {
    const cat = (ch['Category'] || '').trim();
    const type = (ch['Type'] || '').trim();
    const when = (ch['When'] || '').trim();
    const name = (ch['Challenge Name'] || '').trim();
    const desc = (ch['Description'] || '').trim();
    const ptsRaw = (ch['Points'] || '').trim();
    const numericPoints = parsePoints(ptsRaw);
    const isNegative = Number.isFinite(numericPoints) && numericPoints < 0;
    const pointsDisplay = Number.isFinite(numericPoints)
      ? `${numericPoints > 0 ? '+' : ''}${numericPoints}`
      : 'TBD';
    const count = completionCounts[name] || 0;
    const completedNames = [...new Set(challengeCompletions[name] || [])];
    const completedNamesLabel = completedNames.length
      ? `Completed by ${completedNames.join(', ')}`
      : 'Completed names unavailable';
    const playersLabel = completedNames.length > 0 && completedNames.length !== count
      ? `<span class="challenge-completion-players">· ${completedNames.length} players</span>`
      : '';
    const displayTag = cat || type || 'OPEN MISSION';
    const catClass = categoryToClass(cat || type);
    const catTagClass = 'cat-tag-' + catClass.replace('cat-', '');
    const pointsClass = isNegative ? ' negative' : '';
    const limitedLabel = isLimitedChallenge(ch)
      ? '<span class="challenge-limited" title="Available for a limited time">⌛ LIMITED</span>'
      : '';
    const completionMarkup = count > 0
      ? `
        <div class="challenge-completions">
          <div class="challenge-completions-summary">
            <span class="challenge-completion-check" aria-hidden="true">✓</span>
            <strong>${count}x</strong> completed${playersLabel}
          </div>
          <div class="challenge-completers" role="group" aria-label="${escapeAttr(completedNamesLabel)}">
            ${completedNames.map(person => avatarNameMarkup(person, 'challenge-completer')).join('')}
          </div>
        </div>`
      : '<div class="challenge-completions">Not yet completed</div>';

    html += `
      <div class="challenge-card ${catClass}" data-category="${escapeAttr(cat)}" data-type="${escapeAttr(type)}" data-search="${escapeAttr(`${name} ${desc} ${cat} ${type}`.toLowerCase())}">
        <div class="challenge-card-header">
          <span class="challenge-name">${escapeHTML(name)}</span>
          <span class="challenge-points${pointsClass}">${escapeHTML(pointsDisplay)}</span>
        </div>
        <div class="challenge-tags">
          <span class="challenge-category-tag ${catTagClass}">${escapeHTML(displayTag)}</span>
          ${limitedLabel}
        </div>
        <div class="challenge-desc">${escapeHTML(desc)}</div>
        ${completionMarkup}
      </div>`;
  });

  grid.innerHTML = html;
  applyChallengeFilters();
}

function renderFeed(completions) {
  const feedList = document.getElementById('feed-list');
  const feedMeta = document.getElementById('feed-meta');
  const feedToggleBtn = document.getElementById('feed-toggle-btn');
  if (!feedList) return;

  // Sort by date descending
  const sorted = [...completions]
    .sort((a, b) => {
      const da = parseDate(a['Date']);
      const db = parseDate(b['Date']);
      return db - da;
    });

  const query = feedState.query;
  const filtered = query
    ? sorted.filter(row => {
        const name = (row['Name'] || '').trim();
        const challenge = (row['Challenge'] || '').trim();
        const date = (row['Date'] || '').trim();
        const points = String(parseFloat(row['Points']) || 0);
        const searchable = `${name} ${challenge} ${date} ${points}`.toLowerCase();
        return searchable.includes(query);
      })
    : sorted;

  const isSearchMode = query.length > 0;
  const showAllRows = feedState.showAll || isSearchMode;
  const visibleRows = showAllRows ? filtered : filtered.slice(0, CONFIG.FEED_RECENT_LIMIT);

  if (feedToggleBtn) {
    const hasMoreThanRecent = sorted.length > CONFIG.FEED_RECENT_LIMIT;
    if (isSearchMode) {
      feedToggleBtn.textContent = 'SEARCHING FULL HISTORY';
      feedToggleBtn.disabled = true;
      feedToggleBtn.setAttribute('aria-pressed', 'true');
    } else {
      feedToggleBtn.textContent = feedState.showAll ? 'SHOW RECENT ONLY' : 'SHOW FULL HISTORY';
      feedToggleBtn.disabled = !hasMoreThanRecent && !feedState.showAll;
      feedToggleBtn.setAttribute('aria-pressed', String(feedState.showAll));
    }
  }

  if (feedMeta) {
    if (sorted.length === 0) {
      feedMeta.textContent = '';
    } else if (isSearchMode) {
      feedMeta.textContent = `Showing ${visibleRows.length} of ${filtered.length} matches in full history`;
    } else if (feedState.showAll) {
      feedMeta.textContent = `Showing all ${visibleRows.length} completions`;
    } else {
      feedMeta.textContent = `Showing recent ${visibleRows.length} of ${sorted.length} completions`;
    }
  }

  if (visibleRows.length === 0) {
    feedList.innerHTML = isSearchMode
      ? '<div class="feed-empty">NO MATCHES FOUND - TRY A DIFFERENT SEARCH</div>'
      : '<div class="feed-empty">NO COMPLETIONS YET — ADD A ROW IN POINTTRACKING.</div>';
    return;
  }

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  let html = '';
  visibleRows.forEach(row => {
    const name = (row['Name'] || '').trim();
    const challenge = (row['Challenge'] || '').trim();
    const points = parsePoints(row['Points']);
    const date = (row['Date'] || '').trim();
    const rowDate = parseDate(date);
    const timeDiff = now - rowDate.getTime();
    const isNew = timeDiff >= 0 && timeDiff < dayMs;
    const pointSign = points >= 0 ? '+' : '';

    html += `
      <div class="feed-item">
        <span class="feed-icon">\u{1F3AE}</span>
        <div class="feed-content">
          <div class="feed-text">
            ${avatarNameMarkup(name, 'feed-name')}
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
  const end = CONFIG.END_DATE ? new Date(CONFIG.END_DATE + 'T23:59:59') : null;
  const textEl = document.getElementById('countdown-text');
  const xpFill = document.getElementById('xp-bar-fill');
  const xpTrack = xpFill?.parentElement;
  const xpStatus = document.getElementById('xp-status');
  const startLabel = document.getElementById('event-start-label');
  const endLabel = document.getElementById('event-end-label');

  if (!textEl || !xpFill) return;

  const setProgress = (value, status) => {
    xpFill.style.width = `${value}%`;
    xpTrack?.setAttribute('aria-valuenow', String(value));
    if (xpStatus) xpStatus.textContent = status;
  };

  if (startLabel) startLabel.textContent = formatDateLabel(CONFIG.START_DATE);
  if (endLabel) endLabel.textContent = CONFIG.END_DATE ? formatDateLabel(CONFIG.END_DATE) : CONFIG.END_DATE_LABEL;

  if (now < start) {
    const days = Math.ceil((start - now) / (1000 * 60 * 60 * 24));
    textEl.textContent = `KICKOFF IN ${days} DAY${days !== 1 ? 'S' : ''}`;
    textEl.className = 'countdown-text blink';
    setProgress(0, 'LOCKED');
  } else if (end && now > end) {
    textEl.textContent = 'CHALLENGE ENDED';
    textEl.className = 'countdown-text';
    setProgress(100, 'COMPLETE');
  } else if (!end) {
    textEl.textContent = 'V2.0 IS LIVE';
    textEl.className = 'countdown-text';
    setProgress(100, 'LIVE');
  } else {
    const totalDuration = end - start;
    const elapsed = now - start;
    const remaining = end - now;
    const days = Math.ceil(remaining / (1000 * 60 * 60 * 24));
    textEl.textContent = `${days} DAY${days !== 1 ? 'S' : ''} REMAINING`;
    textEl.className = 'countdown-text blink';
    const progress = Math.min(100, Math.max(0, (elapsed / totalDuration) * 100));
    setProgress(progress, 'IN PROGRESS');
  }
}

// ── Player Avatars ──────────────────────────────
function loadAvatarProfiles() {
  try {
    const stored = JSON.parse(localStorage.getItem(AVATAR_STORAGE_KEY) || '{}');
    return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  } catch {
    return {};
  }
}

function normalizeAvatarProfile(profile) {
  const safeProfile = profile && typeof profile === 'object' ? profile : {};
  return {
    character: AVATAR_CHARACTERS[safeProfile.character] ? safeProfile.character : AVATAR_DEFAULTS.character,
    mood: AVATAR_MOODS[safeProfile.mood] ? safeProfile.mood : AVATAR_DEFAULTS.mood,
    theme: ['pink', 'blue', 'mint', 'gold'].includes(safeProfile.theme) ? safeProfile.theme : AVATAR_DEFAULTS.theme
  };
}

function saveAvatarProfiles() {
  try {
    localStorage.setItem(AVATAR_STORAGE_KEY, JSON.stringify(avatarProfiles));
  } catch (err) {
    console.warn('Could not save avatar:', err);
  }
}

function avatarMarkup(profile) {
  const safeProfile = normalizeAvatarProfile(profile);
  return `
    <span class="player-avatar avatar-theme-${safeProfile.theme}" aria-hidden="true">
      <span class="avatar-character">${AVATAR_CHARACTERS[safeProfile.character]}</span>
      <span class="avatar-mood">${AVATAR_MOODS[safeProfile.mood]}</span>
    </span>`;
}

function avatarNameMarkup(name, className) {
  if (!name) return `<span class="${escapeAttr(className)}"></span>`;
  const profile = avatarProfiles[name];
  const avatar = profile ? avatarMarkup(profile) : '';
  return `
    <button type="button" class="${escapeAttr(`${className} avatar-trigger`)}" data-avatar-name="${escapeAttr(name)}" aria-label="Open avatar editor for ${escapeAttr(name)}">
      ${avatar}
      <span class="avatar-name-text">${escapeHTML(name)}</span>
    </button>`;
}

function setupAvatarEditor() {
  const modal = document.getElementById('avatar-modal');
  if (!modal) return;

  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('.avatar-trigger');
    if (trigger) {
      event.preventDefault();
      openAvatarEditor(trigger.dataset.avatarName || '');
      return;
    }

    if (event.target.closest('#avatar-close') || event.target === modal) {
      closeAvatarEditor();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (modal.classList.contains('hidden')) return;

    if (event.key === 'Escape') {
      closeAvatarEditor();
      return;
    }

    if (event.key !== 'Tab') return;

    const focusable = [...modal.querySelectorAll('button:not([disabled])')];
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  modal.querySelectorAll('[data-avatar-key]').forEach(option => {
    option.addEventListener('click', () => {
      avatarDraft[option.dataset.avatarKey] = option.dataset.avatarValue;
      updateAvatarEditor();
    });
  });

  document.getElementById('avatar-save-btn')?.addEventListener('click', () => {
    if (!activeAvatarName) return;
    const name = activeAvatarName;
    avatarProfiles[activeAvatarName] = normalizeAvatarProfile(avatarDraft);
    saveAvatarProfiles();
    closeAvatarEditor();
    renderAll();
    focusAvatarTrigger(name);
  });

  document.getElementById('avatar-clear-btn')?.addEventListener('click', () => {
    if (!activeAvatarName) return;
    const name = activeAvatarName;
    delete avatarProfiles[activeAvatarName];
    saveAvatarProfiles();
    closeAvatarEditor();
    renderAll();
    focusAvatarTrigger(name);
  });
}

function openAvatarEditor(name) {
  const modal = document.getElementById('avatar-modal');
  if (!modal || !name) return;

  avatarReturnFocus = document.activeElement;
  activeAvatarName = name;
  avatarDraft = normalizeAvatarProfile(avatarProfiles[name]);
  const player = document.getElementById('avatar-editor-player');
  if (player) player.textContent = name;
  modal.classList.remove('hidden');
  document.body.classList.add('avatar-editor-open');
  updateAvatarEditor();
  document.getElementById('avatar-close')?.focus();
}

function closeAvatarEditor() {
  const modal = document.getElementById('avatar-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  document.body.classList.remove('avatar-editor-open');
  activeAvatarName = '';
  avatarReturnFocus?.focus?.();
  avatarReturnFocus = null;
}

function focusAvatarTrigger(name) {
  const trigger = [...document.querySelectorAll('.avatar-trigger')]
    .find(button => button.dataset.avatarName === name);
  trigger?.focus();
}

function updateAvatarEditor() {
  const preview = document.getElementById('avatar-preview');
  if (preview) {
    preview.innerHTML = `${avatarMarkup(avatarDraft)}<span class="avatar-preview-hint">LOOKS GOOD?</span>`;
  }

  document.querySelectorAll('[data-avatar-key]').forEach(option => {
    const isSelected = avatarDraft[option.dataset.avatarKey] === option.dataset.avatarValue;
    option.classList.toggle('selected', isSelected);
    option.setAttribute('aria-pressed', String(isSelected));
  });
}

// ── Category Filtering ─────────────────────────
function renderFilterTabs(challenges) {
  const tabs = document.getElementById('filter-tabs');
  if (!tabs) return;

  const categoryOrder = ['Chaos Entertainment', 'K-Street Chemistry', 'House Heroes', 'Unhinged Legends'];
  const categories = [...new Set(challenges.map(challenge => challenge['Category']).filter(Boolean))]
    .sort((a, b) => {
      const ai = categoryOrder.indexOf(a);
      const bi = categoryOrder.indexOf(b);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || a.localeCompare(b);
    });
  const types = [...new Set(challenges.map(challenge => challenge['Type']).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));

  const categoryLabels = {
    'Chaos Entertainment': 'CHAOS',
    'K-Street Chemistry': 'CHEMISTRY',
    'House Heroes': 'HOUSE HEROES',
    'Unhinged Legends': 'UNHINGED'
  };
  const availableFilters = new Set([
    'all',
    ...categories,
    ...types.map(type => `type:${type}`)
  ]);
  if (!availableFilters.has(challengeState.filter)) {
    challengeState.filter = 'all';
  }

  const tab = (value, label) => `
    <button type="button" class="filter-tab${value === challengeState.filter ? ' active' : ''}" data-filter="${escapeAttr(value)}">${escapeHTML(label)}</button>`;

  tabs.innerHTML = [
    tab('all', 'ALL'),
    ...categories.map(category => tab(category, categoryLabels[category] || category.toUpperCase())),
    ...types.map(type => tab(`type:${type}`, type.replace(/\s+Mission$/i, '').toUpperCase()))
  ].join('');
}

function setupFilterTabs() {
  const tabs = document.querySelectorAll('.filter-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      filterByCategory(tab.dataset.filter || tab.dataset.category || 'all');
    });
  });
}

function setupChallengeSearch() {
  const search = document.getElementById('challenge-search');
  if (!search) return;

  search.addEventListener('input', () => {
    challengeState.query = search.value.trim().toLowerCase();
    applyChallengeFilters();
  });
}

function setupChallengeSort() {
  const sort = document.getElementById('challenge-sort');
  if (!sort) return;

  sort.addEventListener('change', () => {
    challengeState.sort = sort.value;
    renderChallenges(
      challengesData,
      getCompletionCounts(completionsData),
      getChallengeCompletions(completionsData)
    );
  });
}

function sortChallenges(challenges, completionCounts) {
  const CATEGORY_ORDER = ['Chaos Entertainment', 'K-Street Chemistry', 'House Heroes', 'Unhinged Legends'];
  const sortMode = challengeState.sort;
  const compareNames = (a, b) => (a['Challenge Name'] || '').localeCompare(b['Challenge Name'] || '');

  return [...challenges].sort((a, b) => {
    if (sortMode === 'name') return compareNames(a, b);

    if (sortMode === 'points-asc' || sortMode === 'points-desc') {
      const aPoints = parsePoints(a['Points']);
      const bPoints = parsePoints(b['Points']);
      const aUnknown = Number.isNaN(aPoints);
      const bUnknown = Number.isNaN(bPoints);
      if (aUnknown !== bUnknown) return aUnknown ? 1 : -1;
      if (!aUnknown && aPoints !== bPoints) {
        return sortMode === 'points-asc' ? aPoints - bPoints : bPoints - aPoints;
      }
      return compareNames(a, b);
    }

    if (sortMode === 'completions-desc') {
      const aCount = completionCounts[a['Challenge Name']] || 0;
      const bCount = completionCounts[b['Challenge Name']] || 0;
      return bCount - aCount || compareNames(a, b);
    }

    const ai = CATEGORY_ORDER.indexOf(a['Category']);
    const bi = CATEGORY_ORDER.indexOf(b['Category']);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
      || (a['Type'] || '').localeCompare(b['Type'] || '')
      || compareNames(a, b);
  });
}

function setupFeedControls() {
  const feedSearch = document.getElementById('feed-search');
  const feedToggleBtn = document.getElementById('feed-toggle-btn');

  if (feedSearch) {
    feedSearch.addEventListener('input', () => {
      feedState.query = feedSearch.value.trim().toLowerCase();
      renderFeed(completionsData);
    });
  }

  if (feedToggleBtn) {
    feedToggleBtn.addEventListener('click', () => {
      feedState.showAll = !feedState.showAll;
      renderFeed(completionsData);
    });
  }
}

function filterByCategory(category) {
  challengeState.filter = category;
  applyChallengeFilters();
}

function applyChallengeFilters() {
  const cards = document.querySelectorAll('.challenge-card');
  const emptyState = document.getElementById('challenge-empty-state');
  let visible = 0;

  cards.forEach(card => {
    const filter = challengeState.filter;
    const matchesFilter = filter === 'all'
      || (filter.startsWith('type:') && card.dataset.type === filter.slice(5))
      || (!filter.startsWith('type:') && card.dataset.category === filter);
    const matchesQuery = !challengeState.query || card.dataset.search.includes(challengeState.query);
    const isVisible = matchesFilter && matchesQuery;
    card.style.display = isVisible ? '' : 'none';
    if (isVisible) visible++;
  });

  const meta = document.getElementById('challenge-meta');
  if (meta) {
    meta.textContent = `${visible} mission${visible === 1 ? '' : 's'} shown`;
  }
  if (emptyState) {
    emptyState.textContent = visible === 0 ? 'NO MATCHES — TRY A DIFFERENT FILTER.' : '';
    emptyState.classList.toggle('hidden', visible !== 0);
  }
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

  let error = document.getElementById('data-error');
  if (!error) {
    error = document.createElement('div');
    error.id = 'data-error';
    error.className = 'error-message';
    app.prepend(error);
  }

  error.innerHTML = `
      <p>FAILED TO LOAD DATA</p>
      <p class="error-hint">${escapeHTML(message)}</p>
      <p class="error-hint" style="margin-top: 20px;">
        Make sure the Google Sheet is published to the web<br>
        and the SHEET_ID in script.js is correct.
      </p>
    `;
}

function clearError() {
  document.getElementById('data-error')?.remove();
}

// ── Confetti ───────────────────────────────────
function checkConfetti() {
  const now = new Date();
  const start = new Date(CONFIG.START_DATE + 'T00:00:00');
  const end = CONFIG.END_DATE ? new Date(CONFIG.END_DATE + 'T00:00:00') : null;
  const dayMs = 24 * 60 * 60 * 1000;

  const isFirstDay = now >= start && now < new Date(start.getTime() + dayMs);
  const isLastDay = end && now >= end && now < new Date(end.getTime() + dayMs);

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
  return escapeHTML(String(str == null ? '' : str))
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function categoryToClass(category) {
  const map = {
    'House Heroes': 'cat-house-heros',
    'K-Street Chemistry': 'cat-kstreet-chemistry',
    'Kstreet Chemistry': 'cat-kstreet-chemistry',
    'Chaos Entertainment': 'cat-chaos-entertainment',
    'Unhinged Legends': 'cat-unhinged-legends',
    'Opening Night Shenanigans': 'cat-opening-night',
    'Party': 'cat-opening-night',
    'Special Mission': 'cat-special',
    'Newbie Mission': 'cat-newbie',
    'Faraway Mission': 'cat-faraway',
    'Regular Mission': 'cat-regular'
  };
  return map[category] || '';
}

// ── Offline Banner ─────────────────────────────
function showOfflineBanner() {
  if (document.getElementById('offline-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'offline-banner';
  banner.textContent = "YOU'RE OFFLINE \u2014 SHOWING CACHED DATA";
  Object.assign(banner.style, {
    position: 'fixed',
    bottom: '0',
    left: '0',
    right: '0',
    zIndex: '9998',
    padding: '10px 16px',
    background: 'linear-gradient(90deg, #ff2d78, #c77dff)',
    color: '#fff',
    fontFamily: "'Press Start 2P', monospace",
    fontSize: '7px',
    textAlign: 'center',
    letterSpacing: '1px',
    lineHeight: '1.8'
  });
  document.body.appendChild(banner);
}

function hideOfflineBanner() {
  const banner = document.getElementById('offline-banner');
  if (banner) banner.remove();
}

window.addEventListener('online', () => {
  hideOfflineBanner();
  // Auto-refresh data when back online
  refreshData();
});

window.addEventListener('offline', () => {
  showOfflineBanner();
});

// ── PWA Install Prompt ────────────────────────
(function initPwaInstall() {
  // Already running as installed PWA — bail out
  if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) return;

  // User previously dismissed — bail out
  if (localStorage.getItem('kstreet_pwa_install_dismissed')) return;

  var prompt = document.getElementById('pwa-install-prompt');
  var btn = document.getElementById('pwa-install-btn');
  var dismiss = document.getElementById('pwa-install-dismiss');
  var iosInstructions = document.getElementById('pwa-ios-instructions');
  if (!prompt || !btn) return;

  var deferredPrompt = null;
  var isIOS = false;

  // Detect iOS Safari (not Chrome/Firefox on iOS — those can't install PWAs)
  var ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua) && /Safari/.test(ua) && !/CriOS|FxiOS/.test(ua)) {
    isIOS = true;
  }

  function show() {
    prompt.classList.remove('hidden');
  }

  function hide() {
    prompt.classList.add('fade-out');
    setTimeout(function() {
      prompt.classList.add('hidden');
      prompt.classList.remove('fade-out');
    }, 300);
  }

  // Chromium browsers: capture the native install event
  window.addEventListener('beforeinstallprompt', function(e) {
    e.preventDefault();
    deferredPrompt = e;
    btn.textContent = 'INSTALL';
    show();
  });

  // iOS Safari: show instructions button
  if (isIOS) {
    btn.textContent = 'HOW TO';
    show();
  }

  // Button click
  btn.addEventListener('click', function() {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function(result) {
        if (result.outcome === 'accepted') hide();
        deferredPrompt = null;
      });
    } else if (isIOS && iosInstructions) {
      iosInstructions.classList.toggle('hidden');
    }
  });

  // Dismiss
  if (dismiss) {
    dismiss.addEventListener('click', function() {
      localStorage.setItem('kstreet_pwa_install_dismissed', '1');
      hide();
    });
  }

  // Hide if the app gets installed while page is open
  window.addEventListener('appinstalled', function() {
    hide();
  });
})();

function parseDate(str) {
  if (!str) return new Date(0);
  const s = str.trim();
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) {
    const [year, month, day] = s.split('-').map(Number);
    return validDate(year, month, day);
  }

  // ISO timestamps are unambiguous and preserve their time zone.
  if (/^\d{4}-\d{1,2}-\d{1,2}T/.test(s)) {
    const timestamp = new Date(s);
    if (!Number.isNaN(timestamp.getTime())) return timestamp;
  }

  // Slash/dot/dash dates are normally day-first in the Swiss sheet. If the
  // middle segment is greater than 12, accept the unambiguous US variant too.
  const parts = s.split(/[./-]/);
  if (parts.length === 3) {
    const [a, b, c] = parts.map(Number);
    if (Number.isInteger(a) && Number.isInteger(b) && Number.isInteger(c)) {
      if (a > 31) return validDate(a, b, c);
      if (c > 31) {
        const day = b > 12 ? b : a;
        const month = b > 12 ? a : b;
        return validDate(c, month, day);
      }
    }
  }
  return new Date(0);
}

function validDate(year, month, day) {
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year
    && date.getMonth() === month - 1
    && date.getDate() === day
    ? date
    : new Date(0);
}

function formatDateLabel(isoDate) {
  const date = new Date(`${isoDate}T00:00:00`);
  if (isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }).toUpperCase();
}
