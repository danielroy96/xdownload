// Renders reports/junit.xml as a Markdown test report.
//
// Parses the JUnit XML with fast-xml-parser (a dev/CI-only dependency — the
// shipped app itself carries no such dependency). The XML is machine-generated
// by Vitest's junit reporter, so a real parser is both correct and simpler than
// picking it apart by hand.
//
// Grouping is by FEATURE. Vitest sets each testcase's `classname` to the test
// FILE and its `name` to the full "describe › … › test" path (joined with
// " > "). We take the first path segment as the feature (the top-level
// `describe`) and the remainder as the human-readable scenario. That yields a
// one-row-per-feature overview table plus a per-feature list of scenarios,
// instead of a wall of every test lumped under its filename.
//
// Outputs, all derived from a single parse of the XML:
//   • $GITHUB_STEP_SUMMARY — the report, on the Actions run summary page (CI).
//   • reports/report.md     — the same Markdown, for reuse.
//   • reports/check.json    — a GitHub check-run payload carrying that Markdown
//     as its summary, which ci.yml POSTs so the "Vitest Test Report" check page
//     shows the full report too.
//
// Run by .github/workflows/ci.yml after `npm test`. Locally, `node
// scripts/junit-to-summary.cjs` prints the same Markdown to stdout.
const fs = require('fs');
const { XMLParser } = require('fast-xml-parser');

const XML_PATH = 'reports/junit.xml';

// Escape for use inside the <sub> HTML we emit for the scenario lines. (Attribute
// values arrive already entity-decoded from the parser, so this is the only
// escaping we do — on the way back out into HTML.)
function htmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// fast-xml-parser collapses a single child element to an object and a repeated
// one to an array; normalise both to an array so callers can just iterate.
const toArray = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

// Split a Vitest testcase name ("Feature > nested > scenario") into a feature
// (top-level describe) and a readable scenario (everything below it). Falls back
// gracefully for names with no separator.
function splitName(rawName) {
  const parts = String(rawName).split(' > ');
  if (parts.length <= 1) return { feature: '(ungrouped)', scenario: parts[0] || '' };
  return { feature: parts[0], scenario: parts.slice(1).join(' › ') };
}

if (!fs.existsSync(XML_PATH)) {
  console.error(`No ${XML_PATH} found — did \`npm test\` run and emit the JUnit report?`);
  process.exit(0); // don't fail the job just because the summary is missing
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // Keep attribute values as strings — test names can look numeric and we don't
  // want them coerced. We Number() the count attributes explicitly below.
  parseAttributeValue: false,
});
const doc = parser.parse(fs.readFileSync(XML_PATH, 'utf8'));

const root = doc.testsuites || {};
const total = Number(root['@_tests']) || 0;
const failures = Number(root['@_failures']) || 0;
const errors = Number(root['@_errors']) || 0;
const time = root['@_time'] || '';
const passed = total - failures - errors;

// One entry per feature (the top-level describe, parsed from the testcase name).
// Map insertion order follows document order, so output tracks the source files.
const groups = new Map();
const failing = [];
for (const suite of toArray(root.testsuite)) {
  for (const tc of toArray(suite.testcase)) {
    const { feature, scenario } = splitName(tc['@_name'] != null ? tc['@_name'] : '');
    // Vitest only emits a <failure>/<error> child for a failing case, so the
    // key's mere presence is the signal.
    const failNode = tc.failure !== undefined ? tc.failure : tc.error;
    const failed = failNode !== undefined;

    if (!groups.has(feature)) groups.set(feature, { total: 0, failed: 0, scenarios: [] });
    const g = groups.get(feature);
    g.total += 1;
    g.scenarios.push({ name: scenario, failed });
    if (failed) {
      g.failed += 1;
      const node = toArray(failNode)[0];
      const msg = typeof node === 'string' ? node : (node && node['#text']) || '';
      const firstLine = String(msg).trim().split('\n')[0];
      failing.push(`- **${htmlEscape(feature)} › ${htmlEscape(scenario)}**\n  \`\`\`\n  ${firstLine}\n  \`\`\``);
    }
  }
}

const rows = [...groups.entries()].map(([feature, g]) => {
  const ok = g.failed === 0;
  return `| ${ok ? '✅' : '❌'} | ${feature} | ${g.total} | ${g.total - g.failed} | ${g.failed} |`;
});

// Per-feature scenario breakdown: every scenario name with a pass/fail emoji, in
// <sub> (small text) with ` · ` separators so it stays compact.
const scenarioSections = [...groups.entries()].map(([feature, g]) => {
  const line = g.scenarios
    .map((s) => `${s.failed ? '❌' : '✅'} ${htmlEscape(s.name)}`)
    .join(' · ');
  return `**${feature}**<br><sub>${line}</sub>`;
});

const status = failures + errors === 0 ? '✅ All tests passed' : `❌ ${failures + errors} test(s) failed`;

const md = [
  '## 🧪 Vitest test report',
  '',
  `**${status}** — ${passed}/${total} passed${time ? ` in ${time}s` : ''}.`,
  '',
  '| | Feature | Tests | Passed | Failed |',
  '| :-: | --- | --: | --: | --: |',
  ...rows,
  '',
  '### Scenarios',
  '',
  ...scenarioSections.flatMap((s) => [s, '']),
  ...(failing.length ? ['### Failures', '', ...failing] : []),
  '',
].join('\n');

const failed = failures + errors;

// Reusable Markdown + a check-run payload for ci.yml to POST. The check summary
// renders this same report on the "Vitest Test Report" check page.
fs.writeFileSync('reports/report.md', md);
fs.writeFileSync('reports/check.json', JSON.stringify({
  name: 'Vitest Test Report',
  head_sha: process.env.REPORT_HEAD_SHA || '',
  status: 'completed',
  conclusion: failed > 0 ? 'failure' : 'success',
  output: {
    title: `${passed}/${total} tests passed`,
    summary: md,
  },
}, null, 2));

const out = process.env.GITHUB_STEP_SUMMARY;
if (out) {
  fs.appendFileSync(out, md + '\n');
} else {
  console.log(md);
}
