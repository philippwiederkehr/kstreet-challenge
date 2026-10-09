const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');

test('an upgrade finishes activation before waiting on client navigation', async () => {
  const events = new Map();
  const actions = [];
  const app = vm.createContext({
    self: {
      addEventListener: (name, handler) => events.set(name, handler),
      clients: {
        async claim() { actions.push('claim'); },
        async matchAll() {
          return [{
            url: 'https://kstreet.online/#challenges',
            navigate(url) {
              actions.push(url);
              // Browser navigation fetches cannot finish until activation ends.
              return new Promise(() => {});
            }
          }];
        }
      }
    },
    caches: {
      async keys() { return ['kstreet-v30', 'kstreet-v31', 'unrelated']; },
      async delete(key) { actions.push(`delete:${key}`); }
    }
  });
  vm.runInContext(readFileSync(`${__dirname}/../sw.js`, 'utf8'), app);
  let activation;
  events.get('activate')({ waitUntil: promise => { activation = promise; } });
  let timeout;
  try {
    await Promise.race([
      activation,
      new Promise((resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('Activation waited on navigation')), 1000);
      })
    ]);
  } finally {
    clearTimeout(timeout);
  }
  assert.deepEqual(actions, ['delete:kstreet-v30', 'claim', 'https://kstreet.online/#challenges']);
});
