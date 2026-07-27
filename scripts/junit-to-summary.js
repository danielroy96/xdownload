// Renders reports/junit.xml as a Markdown summary and appends it to the GitHub
// Actions run summary ($GITHUB_STEP_SUMMARY). Dependency-free on purpose — the
// app ships without deps and this keeps CI from pulling in an XML-parsing lib
// just to draw a table. jest-junit's output is flat and predictable, so a
// couple of regexes over the raw XML are enough.
//
// Grouping is by feature — i.e. each Jest `describe` block, which jest.config.js
// maps onto the testcase `classname` (see the jest-junit options there). That
// keeps the summary a short one-row-per-feature table instead of a wall of
// every individual test.
//
// Run by .github/workflows/ci.yml after `npm test`. Locally, `node
// scripts/junit-to-summary.js` prints the same Markdown to stdout.
const fs = require('fs');

const XML_PATH = 'reports/junit.xml';

// Undo the minimal XML entity escaping jest-junit applies to attribute values.
function unescape(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#10;/g, ' ')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

// Pull an attribute out of an opening tag string. The \b guards against a
// short name matching the tail of a longer one — e.g. `name` inside `classname`.
function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? unescape(m[1]) : '';
}

if (!fs.existsSync(XML_PATH)) {
  console.error(`No ${XML_PATH} found — did \`npm test\` run and emit the JUnit report?`);
  process.exit(0); // don't fail the job just because the summary is missing
}

const xml = fs.readFileSync(XML_PATH, 'utf8');

const rootTag = (xml.match(/<testsuites[^>]*>/) || [''])[0];
const total = Number(attr(rootTag, 'tests')) || 0;
const failures = Number(attr(rootTag, 'failures')) || 0;
const errors = Number(attr(rootTag, 'errors')) || 0;
const time = attr(rootTag, 'time');
const passed = total - failures - errors;

// One row per feature (the testcase classname = the Jest `describe` block).
// Insertion order is preserved so the table follows the source file order.
const groups = new Map();
const failing = [];
for (const m of xml.matchAll(/<testcase\b([^>]*)>([\s\S]*?)<\/testcase>/g)) {
  const open = `<testcase ${m[1]}>`;
  const feature = attr(open, 'classname') || '(ungrouped)';
  const failed = /<(failure|error)\b/.test(m[2]);

  if (!groups.has(feature)) groups.set(feature, { total: 0, failed: 0 });
  const g = groups.get(feature);
  g.total += 1;
  if (failed) {
    g.failed += 1;
    const msg = (m[2].match(/<(?:failure|error)[^>]*>([\s\S]*?)<\/(?:failure|error)>/) || [])[1] || '';
    const firstLine = unescape(msg).trim().split('\n')[0];
    failing.push(`- **${feature} › ${attr(open, 'name')}**\n  \`\`\`\n  ${firstLine}\n  \`\`\``);
  }
}

const rows = [...groups.entries()].map(([feature, g]) => {
  const ok = g.failed === 0;
  return `| ${ok ? '✅' : '❌'} | ${feature} | ${g.total} | ${g.total - g.failed} | ${g.failed} |`;
});

const status = failures + errors === 0 ? '✅ All tests passed' : `❌ ${failures + errors} test(s) failed`;

const md = [
  '## 🧪 Jest test report',
  '',
  `**${status}** — ${passed}/${total} passed${time ? ` in ${time}s` : ''}.`,
  '',
  '| | Feature | Tests | Passed | Failed |',
  '| :-: | --- | --: | --: | --: |',
  ...rows,
  ...(failing.length ? ['', '### Failures', '', ...failing] : []),
  '',
].join('\n');

const out = process.env.GITHUB_STEP_SUMMARY;
if (out) {
  fs.appendFileSync(out, md + '\n');
} else {
  console.log(md);
}
