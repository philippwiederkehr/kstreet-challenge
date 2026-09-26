const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');

// Load the browser script without starting the app or requesting sheet data.
function loadApp() {
  const elements = new Map();
  const document = {
    addEventListener() {},
    querySelectorAll: () => [],
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
  return { app, document };
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
  for (const when of ['', 'Do not include', 'Chalet', 'Week 4']) {
    assert.equal(app.isEligibleChallenge(mission(when)), false);
    assert.equal(app.getChallengeStatus(mission(when)), 'hidden');
  }
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
