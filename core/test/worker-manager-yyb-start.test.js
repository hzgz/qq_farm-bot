const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createWorkerManager } = require('../src/runtime/worker-manager');

function harness(t) {
  const workers = {};
  const requests = new Map();
  const envBefore = { url: process.env.YYB_API_URL, key: process.env.YYB_API_KEY };
  process.env.YYB_API_URL = 'http://yyb.test';
  process.env.YYB_API_KEY = 'test-token';
  t.after(() => {
    if (envBefore.url === undefined) delete process.env.YYB_API_URL;
    else process.env.YYB_API_URL = envBefore.url;
    if (envBefore.key === undefined) delete process.env.YYB_API_KEY;
    else process.env.YYB_API_KEY = envBefore.key;
  });
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const { ref } = JSON.parse(init.body);
    return new Promise(resolve => {
      requests.set(ref, () => resolve({ json: async () => ({ code: 0, data: { result: { code: `code-${ref}` } } }) }));
    });
  });
  const created = [];
  class FakeWorker extends EventEmitter {
    constructor(_path, options) {
      super();
      this.id = options.workerData.accountId;
      this.messages = [];
      created.push(this);
    }
    postMessage(message) {
      this.messages.push(message);
      if (message.type === 'stop') this.emit('exit', 0);
    }
    terminate() { this.emit('exit', 0); }
  }
  const manager = createWorkerManager({
    WorkerThread: FakeWorker,
    processRef: { pkg: false },
    workers,
    workerScriptPath: 'fake-worker',
    globalLogs: [],
    log() {}, addAccountLog() {},
    buildConfigSnapshotForAccount: id => ({ accountId: id }),
  });
  return { manager, workers, created, requests };
}

test('concurrent starts of one YYB account create only one worker', async (t) => {
  const h = harness(t);
  const account = { id: '1', name: 'A', loginType: 'yyb', yybOpenid: 'wx-a' };
  const first = h.manager.startWorker(account);
  const second = h.manager.startWorker({ ...account });
  assert.equal(h.requests.size, 1);
  h.requests.get('wx-a')();
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(h.created.length, 1);
  assert.equal(h.created[0].messages[0].config.code, 'code-wx-a');
});

test('two YYB identities start independently and stopping A preserves B', async (t) => {
  const h = harness(t);
  const first = h.manager.startWorker({ id: '1', name: 'A', loginType: 'yyb', yybOpenid: 'wx-a' });
  const second = h.manager.startWorker({ id: '2', name: 'B', loginType: 'yyb', yybOpenid: 'wx-b' });
  h.requests.get('wx-b')();
  await second;
  assert.deepEqual(Object.keys(h.workers), ['2']);
  h.requests.get('wx-a')();
  await first;
  assert.equal(h.created.length, 2);
  h.manager.stopWorker('1');
  assert.deepEqual(Object.keys(h.workers), ['2']);
  assert.equal(h.workers['2'].process.messages[0].config.code, 'code-wx-b');
});

test('stopping an account during code refresh cancels its pending startup', async (t) => {
  const h = harness(t);
  const pending = h.manager.startWorker({ id: '1', name: 'A', loginType: 'yyb', yybOpenid: 'wx-a' });
  h.manager.stopWorker('1');
  h.requests.get('wx-a')();
  assert.equal(await pending, false);
  assert.equal(h.created.length, 0);
  assert.deepEqual(Object.keys(h.workers), []);
});
