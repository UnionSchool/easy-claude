import test from 'node:test';
import assert from 'node:assert/strict';
import { alreadyPublished } from '../scripts/check-published.mjs';
test('duplicate publish requires the exact version and Git commit; registry failures do not skip', () => {
  assert.equal(alreadyPublished(404, null, '1.0.2', 'head'), false);
  assert.equal(alreadyPublished(200, {version:'1.0.2',gitHead:'head'}, '1.0.2', 'head'), true);
  for (const metadata of [null, {}, {version:'1.0.2',gitHead:'other'}, {version:'0.0.0-stage',gitHead:'head'}]) {
    assert.throws(() => alreadyPublished(200, metadata, '1.0.2', 'head'));
  }
  assert.throws(() => alreadyPublished(503, null, '1.0.2', 'head'));
});
