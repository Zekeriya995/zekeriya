/* tests/scanner-contract.test.js
 *
 * Contract test — asserts that client-side quickScan() and server-side
 * scoreSymbol() produce identical scoring decisions for the same input
 * fixture. Populated in Phase 2.A.5 (Unified Scoring Rules Registry,
 * see SCANNER_AUDIT_2026_05_15.md §6).
 *
 * For now, this file is a skeleton with one trivial passing test so the
 * test runner registers the suite (and the `npm run test:contract`
 * script wired in Phase 0 has something real to invoke) without flaky
 * placeholders.
 *
 * Implements: SCANNER_AUDIT_2026_05_15.md §6 Phase 0 (compressed).
 * Will be expanded in: Phase 2.A.5.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('scanner-contract skeleton — Phase 0 placeholder', () => {
  /* Phase 2.A.5 will replace this with real assertions comparing
   * quickScan() and scoreSymbol() tag-bag outputs on canned fixtures.
   * Until then, this trivial check just ensures the file is registered
   * with the test runner. */
  assert.equal(1 + 1, 2);
});
