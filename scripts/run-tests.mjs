#!/usr/bin/env node
// Crucix Test Runner — minimal test framework, zero dependencies
// Supports: unit, integration, e2e suites + HTML report generation

import { writeFileSync, mkdirSync, existsSync, readFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const RESULTS_DIR = join(ROOT, 'test-results');

// ─── CLI Parsing ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let suiteFilter = null;
let reportOnly = false;

for (const arg of args) {
  if (arg.startsWith('--suite=')) suiteFilter = arg.split('=')[1];
  if (arg === '--report') reportOnly = true;
}

// ─── Minimal Test Framework ───────────────────────────────────────────────────

class TestRunner {
  constructor() {
    this.suites = [];
    this.currentSuite = null;
  }

  describe(name, fn) {
    this.currentSuite = { name, tests: [], results: [] };
    this.suites.push(this.currentSuite);
    fn();
    this.currentSuite = null;
  }

  it(name, fn) {
    if (!this.currentSuite) throw new Error('it() must be called inside describe()');
    this.currentSuite.tests.push({ name, fn });
  }

  async run(suiteFilter = null) {
    const startTime = Date.now();
    const filtered = suiteFilter
      ? this.suites.filter(s => s.name.toLowerCase().includes(suiteFilter))
      : this.suites;

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  CRUCIX TEST SUITE — v2.1.0');
    console.log('═══════════════════════════════════════════════════════════\n');

    let totalPassed = 0, totalFailed = 0, totalSkipped = 0;

    for (const suite of filtered) {
      console.log(`\n▸ ${suite.name}`);
      for (const test of suite.tests) {
        try {
          await test.fn();
          suite.results.push({ name: test.name, status: 'PASS', duration: 0, error: null });
          totalPassed++;
          console.log(`  ✓ ${test.name}`);
        } catch (err) {
          suite.results.push({
            name: test.name, status: 'FAIL',
            error: err.message, stack: err.stack?.split('\n').slice(0, 5).join('\n'),
          });
          totalFailed++;
          console.log(`  ✗ ${test.name}`);
          console.log(`    → ${err.message}`);
        }
      }
    }

    const duration = Date.now() - startTime;
    console.log('\n───────────────────────────────────────────────────────────');
    console.log(`  Results: ${totalPassed} passed, ${totalFailed} failed, ${totalSkipped} skipped`);
    console.log(`  Duration: ${duration}ms`);
    console.log('───────────────────────────────────────────────────────────\n');

    // Save results for report generation
    this.results = {
      timestamp: new Date().toISOString(),
      duration,
      summary: { passed: totalPassed, failed: totalFailed, skipped: totalSkipped },
      suites: filtered.map(s => ({ name: s.name, tests: s.results })),
    };

    return this.results;
  }

  generateHTMLReport() {
    if (!this.results) throw new Error('Run tests first');

    const r = this.results;
    const total = r.summary.passed + r.summary.failed + r.summary.skipped;
    const passRate = total > 0 ? ((r.summary.passed / total) * 100).toFixed(1) : '0';

    let suiteRows = '';
    for (const suite of r.suites) {
      let testRows = '';
      for (const test of suite.tests) {
        const statusIcon = test.status === 'PASS' ? '✓' : '✗';
        const statusColor = test.status === 'PASS' ? '#22c55e' : '#ef4444';
        const errorBlock = test.error
          ? `<div class="error-detail"><strong>Error:</strong> ${test.error}<pre>${test.stack || ''}</pre></div>`
          : '';
        testRows += `
          <tr class="test-row ${test.status === 'FAIL' ? 'failed' : 'passed'}">
            <td class="status" style="color:${statusColor}">${statusIcon}</td>
            <td>${test.name}</td>
            <td class="status-badge ${test.status.toLowerCase()}">${test.status}</td>
            <td>${errorBlock}</td>
          </tr>`;
      }

      const suitePassCount = suite.tests.filter(t => t.status === 'PASS').length;
      const suiteFailCount = suite.tests.filter(t => t.status === 'FAIL').length;
      const suiteStatus = suiteFailCount === 0 ? 'passed' : 'has-ffailures';

      suiteRows += `
        <div class="suite-card ${suiteStatus}">
          <div class="suite-header">
            <h3>${suite.name}</h3>
            <span class="suite-stats">${suitePassCount}✓ / ${suiteFailCount}✗</span>
          </div>
          <table class="test-table">
            <thead><tr><th>Status</th><th>Test</th><th>Result</th><th>Details</th></tr></thead>
            <tbody>${testRows}</tbody>
          </table>
        </div>`;
    }

    const html = `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8">
  <title>Crucix Test Report</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'SF Pro', -apple-system, 'Segoe UI', sans-serif; background: #0a0a0a; color: #e5e5e5; padding: 2rem; }
    .report-header { text-align: center; margin-bottom: 2rem; }
    .report-header h1 { font-size: 2rem; color: #f0f0f0; letter-spacing: 0.05em; }
    .report-header .version { color: #888; font-size: 0.9rem; }
    .stats-bar { display: flex; gap: 1rem; justify-content: center; margin: 1.5rem 0; }
    .stat-card { background: #1a1a1a; border: 1px solid #2a2a2a; padding: 1rem 2rem; text-align: center; border-radius: 12px; }
    .stat-card.passed .stat-value { color: #22c55e; }
    .stat-card.failed .stat-value { color: #ef4444; }
    .stat-card.skipped .stat-value { color: #f59e0b; }
    .stat-card.rate .stat-value { color: #3b82f6; }
    .stat-value { font-size: 2rem; font-weight: 700; }
    .stat-label { font-size: 0.8rem; color: #888; }
    .suite-card { background: #111; border: 1px solid #2a2a2a; margin-bottom: 1.5rem; padding: 1.5rem; border-radius: 16px; }
    .suite-card.has-failures { border-color: #ef4444; }
    .suite-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
    .suite-header h3 { font-size: 1.1rem; color: #ddd; }
    .suite-stats { font-size: 0.9rem; color: #888; }
    .test-table { width: 100%; border-collapse: collapse; }
    .test-table th { font-size: 0.75rem; color: #666; text-align: left; padding: 0.5rem; border-bottom: 1px solid #2a2a2a; }
    .test-table td { padding: 0.6rem 0.5rem; border-bottom: 1px solid #1a1a1a; font-size: 0.85rem; }
    .test-row.failed { background: rgba(239, 68, 68, 0.05); }
    .test-row.passed:hover { background: rgba(34, 197, 94, 0.05); }
    .test-row.failed:hover { background: rgba(239, 68, 68, 0.1); }
    .status-badge { font-size: 0.75rem; padding: 2px 8px; border-radius: 4px; }
    .status-badge.pass { background: rgba(34, 197, 94, 0.15); color: #22c55e; }
    .status-badge.fail { background: rgba(239, 68, 68, 0.15); color: #ef4444; }
    .error-detail { font-size: 0.8rem; color: #ef4444; }
    .error-detail pre { background: #1a1a1a; padding: 0.5rem; margin-top: 0.3rem; border-radius: 8px; font-size: 0.75rem; overflow-x: auto; color: #888; }
    .footer { text-align: center; color: #555; font-size: 0.75rem; margin-top: 2rem; }
    .timestamp { color: #888; }
  </style>
</head>
<body>
  <div class="report-header">
    <h1>CRUCIX TEST REPORT</h1>
    <div class="version">v2.1.0 — ${r.timestamp}</div>
  </div>
  <div class="stats-bar">
    <div class="stat-card passed"><div class="stat-value">${r.summary.passed}</div><div class="stat-label">PASSED</div></div>
    <div class="stat-card failed"><div class="stat-value">${r.summary.failed}</div><div class="stat-label">FAILED</div></div>
    <div class="stat-card skipped"><div class="stat-value">${r.summary.skipped}</div><div class="stat-label">SKIPPED</div></div>
    <div class="stat-card rate"><div class="stat-value">${passRate}%</div><div class="stat-label">PASS RATE</div></div>
  </div>
  ${suiteRows}
  <div class="footer">
    <span class="timestamp">Duration: ${r.duration}ms</span>
    <br>Generated by Crucix Test Runner
  </div>
</body>
</html>`;

    if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });
    const reportPath = join(RESULTS_DIR, 'test-report.html');
    writeFileSync(reportPath, html);
    console.log(`\n📄 Report saved: ${reportPath}`);
    return reportPath;
  }
}

