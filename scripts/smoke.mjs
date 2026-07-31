// Post-deploy smoke test — a fast, zero-dependency gate that runs right after
// `wrangler deploy` (see the `deploy` npm script). It asserts the stable Worker
// contracts against the live origin so a broken deploy (e.g. a PROXY_BASE
// regression, a missing /health, an assets-dir misconfig) fails LOUDLY instead
// of silently shipping. Independent of X/twimg being up.
//
// Usage:  node scripts/smoke.mjs [baseUrl]
//         BASE=https://xdownload.info node scripts/smoke.mjs
const BASE = (process.argv[2] || process.env.BASE || 'https://xdownload.info').replace(/\/+$/, '')

const checks = [
  { name: 'health endpoint', path: '/health', status: 200, includes: '"status":"ok"' },
  { name: 'app shell (Vue mount point)', path: '/', status: 200, includes: 'id="app"' },
  { name: 'proxy missing-url guard', path: '/proxy', status: 400, includes: 'missing ?url' },
  {
    name: 'proxy host allow-list',
    path: '/proxy?url=https://example.com/x.mp4',
    status: 403,
    includes: 'host not allowed',
  },
  { name: 'privacy page (ad-network compliance)', path: '/privacy.html', status: 200 },
  { name: 'ads.txt (authorized sellers)', path: '/ads.txt', status: 200 },
]

async function run() {
  const failures = []
  for (const c of checks) {
    const url = BASE + c.path
    try {
      // Follow redirects: Cloudflare canonicalises page URLs (e.g. /privacy.html
      // → /privacy, 307), so the final response is what a real user gets. The
      // /proxy and /health contracts don't redirect, so this is safe for them.
      const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20_000) })
      const body = await res.text()
      const ok = res.status === c.status
      if (!ok) {
        failures.push(`${c.name}: expected HTTP ${c.status}, got ${res.status}  (${url})`)
        continue
      }
      if (c.includes && !body.includes(c.includes)) {
        failures.push(`${c.name}: HTTP ${c.status} but body missing "${c.includes}"  (${url})`)
      }
    } catch (err) {
      failures.push(`${c.name}: request failed — ${err?.message || err}  (${url})`)
    }
  }

  if (failures.length) {
    console.error(`\n❌ Smoke test FAILED against ${BASE}:`)
    for (const f of failures) console.error('  • ' + f)
    process.exit(1)
  }
  console.log(`✅ Smoke test passed against ${BASE} (${checks.length} checks).`)
}

run()
