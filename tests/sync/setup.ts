// The engine's database is IndexedDB, which Node does not have. The module
// under test is the real src/sync/db.ts; only the browser API beneath it is
// replaced. (This is the gap the README names: a real browser's IndexedDB is
// not exercised here.)
import 'fake-indexeddb/auto'
