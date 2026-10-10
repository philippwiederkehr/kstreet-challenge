const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');

function loadApp() {
  const elements = new Map();
  const document = {
    addEventListener() {},
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, { textContent: '', innerHTML: '' });
      return elements.get(id);
    },
    createElement: () => ({
      set textContent(value) {
        this.innerHTML = String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
      }
    })
  };
  const app = vm.createContext({
    document, navigator: {},
    window: { addEventListener() {}, matchMedia: () => ({ matches: true }) }
  });
  vm.runInContext(readFileSync(`${__dirname}/../script.js`, 'utf8'), app);
  return { app, document };
}

test('full player history preserves repeats and rewards, isolates exact identities, and sorts newest first', () => {
  const { app } = loadApp();
  const rows = app.normalizeCompletions([
    { Name: 'Felix (Avril)', Challenge: 'Repeat', Points: '0', Date: '19.9' },
    { Name: 'Felix (Twitter)', Challenge: 'Other player', Points: '999', Date: '10.10' },
    { Name: 'Felix (Avril)', Challenge: 'Repeat', Points: '-25', Date: '9.10' },
    { Name: 'Felix (Avril)', Challenge: 'Reward', Points: 'Free drink', Date: '' },
    ...Array.from({ length: 12 }, () => ({ Name: 'Felix (Avril)', Challenge: 'New mission', Points: '10', Date: '10.10' }))
  ]);
  const snapshot = JSON.stringify(rows);
  const history = app.getPlayerHistory('Felix (Avril)', rows);
  assert.equal(history.length, 15);
  assert.equal(history[0].Date, '10.10');
  assert.equal(history[12].Points, '-25');
  assert.equal(history[13].Points, '0');
  assert.equal(history[14].Points, 'Free drink');
  assert.equal(history.filter(row => row.Challenge === 'Repeat').length, 2);
  assert.equal(JSON.stringify(rows), snapshot);
  assert.equal(app.getPlayerHistory('Felix', rows).length, 0);
});

test('history points match the leaderboard and credited guest entries retain the performer', () => {
  const { app, document } = loadApp();
  const rows = app.normalizeCompletions([
    { Name: 'Sara', 'Guests and challengers': 'Rey', Challenge: 'Mission', Points: '12,5', Date: '10.10' },
    { Name: 'Sara', 'Guests and challengers': 'Sara', Challenge: 'Penalty', Points: '-5', Date: '9.10' },
    { Name: 'Sara', 'Guests and challengers': 'Sara', Challenge: 'Reward', Points: 'Free drink', Date: '' }
  ]);
  app.rows = rows;
  vm.runInContext('completionsData = rows', app);
  app.renderPlayerHistory('Sara');
  assert.equal(document.getElementById('player-history-count').textContent, 3);
  assert.equal(document.getElementById('player-history-points').textContent, app.buildLeaderboard(rows)[0].points);
  const html = document.getElementById('player-history-list').innerHTML;
  assert.match(html, /Completed by Rey/);
  assert.doesNotMatch(html, /Completed by Sara/);
  assert.match(html, /Free drink/);
  assert.match(html, /Date not recorded/);
  assert.match(html, /player-history-entry-points negative/);
});

test('sheet names, missions, performer names and rewards render as text', () => {
  const { app, document } = loadApp();
  const name = 'Player " & <img src=x onerror=alert(1)>';
  app.rows = app.normalizeCompletions([
    { Name: name, Challenge: '<script>bad()</script>', Points: '<img src=x>', 'Guests and challengers': '<svg onload=bad()>' }
  ]);
  vm.runInContext('completionsData = rows', app);
  app.renderPlayerHistory(name);
  assert.equal(document.getElementById('player-history-name').textContent, name);
  const html = document.getElementById('player-history-list').innerHTML;
  assert.doesNotMatch(html, /<script>|<img|<svg/);
  assert.match(html, /&lt;script&gt;/);
  const button = app.playerNameMarkup(name, 'rank-name');
  assert.match(button, /aria-haspopup="dialog"/);
  assert.match(button, /&quot;/);
  assert.doesNotMatch(button, /<img/);
});
