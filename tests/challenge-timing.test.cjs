const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');

// Load the browser script without starting the app or requesting sheet data.
function loadApp() {
  const elements = new Map();
  const cards = [];
  const document = {
    addEventListener() {},
    querySelectorAll: selector => selector === '.challenge-card' ? cards : [],
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, {
        innerHTML: '', textContent: '', classList: { add() {}, toggle() {} }
      });
      return elements.get(id);
    },
    createElement: () => ({
      set textContent(value) { this.innerHTML = String(value); }
    })
  };
  const app = vm.createContext({
    document,
    navigator: {},
    window: { addEventListener() {}, matchMedia: () => ({ matches: true }) }
  });
  vm.runInContext(readFileSync(`${__dirname}/../script.js`, 'utf8'), app);
  return { app, document, cards };
}

const mission = (when, type = 'Regular Mission') => ({
  'Challenge Name': `${type}: ${when}`,
  When: when,
  Type: type,
  Points: '20'
});

test('weekly missions unlock at the published instant and become overdue at the exclusive end', () => {
  const { app } = loadApp();
  const windows = [
    ['Week 1', '2026-09-19T17:00:00Z', '2026-09-24T22:00:00Z'],
    ['Week 2', '2026-09-24T22:00:00Z', '2026-10-01T22:00:00Z'],
    ['Week 3', '2026-10-01T22:00:00Z', '2026-10-08T22:00:00Z']
  ];
  for (const type of ['Regular Mission', 'Special Mission', 'Newbie Mission', 'Faraway Mission']) {
    for (const [week, start, end] of windows) {
      const challenge = mission(week, type);
      for (const [time, expected] of [
        [Date.parse(start) - 1, 'upcoming'],
        [Date.parse(start), 'active'],
        [Date.parse(end) - 1, 'active'],
        [Date.parse(end), 'overdue']
      ]) {
        assert.equal(app.getChallengeStatus(challenge, new Date(time)), expected, `${type} ${week} ${time}`);
      }
    }
  }
});

test('kickoff uses the configured opening time and stays visible as overdue afterwards', () => {
  const { app } = loadApp();
  for (const when of ['Kick-off', 'Kickoff', 'Kick off']) {
    assert.equal(app.getChallengeStatus(mission(when), new Date('2026-09-19T16:59:59Z')), 'upcoming');
    assert.equal(app.getChallengeStatus(mission(when), new Date('2026-09-19T17:00:00Z')), 'active');
    assert.equal(app.getChallengeStatus(mission(when), new Date('2026-09-19T22:00:00Z')), 'overdue');
  }
});

test('always missions remain active; unpublished or unknown schedules stay excluded', () => {
  const { app } = loadApp();
  assert.equal(app.getChallengeStatus(mission('Always'), new Date('2026-09-01T00:00:00Z')), 'active');
  for (const when of ['', 'Do not include', 'Chalet draft', 'Week 4']) {
    assert.equal(app.isEligibleChallenge(mission(when)), false);
    assert.equal(app.getChallengeStatus(mission(when)), 'hidden');
  }
});

test('Chalet Party missions unlock Friday and become overdue after Sunday in Zurich', () => {
  const { app } = loadApp();
  const challenge = mission('Chalet', 'Party');
  assert.equal(app.isEligibleChallenge(challenge), true);
  for (const [time, expected] of [
    ['2026-10-08T21:59:59.999Z', 'upcoming'],
    ['2026-10-08T22:00:00Z', 'active'],
    ['2026-10-11T21:59:59.999Z', 'active'],
    ['2026-10-11T22:00:00Z', 'overdue']
  ]) {
    assert.equal(app.getChallengeStatus(challenge, new Date(time)), expected);
  }
  for (const when of ['Always', 'Week 1', 'Week 2', 'Week 3', 'Do not include']) {
    assert.equal(app.isEligibleChallenge(mission(when, 'Party')), false);
  }
});

