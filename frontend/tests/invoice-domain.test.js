const assert = require('node:assert/strict');
const test = require('node:test');

require('../app/js/invoice-domain.js');

test('dedupeById keeps the first occurrence of each invoice', () => {
  const records = globalThis.MRAInvoiceDomain.dedupeById([
    { id: 'a', total: 10 },
    { id: 'a', total: 20 },
    { id: 'b', total: 30 },
    { id: null, total: 40 }
  ]);

  assert.deepEqual(records, [
    { id: 'a', total: 10 },
    { id: 'b', total: 30 }
  ]);
});

test('createClientRef returns a non-empty unique transaction reference', () => {
  const first = globalThis.MRAInvoiceDomain.createClientRef();
  const second = globalThis.MRAInvoiceDomain.createClientRef();

  assert.match(first, /\S+/);
  assert.notEqual(first, second);
});
