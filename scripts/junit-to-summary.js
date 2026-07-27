// Renders reports/junit.xml as a Markdown summary and appends it to the GitHub
// Actions run summary ($GITHUB_STEP_SUMMARY). Dependency-free on purpose — the
// app ships without deps and this keeps CI from pulling in an XML-parsing lib
// just to draw a table. jest-junit's output is flat and predictable, so a
// couple of regexes over the raw XML are enough.
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
    .replace(/&amp;/g, '&');
}

// Pull an attribute out of an opening tag string.
function attr(tag, name) {
  const m = tag.match(new RegExp(`${name}="([^"]*)"`));
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

// Per-suite rollup for the table.
const suites = [...xml.matchAll(/<testsuite\b[^>]*>/g)].map((m) => m[0]);
const rows = suites.map((tag) => {
  const t = Number(attr(tag, 'tests')) || 0;
  const f = Number(attr(tag, 'failures')) || 0;
  const e = Number(attr(tag, 'errors')) || 0;
  const skipped = Number(attr(tag, 'skipped')) || 0;
  const ok = f === 0 && e === 0;
  return `| ${ok ? '✅' : '❌'} | \`${attr(tag, 'name')}\` | ${t} | ${t - f - e - skipped} | ${f + e} | ${skipped} | ${attr(tag, 'time')}s |`;
});

// Collect the failing cases (with their <failure> message) so a red build
// tells you *what* broke without leaving the summary page.
const failing = [...xml.matchAll(/<testcase\b([^>]*)>([\s\S]*?)<\/testcase>/g)]
  .filter((m) => /<(failure|error)\b/.test(m[2]))
  .map((m) => {
    const name = attr(`<testcase ${m[1]}>`, 'name');
    const msg = (m[2].match(/<(?:failure|error)[^>]*>([\s\S]*?)<\/(?:failure|error)>/) || [])[1] || '';
    const firstLine = unescape(msg).trim().split('\n')[0];
    return `- **${name}**\n  \`\`\`\n  ${firstLine}\n  \`\`\``;
  });

const status = failures + errors === 0 ? '✅ All tests passed' : `❌ ${failures + errors} test(s) failed`;

const md = [
  '## 🧪 Jest test report',
  '',
  `**${status}** — ${passed}/${total} passed${time ? ` in ${time}s` : ''}.`,
  '',
  '| | Suite | Tests | Passed | Failed | Skipped | Time |',
  '| :-: | --- | --: | --: | --: | --: | --: |',
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
