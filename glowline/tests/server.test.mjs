import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from '../server.mjs';

test('static server serves app files and blocks everything else', async (t) => {
  const server = createAppServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const index = await fetch(`${base}/`);
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type'), /text\/html/);
  assert.match(await index.text(), /<title>Glowline<\/title>/);

  const js = await fetch(`${base}/src/core.js`);
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /javascript/);

  for (const p of ['/package.json', '/server.mjs', '/tests/core.test.mjs', '/src/../server.mjs', '/%2e%2e/%2e%2e/etc/passwd', '/nope.html']) {
    const res = await fetch(base + p);
    assert.equal(res.status, 404, p);
  }
});
