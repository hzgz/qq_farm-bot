const test = require('node:test');
const assert = require('node:assert/strict');
const { registerAdminAccountRoutes } = require('../src/controllers/admin-account-routes');

function response() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('bulk refresh includes YYB and wxid accounts while skipping non-WeChat accounts', async () => {
  const accounts = [
    { id: '1', name: 'YYB', loginType: 'yyb', yybOpenid: 'openid-a', username: 'admin' },
    { id: '2', name: 'Legacy', loginType: 'manual', wxid: 'wxid-a', username: 'admin' },
    { id: '3', name: 'QQ', platform: 'qq', username: 'admin' },
  ];
  const refreshed = [];
  const routes = new Map();
  registerAdminAccountRoutes({
    app: { get() {}, delete() {}, post(path, handler) { routes.set(path, handler); } },
    provider: {
      refreshAccountCode: async (id) => {
        refreshed.push(id);
        return id === '1'
          ? { ok: true, source: 'yyb' }
          : { ok: true, source: 'wxid' };
      },
    },
    getAccountsForUser: () => accounts,
  });
  const res = response();
  await routes.get('/api/accounts/refresh-wx-codes')({
    currentUser: { username: 'admin', role: 'admin' },
  }, res);
  assert.deepEqual(refreshed, ['1', '2']);
  assert.equal(res.body.ok, true);
  assert.deepEqual(res.body.data, {
    total: 2,
    success: 2,
    failed: 0,
    skipped: 1,
    results: [
      { accountId: '1', name: 'YYB', ok: true, source: 'yyb', error: '' },
      { accountId: '2', name: 'Legacy', ok: true, source: 'wxid', error: '' },
    ],
  });
});

test('one refresh failure does not prevent remaining accounts from refreshing', async () => {
  const accounts = [
    { id: '1', name: 'Expired YYB', loginType: 'yyb', yybOpenid: 'openid-a' },
    { id: '2', name: 'Healthy YYB', loginType: 'yyb', yybOpenid: 'openid-b' },
  ];
  const routes = new Map();
  registerAdminAccountRoutes({
    app: { get() {}, delete() {}, post(path, handler) { routes.set(path, handler); } },
    provider: {
      refreshAccountCode: async id => id === '1'
        ? { ok: false, source: 'yyb', error: '需要重新扫码' }
        : { ok: true, source: 'yyb' },
    },
    getAccountsForUser: () => accounts,
  });
  const res = response();
  await routes.get('/api/accounts/refresh-wx-codes')({
    currentUser: { username: 'admin', role: 'admin' },
  }, res);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.data.success, 1);
  assert.equal(res.body.data.failed, 1);
  assert.equal(res.body.data.results[0].error, '需要重新扫码');
});