test('the opening filter defaults to Chalet only throughout the Zurich weekend', () => {
  const { app } = loadApp();
  for (const [time, expected] of [
    ['2026-10-08T23:59:59.999+02:00', 'all'],
    ['2026-10-09T00:00:00+02:00', 'when:chalet'],
    ['2026-10-11T23:59:59.999+02:00', 'when:chalet'],
    ['2026-10-12T00:00:00+02:00', 'all'],
    ['2026-10-08T15:00:00-07:00', 'when:chalet'],
    ['2026-10-12T07:00:00+09:00', 'all']
  ]) {
    assert.equal(app.getDefaultChallengeFilter(new Date(time)), expected, time);
  }
});

test('normalization keeps Chalet rows, blank and variable scores, but excludes unpublished Party rows', () => {
  const { app } = loadApp();
  const rows = [
    { Name: 'Topfklopfen', When: ' Chalet ', Type: 'Party', Points: '' },
    { Name: 'Arm wrestling', When: 'Chalet', Type: 'Party', Points: '25*win' },
    { Name: 'Targeted shots', When: 'Chalet', Type: 'Party', Points: '-50' },
    { Name: 'Draft', When: 'Do not include', Type: 'Party', Points: '100' },
    { Name: 'ONLY SECTION', When: 'Chalet', Type: 'Party', Points: '100' },
    { Name: 'Unknown', When: 'Chalet', Type: 'Unknown', Points: '100' }
  ];
  const challenges = app.normalizeChallenges(rows);
  assert.deepEqual(Array.from(challenges, row => [row['Challenge Name'], row['Points'], row.whenKey]), [
    ['Topfklopfen', '', 'chalet'],
    ['Arm wrestling', '25*win', 'chalet'],
    ['Targeted shots', '-50', 'chalet']
  ]);
});

test('Chalet filters by the sheet schedule, combines with search, and preserves manual choices on refresh', () => {
  const { app, document, cards } = loadApp();
  const card = (when, name, type = 'party', category = '') => ({
    dataset: { when, type, category, search: name.toLowerCase() }, style: {}
  });
  cards.push(
    card('chalet', 'Lapdance'),
    card('chalet', 'Arm wrestling'),
    card('kickoff', 'Chalet Weekend Scramble'),
    card('always', 'House Hero', 'regular', 'House Heroes')
  );
  app.filterByCategory('when:chalet');
  assert.deepEqual(cards.map(card => card.style.display), ['', '', 'none', 'none']);
  assert.equal(document.getElementById('challenge-meta').textContent, '2 missions shown');
  vm.runInContext("challengeState.query = 'arm'", app);
  app.applyChallengeFilters();
  assert.deepEqual(cards.map(card => card.style.display), ['none', '', 'none', 'none']);
  vm.runInContext("challengeState.query = ''", app);
  app.filterByCategory('all');
  app.renderFilterTabs();
  assert.equal(vm.runInContext('challengeState.filter', app), 'all');
  assert.deepEqual(cards.map(card => card.style.display), ['', '', '', '']);
  assert.match(document.getElementById('filter-tabs').innerHTML, /data-filter="all" aria-pressed="true"/);
  assert.match(document.getElementById('filter-tabs').innerHTML, /data-filter="when:chalet" aria-pressed="false"/);
  app.filterByCategory('category:House Heroes');
  assert.deepEqual(cards.map(card => card.style.display), ['none', 'none', 'none', '']);
});

test('Chalet cards stay hidden before release and carry their schedule after release', () => {
  const { app, document } = loadApp();
  const challenges = [mission('Chalet', 'Party')];
  app.renderChallenges(challenges, {}, {}, new Date('2026-10-08T21:59:59Z'));
  assert.doesNotMatch(document.getElementById('challenge-grid').innerHTML, /Party: Chalet/);
  app.renderChallenges(challenges, {}, {}, new Date('2026-10-08T22:00:00Z'));
  assert.match(document.getElementById('challenge-grid').innerHTML, /data-when="chalet"/);
  assert.match(document.getElementById('challenge-grid').innerHTML, /CHALET WEEKEND · LIVE/);
  app.renderChallenges(challenges, {}, {}, new Date('2026-10-11T22:00:00Z'));
  assert.match(document.getElementById('challenge-grid').innerHTML, /CHALET WEEKEND · OVERDUE/);
});