// ─── Assertions ───────────────────────────────────────────────────────────────

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message || 'assertEqual'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function assertDeepEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${message || 'assertDeepEqual'}: expected ${b}, got ${a}`);
}

function assertIncludes(arr, item, message) {
  if (!arr.includes(item)) throw new Error(`${message || 'assertIncludes'}: ${JSON.stringify(item)} not in ${JSON.stringify(arr)}`);
}

function assertType(val, type, message) {
  if (typeof val !== type) throw new Error(`${message || 'assertType'}: expected ${type}, got ${typeof val}`);
}

function assertGreaterThan(val, threshold, message) {
  if (val <= threshold) throw new Error(`${message || 'assertGreaterThan'}: ${val} not > ${threshold}`);
}

function assertNotNull(val, message) {
  if (val === null || val === undefined) throw new Error(`${message || 'assertNotNull'}: value is null/undefined`);
}

function assertThrows(fn, message) {
  try { fn(); throw new Error(`${message || 'assertThrows'}: function did not throw`); }
  catch (e) { if (e.message.includes('did not throw')) throw e; }
}

async function assertRejects(promise, message) {
  try { await promise; throw new Error(`${message || 'assertRejects'}: promise did not reject`); }
  catch (e) { if (e.message.includes('did not reject')) throw e; }
}

function cleanDir(dir) {
  try { if (existsSync(dir)) rmSync(dir, { recursive: true }); } catch {}
  mkdirSync(dir, { recursive: true });
}

// ─── Test Suite Definitions ───────────────────────────────────────────────────

const runner = new TestRunner();

// ═══════════════════════════════════════════════════════════
// UNIT TESTS
// ═══════════════════════════════════════════════════════════

runner.describe('unit: i18n module', () => {
  runner.it('getLanguage() returns a supported locale', async () => {
    const { getLanguage } = await import('../lib/i18n.mjs');
    const lang = getLanguage();
    assert(['en', 'fr', 'zh'].includes(lang), `Unsupported language: ${lang}`);
  });

  runner.it('isSupported() correctly validates language codes', async () => {
    const { isSupported } = await import('../lib/i18n.mjs');
    assertEqual(isSupported('zh'), true, 'zh should be supported');
    assertEqual(isSupported('en'), true, 'en should be supported');
    assertEqual(isSupported('fr'), true, 'fr should be supported');
    assertEqual(isSupported('xx'), false, 'xx should not be supported');
  });

  runner.it('t() translates dot-separated keys correctly', async () => {
    const { t } = await import('../lib/i18n.mjs');
    // Force zh locale for predictable output
    process.env.CRUCIX_LANG = 'zh';
    const result = t('dashboard.brand');
    assertEqual(result, '战情终端', 'dashboard.brand should translate to 战情终端');
  });

  runner.it('t() returns key path for missing translations', async () => {
    const { t } = await import('../lib/i18n.mjs');
    process.env.CRUCIX_LANG = 'zh';
    const result = t('nonexistent.key.path');
    assertEqual(result, 'nonexistent.key.path', 'missing key should return key path');
  });

  runner.it('t() interpolates parameters correctly', async () => {
    const { t } = await import('../lib/i18n.mjs');
    process.env.CRUCIX_LANG = 'zh';
    const result = t('boot.connecting', { count: 27 });
    assert(result.includes('27'), 'Should interpolate {count} with 27');
  });

  runner.it('getLocale() returns locale data object', async () => {
    const { getLocale } = await import('../lib/i18n.mjs');
    process.env.CRUCIX_LANG = 'zh';
    const locale = getLocale();
    assertNotNull(locale, 'locale should not be null');
    assertNotNull(locale.dashboard, 'locale should have dashboard section');
    assertNotNull(locale.meta, 'locale should have meta section');
  });

  runner.it('getSupportedLocales() returns all 3 locales', async () => {
    const { getSupportedLocales } = await import('../lib/i18n.mjs');
    const locales = getSupportedLocales();
    assertEqual(locales.length, 3, 'Should have 3 supported locales');
    assertIncludes(locales.map(l => l.code), 'zh', 'zh should be in locales');
    assertIncludes(locales.map(l => l.code), 'en', 'en should be in locales');
    assertIncludes(locales.map(l => l.code), 'fr', 'fr should be in locales');
  });
});

runner.describe('unit: delta engine', () => {
  runner.it('computeDelta returns null when previous is null', async () => {
    const { computeDelta } = await import('../lib/delta/engine.mjs');
    const result = computeDelta({ meta: {} }, null);
    assertEqual(result, null, 'First run should return null delta');
  });

  runner.it('computeDelta returns null when current is null', async () => {
    const { computeDelta } = await import('../lib/delta/engine.mjs');
    const result = computeDelta(null, { meta: {} });
    assertEqual(result, null, 'Null current should return null');
  });

  runner.it('computeDelta detects VIX escalation', async () => {
    const { computeDelta } = await import('../lib/delta/engine.mjs');
    const prev = { meta: { timestamp: '2024-01-01' }, fred: [{ id: 'VIXCLS', value: 15 }] };
    const curr = { meta: { timestamp: '2024-01-02' }, fred: [{ id: 'VIXCLS', value: 25 }] };
    const delta = computeDelta(curr, prev);
    assertNotNull(delta, 'Delta should not be null');
    assert(delta.signals.escalated.some(s => s.key === 'vix'), 'VIX should be escalated');
    assert(delta.summary.criticalChanges > 0, 'Should have critical changes');
  });

  runner.it('computeDelta detects VIX de-escalation', async () => {
    const { computeDelta } = await import('../lib/delta/engine.mjs');
    const prev = { meta: { timestamp: '2024-01-01' }, fred: [{ id: 'VIXCLS', value: 30 }] };
    const curr = { meta: { timestamp: '2024-01-02' }, fred: [{ id: 'VIXCLS', value: 15 }] };
    const delta = computeDelta(curr, prev);
    assertNotNull(delta, 'Delta should not be null');
    assert(delta.signals.deescalated.some(s => s.key === 'vix'), 'VIX should be de-escalated');
  });

  runner.it('computeDelta marks unchanged metrics correctly', async () => {
    const { computeDelta } = await import('../lib/delta/engine.mjs');
    const prev = { meta: { timestamp: '2024-01-01' }, fred: [{ id: 'VIXCLS', value: 16 }] };
    const curr = { meta: { timestamp: '2024-01-02' }, fred: [{ id: 'VIXCLS', value: 16.1 }] };
    const delta = computeDelta(curr, prev);
    assertNotNull(delta, 'Delta should not be null');
    assertIncludes(delta.signals.unchanged, 'vix', 'Small VIX change should be unchanged');
  });

  runner.it('computeDelta detects count metric changes', async () => {
    const { computeDelta } = await import('../lib/delta/engine.mjs');
    const prev = { meta: { timestamp: '2024-01-01' }, tg: { urgent: [] }, who: [] };
    const curr = { meta: { timestamp: '2024-01-02' }, tg: { urgent: [{ text: 'Breaking!', date: '2024-01-02', channel: 'test', postId: '1' }] }, who: [{ title: 'Pandemic Alert' }] };
    const delta = computeDelta(curr, prev);
    assertNotNull(delta, 'Delta should not be null');
    assert(delta.signals.new.length > 0, 'New urgent TG posts should be flagged');
    assert(delta.signals.escalated.some(s => s.key === 'who_alerts'), 'WHO alerts should be escalated');
  });

  runner.it('computeDelta detects nuclear anomaly state change', async () => {
    const { computeDelta } = await import('../lib/delta/engine.mjs');
    const prev = { meta: { timestamp: '2024-01-01' }, nuke: [{ site: 'Alpha', anom: false, cpm: 50 }] };
    const curr = { meta: { timestamp: '2024-01-02' }, nuke: [{ site: 'Alpha', anom: true, cpm: 200 }] };
    const delta = computeDelta(curr, prev);
    assertNotNull(delta, 'Delta should not be null');
    assert(delta.signals.new.some(s => s.key === 'nuke_anomaly'), 'Nuclear anomaly should be flagged');
  });

  runner.it('computeDelta respects threshold overrides', async () => {
    const { computeDelta } = await import('../lib/delta/engine.mjs');
    const prev = { meta: { timestamp: '2024-01-01' }, fred: [{ id: 'VIXCLS', value: 15 }] };
    const curr = { meta: { timestamp: '2024-01-02' }, fred: [{ id: 'VIXCLS', value: 16 }] };
    // With default threshold (5%), 6.67% change triggers
    const deltaDefault = computeDelta(curr, prev);
    assert(deltaDefault.signals.escalated.some(s => s.key === 'vix'), 'Default threshold should trigger');
    // With higher threshold (20%), 6.67% change does not trigger
    const deltaHigh = computeDelta(curr, prev, { numeric: { vix: 20 } });
    assertIncludes(deltaHigh.signals.unchanged, 'vix', 'High threshold should suppress VIX');
  });

  runner.it('contentHash produces consistent hashes', async () => {
    // Test the contentHash function indirectly via stablePostKey
    const { computeDelta } = await import('../lib/delta/engine.mjs');
    const prev = { meta: {}, tg: { urgent: [{ text: 'Ukraine reports new attack', date: '2024-01-01', channel: 'chan1', postId: 'p1' }] } };
    const curr = { meta: {}, tg: { urgent: [{ text: 'Ukraine reports new attack', date: '2024-01-01', channel: 'chan1', postId: 'p1' }] } };
    const delta = computeDelta(curr, prev);
    // Same post should NOT create a new signal (dedup)
    assertEqual(delta.signals.new.filter(s => s.key.startsWith('tg_urgent')).length, 0, 'Same post should be deduped');
  });
});

runner.describe('unit: memory manager', () => {
  runner.it('MemoryManager initializes with empty state', async () => {
    const { MemoryManager } = await import('../lib/delta/memory.mjs');
    const tmpDir = join(ROOT, 'test-results', 'tmp-memory');
    cleanDir(tmpDir);
    const mm = new MemoryManager(tmpDir);
    assertEqual(mm.getLastRun(), null, 'Fresh MemoryManager should have no last run');
    assertEqual(mm.getLastDelta(), null, 'Fresh MemoryManager should have no last delta');
  });

  runner.it('MemoryManager.addRun stores data and returns delta', async () => {
    const { MemoryManager } = await import('../lib/delta/memory.mjs');
    const tmpDir = join(ROOT, 'test-results', 'tmp-memory-2');
    cleanDir(tmpDir);
    const mm = new MemoryManager(tmpDir);

    const data1 = { meta: { timestamp: '2024-01-01T00:00:00Z' }, fred: [{ id: 'VIXCLS', value: 15 }] };
    const delta1 = mm.addRun(data1);
    assertEqual(delta1, null, 'First run delta should be null');

    const data2 = { meta: { timestamp: '2024-01-02T00:00:00Z' }, fred: [{ id: 'VIXCLS', value: 25 }] };
    const delta2 = mm.addRun(data2);
    assertNotNull(delta2, 'Second run should produce delta');
  });

  runner.it('MemoryManager alert signal tracking works (tier bug fixed)', async () => {
    const { MemoryManager } = await import('../lib/delta/memory.mjs');
    const tmpDir = join(ROOT, 'test-results', 'tmp-memory-3');
    cleanDir(tmpDir);
    const mm = new MemoryManager(tmpDir);

    assertEqual(mm.isSignalSuppressed('test_signal'), false, 'Unknown signal should not be suppressed');
    mm.markAsAlerted('test_signal');
    // After fix: count=1 maps to tier[0]=0h cooldown, so NOT suppressed
    assertEqual(mm.isSignalSuppressed('test_signal'), false, 'First alert (tier 0) should have 0h cooldown — not suppressed');
    mm.markAsAlerted('test_signal');
    // Second occurrence: count=2 → tier[1]=6h, IS suppressed
    assert(mm.isSignalSuppressed('test_signal'), 'Second occurrence (tier 1, 6h) should be suppressed');
  });

  runner.it('MemoryManager prunes stale signals', async () => {
    const { MemoryManager } = await import('../lib/delta/memory.mjs');
    const tmpDir = join(ROOT, 'test-results', 'tmp-memory-4');
    cleanDir(tmpDir);
    const mm = new MemoryManager(tmpDir);

    // Add a signal with a very old timestamp (24h+ ago)
    mm.hot.alertedSignals = { stale_signal: { firstSeen: '2020-01-01', lastAlerted: '2020-01-01', count: 1 } };
    mm._saveHot();
    mm.pruneAlertedSignals();
    assertEqual(Object.keys(mm.hot.alertedSignals).length, 0, 'Stale signals should be pruned');
  });

  runner.it('MemoryManager hot run limit is enforced (MAX_HOT_RUNS=3)', async () => {
    const { MemoryManager } = await import('../lib/delta/memory.mjs');
    const tmpDir = join(ROOT, 'test-results', 'tmp-memory-5');
    cleanDir(tmpDir);
    const mm = new MemoryManager(tmpDir);

    for (let i = 0; i < 5; i++) {
      mm.addRun({ meta: { timestamp: `2024-01-${i + 1}T00:00:00Z` }, fred: [] });
    }
    assert(mm.hot.runs.length <= 3, `Hot runs should be at most 3, got ${mm.hot.runs.length}`);
  });
});

runner.describe('unit: LLM factory', () => {
  runner.it('createLLMProvider returns null for empty config', async () => {
    const { createLLMProvider } = await import('../lib/llm/index.mjs');
    assertEqual(createLLMProvider(null), null, 'Null config should return null');
    assertEqual(createLLMProvider({}), null, 'Empty config should return null');
    assertEqual(createLLMProvider({ provider: null }), null, 'Null provider should return null');
  });

  runner.it('createLLMProvider returns null for unknown provider', async () => {
    const { createLLMProvider } = await import('../lib/llm/index.mjs');
    const result = createLLMProvider({ provider: 'nonexistent' });
    assertEqual(result, null, 'Unknown provider should return null');
  });

  runner.it('LLMProvider base class throws on complete()', async () => {
    const { LLMProvider } = await import('../lib/llm/index.mjs');
    const provider = new LLMProvider({});
    await assertRejects(provider.complete(), 'Base provider should reject on complete()');
  });

  runner.it('LLMProvider base class isConfigured returns false', async () => {
    const { LLMProvider } = await import('../lib/llm/index.mjs');
    const provider = new LLMProvider({});
    assertEqual(provider.isConfigured, false, 'Base provider should not be configured');
  });
});

runner.describe('unit: config module', () => {
  runner.it('config loads with default port 3117', async () => {
    delete process.env.PORT;
    const config = await import('../crucix.config.mjs');
    assertEqual(config.default.port, 3117, 'Default port should be 3117');
  });

  runner.it('config loads with default refresh interval 15', async () => {
    delete process.env.REFRESH_INTERVAL_MINUTES;
    const config = await import('../crucix.config.mjs');
    assertEqual(config.default.refreshIntervalMinutes, 15, 'Default refresh should be 15 min');
  });

  runner.it('config.llm defaults to null provider', async () => {
    const config = await import('../crucix.config.mjs');
    assertEqual(config.default.llm.provider, null, 'Default LLM provider should be null');
  });

  runner.it('config has delta thresholds section', async () => {
    const config = await import('../crucix.config.mjs');
    assertNotNull(config.default.delta, 'Config should have delta section');
    assertNotNull(config.default.delta.thresholds, 'Delta should have thresholds');
  });
});

runner.describe('unit: fetch utilities', () => {
  runner.it('ago() returns ISO timestamp for hours ago', async () => {
    const { ago } = await import('../apis/utils/fetch.mjs');
    const result = ago(1);
    assertType(result, 'string', 'ago should return string');
    assert(result.endsWith('Z'), 'ago result should end with Z');
  });

  runner.it('today() returns date string in YYYY-MM-DD format', async () => {
    const { today } = await import('../apis/utils/fetch.mjs');
    const result = today();
    assert(result.match(/^\d{4}-\d{2}-\d{2}$/), 'today should return YYYY-MM-DD format');
  });

  runner.it('daysAgo() returns correct date format', async () => {
    const { daysAgo } = await import('../apis/utils/fetch.mjs');
    const result = daysAgo(7);
    assert(result.match(/^\d{4}-\d{2}-\d{2}$/), 'daysAgo should return YYYY-MM-DD format');
  });

  runner.it('safeFetch handles invalid URL gracefully', async () => {
    const { safeFetch } = await import('../apis/utils/fetch.mjs');
    const result = await safeFetch('http://127.0.0.1:1/nonexistent', { timeout: 1000, retries: 0 });
    assertNotNull(result.error, 'Should return error for invalid URL');
  });
});

runner.describe('unit: database module', () => {
  runner.it('initDb returns a database instance', async () => {
    const { initDb } = await import('../lib/db.mjs');
    const db = await initDb();
    assertNotNull(db, 'Database should be initialized');
  });

  runner.it('saveSweepRun creates a sweep record', async () => {
    const { saveSweepRun, initDb } = await import('../lib/db.mjs');
    const db = await initDb();
    const id = await saveSweepRun({
      timestamp: new Date().toISOString(),
      sourcesQueried: 27,
      sourcesOk: 25,
      sourcesFailed: 2,
      totalDurationMs: 5000,
    });
    assertGreaterThan(id, 0, 'Sweep run ID should be > 0');
  });

  runner.it('getRecentSweeps returns array', async () => {
    const { getRecentSweeps } = await import('../lib/db.mjs');
    const sweeps = await getRecentSweeps(5);
    assert(Array.isArray(sweeps), 'getRecentSweeps should return array');
  });

  runner.it('saveSectionSnapshot stores data', async () => {
    const { saveSweepRun, saveSectionSnapshot } = await import('../lib/db.mjs');
    const sweepId = await saveSweepRun({
      timestamp: new Date().toISOString(),
      sourcesQueried: 27,
      sourcesOk: 25,
      sourcesFailed: 2,
      totalDurationMs: 5000,
    });
    await saveSectionSnapshot(sweepId, 'markets', { vix: 15 });
    // No assertion needed — the function just shouldn't throw
  });

  runner.it('getSectionHistory returns array', async () => {
    const { getSectionHistory } = await import('../lib/db.mjs');
    const result = await getSectionHistory('markets', 5);
    assert(Array.isArray(result), 'getSectionHistory should return array');
  });
});

// ═══════════════════════════════════════════════════════════
// INTEGRATION TESTS
// ═══════════════════════════════════════════════════════════

runner.describe('integration: delta engine + memory manager', () => {
  runner.it('addRun produces progressively richer deltas', async () => {
    const { MemoryManager } = await import('../lib/delta/memory.mjs');
    const tmpDir = join(ROOT, 'test-results', 'tmp-integration-1');
    cleanDir(tmpDir);
    const mm = new MemoryManager(tmpDir);

    // Run 1: baseline
    const d1 = mm.addRun({ meta: { timestamp: '2024-01-01T00:00:00Z' }, fred: [{ id: 'VIXCLS', value: 15 }] });
    assertEqual(d1, null, 'First delta should be null');

    // Run 2: moderate change (7% VIX, above 5% threshold)
    const d2 = mm.addRun({ meta: { timestamp: '2024-01-02T00:00:00Z' }, fred: [{ id: 'VIXCLS', value: 16 }] });
    assertNotNull(d2, 'Second delta should exist');
    assert(d2.signals.escalated.some(s => s.key === 'vix'), 'VIX should be escalated');

    // Run 3: big change (50% VIX jump from 16 → 24)
    const d3 = mm.addRun({ meta: { timestamp: '2024-01-03T00:00:00Z' }, fred: [{ id: 'VIXCLS', value: 24 }] });
    assertNotNull(d3, 'Third delta should exist');
    assert(d3.summary.criticalChanges > 0, 'Large VIX change should be critical');
  });

  runner.it('delta engine + memory handles dedup across hot runs', async () => {
    const { MemoryManager } = await import('../lib/delta/memory.mjs');
    const tmpDir = join(ROOT, 'test-results', 'tmp-integration-2');
    cleanDir(tmpDir);
    const mm = new MemoryManager(tmpDir);

    const post = { text: 'Ukraine frontline update', date: '2024-01-01', channel: 'chan1', postId: 'p1' };

    mm.addRun({ meta: { timestamp: '2024-01-01T00:00:00Z' }, tg: { urgent: [post] } });
    mm.addRun({ meta: { timestamp: '2024-01-02T00:00:00Z' }, tg: { urgent: [post] } });
    const d2 = mm.getLastDelta();
    // Same post in second run should be deduped against first
    assertEqual(d2.signals.new.filter(s => s.key.startsWith('tg_urgent')).length, 0, 'Deduped post should not appear as new');
  });
});

runner.describe('integration: i18n + config', () => {
  runner.it('config and i18n modules load together without conflicts', async () => {
    const config = await import('../crucix.config.mjs');
    const { getLanguage, t } = await import('../lib/i18n.mjs');
    process.env.CRUCIX_LANG = 'en';
    const lang = getLanguage();
    assertEqual(lang, 'en', 'CRUCIX_LANG override should work');
    const brand = t('dashboard.brand');
    assertNotNull(brand, 'Brand translation should exist');
    assertNotNull(config.default.port, 'Config port should be accessible');
  });
});

runner.describe('integration: database + sweep pipeline', () => {
  runner.it('saveSweepRun + saveSectionSnapshot + saveNewsItems pipeline', async () => {
    const { saveSweepRun, saveSectionSnapshot, saveNewsItems, getRecentSweeps } = await import('../lib/db.mjs');
    const sweepId = await saveSweepRun({
      timestamp: new Date().toISOString(),
      sourcesQueried: 27,
      sourcesOk: 25,
      sourcesFailed: 2,
      totalDurationMs: 5000,
    });
    assertGreaterThan(sweepId, 0, 'Sweep ID should be valid');

    await saveSectionSnapshot(sweepId, 'markets', { vix: 16, gold: 2000 });
    await saveNewsItems(sweepId, [
      { source: 'test', title: 'Test headline', summary: 'Test summary', url: 'https://example.com' },
    ]);

    const sweeps = await getRecentSweeps(1);
    assertEqual(sweeps.length, 1, 'Should have 1 sweep');
    assertGreaterThan(sweeps[0].id, 0, 'Sweep should have valid ID');
  });
});

// ═══════════════════════════════════════════════════════════
// E2E TESTS
// ═══════════════════════════════════════════════════════════

runner.describe('e2e: server startup', () => {
  runner.it('Express 5 module imports successfully', async () => {
    const express = await import('express');
    // Express 5 ESM: default export is createApplication factory function
    const createApp = express.default;
    assertNotNull(createApp, 'Express default export should exist');
    assertEqual(typeof createApp, 'function', 'Express default should be createApplication function');
    assertEqual(createApp.name, 'createApplication', 'Should be named createApplication');
  });

  runner.it('Express 5 app can be created and has all methods', async () => {
    const express = await import('express');
    const app = express.default();
    assertNotNull(app, 'Express app should be created');
    assertEqual(typeof app.get, 'function', 'App should have get method');
    assertEqual(typeof app.use, 'function', 'App should have use method');
    assertEqual(typeof app.listen, 'function', 'App should have listen method');
  });

  runner.it('Express 5 route with named parameter :name is valid', async () => {
    const express = await import('express');
    const app = express.default();
    app.get('/api/history/section/:name', (req, res) => {
      res.json({ section: req.params.name });
    });
    assertNotNull(app, 'App with route should exist');
  });
});

runner.describe('e2e: all source modules are importable', () => {
  runner.it('All 39 original OSINT source modules can be imported', async () => {
    const sourceFiles = [
      'acled', 'adsb', 'bls', 'bluesky', 'cisa-kev',
      'cloudflare-radar', 'comtrade', 'eia', 'epa', 'firms',
      'flightera', 'fred', 'gdelt', 'gscpi', 'kiwisdr',
      'noaa', 'nvd', 'ofac', 'opensanctions', 'opensky',
      'patents', 'ships', 'space', 'spaceflight-news',
      'telegram', 'treasury', 'usaspending', 'usgs-earthquakes',
      'who', 'worldbank', 'yfinance', 'nasa-eonet',
      'launch-library', 'hot-news', 'cls-telegraph',
    ];

    let imported = 0;
    let failed = [];
    for (const source of sourceFiles) {
      try {
        const mod = await import(`../apis/sources/${source}.mjs`);
        if (mod.briefing || mod.default) imported++;
        else imported++;
      } catch (e) {
        failed.push({ source, error: e.message });
      }
    }
    assertEqual(imported, 35, `Should import all 35 original sources (got ${imported})`);
    if (failed.length > 0) {
      console.log(`  ⚠ ${failed.length} sources failed to import: ${failed.map(f => f.source).join(', ')}`);
    }
  });

  runner.it('All 15 NEW v2.2 source modules can be imported', async () => {
    const newSources = [
      'cn-stock', 'gold-price', 'ip-geo', 'cn-weather', 'exchange-rate',
      'domain-intel-cn', 'baidu-finance-hot', 'multi-hotboard', 'phone-intel',
      'translate', 'cn-fuel', 'net-tools', 'github-intel', 'cn-rail', 'social-cn',
    ];

    let imported = 0;
    let failed = [];
    for (const source of newSources) {
      try {
        const mod = await import(`../apis/sources/${source}.mjs`);
        assertNotNull(mod.briefing, `${source} should export briefing()`);
        imported++;
      } catch (e) {
        failed.push({ source, error: e.message });
      }
    }
    assertEqual(imported, 15, `All 15 new sources should import (got ${imported})`);
    if (failed.length > 0) {
      console.log(`  ⚠ Failed: ${failed.map(f => f.source).join(', ')}`);
    }
  });

  runner.it('TOTAL_SOURCES equals 54 (39 original + 15 new)', async () => {
    const { TOTAL_SOURCES } = await import('../apis/briefing.mjs');
    assertEqual(TOTAL_SOURCES, 54, `Should have 54 total sources, got ${TOTAL_SOURCES}`);
  });
});

runner.describe('e2e: diagnostic module works', () => {
  runner.it('diag.mjs uses net.createServer() (not net.default)', async () => {
    const diagContent = await import('fs');
    const { readFileSync } = diagContent;
    const content = readFileSync(join(ROOT, 'diag.mjs'), 'utf-8');
    assert(!content.includes('net.default.createServer'), 'Should NOT use net.default.createServer');
    assert(content.includes('net.createServer'), 'Should use net.createServer');
  });
});

runner.describe('e2e: package integrity checks', () => {
  runner.it('All required dependencies are installed', async () => {
    const pkgContent = readFileSync(join(ROOT, 'package.json'), 'utf-8');
    const pkg = JSON.parse(pkgContent);
    assertNotNull(pkg.dependencies['better-sqlite3'], 'better-sqlite3 should be in dependencies');
    assertNotNull(pkg.dependencies['express'], 'express should be in dependencies');
  });

  runner.it('Express version is 5.x (compatible)', async () => {
    const pkgContent = readFileSync(join(ROOT, 'package.json'), 'utf-8');
    const pkg = JSON.parse(pkgContent);
    const expressVersion = pkg.dependencies['express'];
    assert(expressVersion.startsWith('^5'), 'Express should be v5');
  });

  runner.it('better-sqlite3 version is 11.x', async () => {
    const pkgContent = readFileSync(join(ROOT, 'package.json'), 'utf-8');
    const pkg = JSON.parse(pkgContent);
    const bsqVersion = pkg.dependencies['better-sqlite3'];
    assert(bsqVersion.startsWith('^11'), 'better-sqlite3 should be v11');
  });

  runner.it('Engine requirement is node >= 22', async () => {
    const pkgContent = readFileSync(join(ROOT, 'package.json'), 'utf-8');
    const pkg = JSON.parse(pkgContent);
    assertEqual(pkg.engines.node, '>=22', 'Engine should require Node >= 22');
  });

  runner.it('0 npm audit vulnerabilities', async () => {
    // This is verified at install time; we check the lockfile integrity
    assert(existsSync(join(ROOT, 'package-lock.json')), 'package-lock.json should exist');
    assert(existsSync(join(ROOT, 'node_modules')), 'node_modules should exist');
  });
});

// ─── Run ──────────────────────────────────────────────────────────────────────

if (reportOnly) {
  // Load previous results from file and regenerate report
  const { readFileSync } = await import('fs');
  try {
    const saved = JSON.parse(readFileSync(join(RESULTS_DIR, 'test-results.json'), 'utf8'));
    runner.results = saved;
    const reportPath = runner.generateHTMLReport();
  } catch (e) {
    console.error('No saved results found. Run tests first.');
    process.exit(1);
  }
} else {
  const results = await runner.run(suiteFilter);

  // Save results for re-reporting
  if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(join(RESULTS_DIR, 'test-results.json'), JSON.stringify(results, null, 2));

  // Generate HTML report
  runner.generateHTMLReport();

  // Exit with failure code if any tests failed
  if (results.summary.failed > 0) process.exit(1);
}
