(function (global) {
  function dedupeById(records) {
    const seen = new Set();
    return (records || []).filter(record => {
      const id = record && (record.id || record.invoice_id);
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  function createClientRef() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return global.crypto.randomUUID();
    }

    return `mra-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  global.MRAInvoiceDomain = {
    dedupeById,
    createClientRef
  };
})(typeof window !== 'undefined' ? window : globalThis);