test('reused mission names attribute completions to their period and keep raw scores intact', () => {
  const { app, document } = loadApp();
  const challenges = app.normalizeChallenges([
    { Name: 'Lapdance', When: 'Kick-off', Type: 'Party', Points: '25' },
    { Name: 'Lapdance', When: 'Chalet', Type: 'Party', Points: '150' },
    { Name: 'Arm wrestling', When: 'Chalet', Type: 'Party', Points: '25*win' }
  ]);
  const completions = [
    { Date: '19.9', Name: 'Gioia', Challenge: 'Lapdance', Points: '25' },
    { Date: '9.10', Name: 'Lau', Challenge: 'Lapdance', Points: '150' },
    { Date: '10.10.2026', Name: 'Lau', Challenge: 'Arm wrestling', Points: '25' },
    { Date: '', Name: 'Unknown date', Challenge: 'Lapdance', Points: '25' },
    { Date: '12.10', Name: 'Late entry', Challenge: 'Lapdance', Points: '150' }
  ];
  const counts = app.getCompletionCounts(completions, challenges);
  const names = app.getChallengeCompletions(completions, challenges);
  assert.equal(counts['kickoff:Lapdance'], 1);
  assert.equal(counts['chalet:Lapdance'], 1);
  assert.deepEqual(Array.from(names['kickoff:Lapdance']), ['Gioia']);
  assert.deepEqual(Array.from(names['chalet:Lapdance']), ['Lau']);
  assert.equal(app.getCompletionCounts(completions).Lapdance, 4);
  assert.equal(app.buildLeaderboard(completions).find(row => row.name === 'Lau').points, 175);
  app.renderChallenges(challenges, counts, names, new Date('2026-10-09T12:00:00Z'));
  const html = document.getElementById('challenge-grid').innerHTML;
  const chaletCard = html.split('<div class="challenge-card ').find(card => card.includes('data-when="chalet"') && card.includes('Lapdance'));
  assert.match(chaletCard, /Lau/);
  assert.doesNotMatch(chaletCard, /Gioia|Unknown date|Late entry/);
  vm.runInContext("challengeState.sort = 'completions-desc'", app);
  const sorted = app.sortChallenges(challenges, { 'chalet:Arm wrestling': 3, 'kickoff:Lapdance': 1 });
  assert.equal(sorted[0]['Challenge Name'], 'Arm wrestling');
});

test('normalization retains future weeks for automatic unlocking without refetching', () => {
  const { app } = loadApp();
  const rows = ['Week 1', 'Week 2', 'Week 3'].map(When => ({ Name: When, When, Type: 'Special Mission', Points: '0' }));
  const challenges = app.normalizeChallenges(rows);
  assert.equal(challenges.length, 3);
  assert.equal(challenges[2].whenKey, 'week 3');
});

test('rendering excludes future cards and their searchable content, but labels past periods', () => {
  const { app, document } = loadApp();
  const challenges = ['Always', 'Kick-off', 'Week 1', 'Week 2', 'Week 3', 'Do not include'].map(when => mission(when));
  const render = time => {
    app.renderChallenges(challenges, {}, {}, new Date(time));
    return document.getElementById('challenge-grid').innerHTML;
  };
  const week1 = render('2026-09-20T12:00:00Z');
  assert.match(week1, /WEEK 1 · LIVE/);
  assert.doesNotMatch(week1, /Week 2|Week 3|Do not include/);
  const week2 = render('2026-09-26T12:00:00Z');
  assert.match(week2, /WEEK 1 · OVERDUE/);
  assert.match(week2, /KICK-OFF · OVERDUE/);
  assert.match(week2, /WEEK 2 · LIVE/);
  assert.doesNotMatch(week2, /Week 3|Do not include/);
  const week3 = render('2026-10-01T22:00:00Z');
  assert.match(week3, /WEEK 2 · OVERDUE/);
  assert.match(week3, /WEEK 3 · LIVE/);
  const after = render('2026-10-09T12:00:00Z');
  assert.match(after, /WEEK 3 · OVERDUE/);
  assert.doesNotMatch(after, /· LIVE/);
});
