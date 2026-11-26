// Clicks through every public link and the host -> phone -> mirror flow.  node scripts/linkcheck.mjs [baseUrl] [venue-slug]
import { chromium } from '@playwright/test'
const BASE = (process.argv[2] || 'http://localhost:5173').replace(/\/$/, ''), VENUE = process.argv[3]
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } })
await ctx.grantPermissions(['accelerometer', 'gyroscope', 'magnetometer'], { origin: BASE })
const problems = [], ok = []
const check = async (label, fn) => { try { await fn(); ok.push(label) } catch (e) { problems.push(`${label}: ${String(e.message).split('\n')[0]}`) } }
const open = async (url) => {
  const p = await ctx.newPage(), errs = []
  p.on('pageerror', (e) => errs.push(e.message))
  p.on('console', (m) => m.type() === 'error' && !/Permissions-Policy/.test(m.text()) && errs.push(m.text()))
  const res = await p.goto(BASE + url)
  p.errs = errs; p.status = res?.status()
  return p
}
const expectOk = (p, sel) => p.locator(sel).first().waitFor({ timeout: 10000 }).then(() => { if (p.status >= 400) throw new Error(`HTTP ${p.status}`); if (p.errs.length) throw new Error(p.errs.join(' | ')) })

const landing = await open('/')
await check('landing', () => expectOk(landing, 'h1'))
const hrefs = [...new Set(await landing.locator('a').evaluateAll((as) => as.map((a) => a.getAttribute('href'))))]
for (const h of hrefs) await check(`landing link ${h}`, async () => {
  if (/^https?:/.test(h)) { const r = await fetch(h, { method: 'HEAD' }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return }
  const p = await open(h)
  await expectOk(p, h.startsWith('/r') ? '#join' : h === '/host' ? '#card' : 'h1, [data-testid="app-navigation"]')
  await p.close()
})
await check('/r/abcd redirects to /r/ABCD', async () => { const p = await open('/r/abcd'); if (!p.url().endsWith('/r/ABCD')) throw new Error(p.url()); await p.close() })
await check('unknown page shows 404', async () => { const p = await open('/nope/page'); await p.getByText('404').waitFor(); await p.close() })
await check('bad venue host is 404', async () => { const p = await open('/v/Bad_Slug/host'); if (p.status !== 404) throw new Error(`HTTP ${p.status}`); await p.close() })

await check('host -> phone joins -> mirror sees it', async () => {
  const host = await open('/host'); await expectOk(host, '#code')
  const code = (await host.locator('#code').textContent()).trim()
  const qr = await host.locator('#card img').getAttribute('alt'); if (!qr) throw new Error('no QR')
  const phone = await open(`/r/${code}`); await phone.locator('#name').fill('Tester'); await phone.locator('#go').click()
  await phone.locator('#fire').waitFor({ state: 'visible', timeout: 10000 })
  await host.getByText('Tester').waitFor({ timeout: 10000 })
  const mirror = await open(`/r/${code}/watch`); await mirror.getByText('Mirror screen').waitFor({ timeout: 10000 }); await mirror.getByText('Tester').waitFor()
  await host.locator('#start').click(); await host.locator('#panel').waitFor({ state: 'hidden', timeout: 10000 })
  await mirror.locator('#panel').waitFor({ state: 'hidden', timeout: 10000 })
  for (const p of [host, phone, mirror]) if (p.errs.length) throw new Error(p.errs.join(' | '))
})

if (VENUE) await check(`venue ${VENUE}: page and /v/${VENUE}/host`, async () => {
  const v = await open(`/v/${VENUE}`); await expectOk(v, 'h1')
  const href = await v.getByRole('link', { name: 'Host a game here' }).getAttribute('href'); if (href !== `/v/${VENUE}/host`) throw new Error(href)
  await v.getByRole('link', { name: 'Host a game here' }).click(); await v.locator('#code').waitFor({ timeout: 10000 })
  const title = await v.locator('#card').textContent(); if (!title.includes(await (await open(`/v/${VENUE}`)).locator('h1').textContent())) throw new Error('venue name missing on host screen')
})

console.log(`ok (${ok.length}):\n  ${ok.join('\n  ')}`)
console.log(problems.length ? `PROBLEMS (${problems.length}):\n  ${problems.join('\n  ')}` : 'no problems')
await b.close()
process.exit(problems.length ? 1 : 0)
