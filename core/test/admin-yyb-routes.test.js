const test = require('node:test');
const assert = require('node:assert/strict');
const { registerAdminYybRoutes } = require('../src/controllers/admin-yyb-routes');

function pollHandler() {
  const routes = new Map();
  registerAdminYybRoutes({
    app: { post(path, _auth, handler) { routes.set(path, handler); } },
    requireAdminToken() {},
  });
  return routes.get('/api/yyb/qr/poll');
}

async function poll() {
  const response = {
    statusCode: 200,
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
  };
  await pollHandler()({ body: { apiBase: 'http://yyb.test', apiKey: 'test-token', sessionId: 'test-session' } }, response);
  return response;
}

test('QR proxy preserves waiting, scanned and unknown states without marking them expired', async (t) => {
  for (const status of ['pending', 'scanned', 'unknown']) {
    t.mock.method(globalThis, 'fetch', async () => ({
      status: 200,
      json: async () => ({ code: 0, data: { status, errcode: status === 'pending' ? 408 : 404 } }),
    }));
    const response = await poll();
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.data.status, status);
    t.mock.restoreAll();
  }
});

test('QR proxy exposes upstream unavailability as a retryable HTTP failure', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    status: 502,
    json: async () => ({ code: 502, msg: 'upstream unavailable', data: null }),
  }));
  const response = await poll();
  assert.equal(response.statusCode, 502);
  assert.equal(response.body.ok, false);
});

test('QR proxy exposes network timeout as retryable instead of a bad request', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('request timed out'); });
  const response = await poll();
  assert.equal(response.statusCode, 502);
  assert.equal(response.body.ok, false);
});
