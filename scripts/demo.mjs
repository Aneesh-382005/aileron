// Records the demo video against the live site: a signed-in host creates a venue and hosts from it,
// scripted pilots plus one phone (simulated tilt) fly a game, and the score lands on the venue board.
//   node scripts/demo.mjs            record + edit  ->  demo/aileron-demo.mp4
//   node scripts/demo.mjs --edit     re-edit the last recording
import { chromium } from '@playwright/test'
import { chromiumLaunchOptions, ensureStorageState, loadAllTestAccounts } from 'deepspace/testing'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'

const BASE = process.env.AILERON_URL || 'https://aileron.app.space'
const OUT = 'demo', RAW = `${OUT}/raw`, SLUG = 'demo-night'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const clamp = (v) => Math.max(-1, Math.min(1, v))
const launch = () => chromium.launch({ ...chromiumLaunchOptions(), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })

// A visible cursor, since recorded video has none.
const CURSOR = `addEventListener('DOMContentLoaded', () => {
  const c = document.createElement('div')
  c.style.cssText = 'position:fixed;z-index:99999;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;border:3px solid #fff;background:#ffb02088;pointer-events:none;transition:transform .1s;left:-50px;top:-50px'
  document.body.append(c)
  addEventListener('mousemove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px' }, true)
  addEventListener('mousedown', () => { c.style.transform = 'scale(.7)' }, true)
  addEventListener('mouseup', () => { c.style.transform = '' }, true)
})`

// The phone page gets a steady tilt: level until window.__fly, then a slow weave.
const TILT = `setInterval(() => {
  const t = performance.now() / 1000, fly = window.__fly
  dispatchEvent(Object.assign(new Event('deviceorientation'), { alpha: 0, beta: 90 + (fly ? 7 * Math.sin(t / 1.7) : 0), gamma: fly ? 20 * Math.sin(t / 1.2) : 0 }))
}, 50)`

async function record() {
  rmSync(OUT, { recursive: true, force: true }); mkdirSync(RAW, { recursive: true })
  const browser = await launch()
  const account = loadAllTestAccounts().find((a) => a.email.startsWith('pilot-a')) ?? loadAllTestAccounts()[0]
  const storageState = await ensureStorageState(browser, account, BASE)

  const prep = await (await browser.newContext({ storageState })).newPage()       // off camera: start from no venues
  await prep.goto(`${BASE}/me`); await prep.getByRole('heading', { name: 'Your venues' }).waitFor(); await prep.waitForTimeout(1500)
  for (let n = await prep.getByTestId('venue-row').count(); n > 0; n--) {
    await prep.getByRole('button', { name: 'Delete' }).first().click()
    await prep.getByRole('button', { name: 'Delete', exact: true }).last().click()
    await prep.waitForTimeout(800)
  }
  await prep.context().close()

  const host = await (await browser.newContext({ storageState, viewport: { width: 1280, height: 720 }, recordVideo: { dir: RAW, size: { width: 1280, height: 720 } } })).newPage()
  const t0 = Date.now(), marks = {}, mark = (k) => { marks[k] = (Date.now() - t0) / 1000; console.log(k, marks[k]) }
  await host.addInitScript(CURSOR)
  const click = async (loc) => {
    const b = await loc.boundingBox()
    await host.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 25 }); await host.waitForTimeout(250)
    await host.mouse.down(); await host.mouse.up()
  }

  await host.goto(BASE); await host.waitForTimeout(800); mark('landing')
  await host.mouse.move(640, 360); await host.waitForTimeout(3500)
  await host.mouse.move(900, 400, { steps: 30 }); await host.waitForTimeout(1500)

  await host.goto(`${BASE}/me`); await host.getByLabel('Name').waitFor(); await host.waitForTimeout(600); mark('me')
  await click(host.getByLabel('Name')); await host.getByLabel('Name').pressSequentially('Demo Night', { delay: 70 })
  await click(host.getByLabel('Address')); await host.getByLabel('Address').pressSequentially(SLUG, { delay: 70 })
  await click(host.getByRole('button', { name: 'Create venue' }))
  await host.getByTestId('venue-row').waitFor(); await host.waitForTimeout(1500)
  await click(host.getByRole('link', { name: 'Demo Night' })); await host.getByRole('link', { name: 'Host a game here' }).waitFor(); mark('venue')
  await host.waitForTimeout(1800)
  await click(host.getByRole('link', { name: 'Host a game here' }))
  await host.locator('#code').waitFor(); await host.waitForTimeout(1500); mark('lobby')
  const code = (await host.locator('#code').textContent()).trim()

  // Watch the game like a second screen so the scripted pilots can see it.
  const ws = (path) => new WebSocket(`${BASE.replace(/^http/, 'ws')}/ws/game/${code}${path}`)
  let snap = null
  const watcher = ws(''); watcher.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === 'snap') snap = m }
  await new Promise((r) => { watcher.onopen = r }); watcher.send('{"t":"watch"}')

  const bots = []
  const join = async (name) => {
    const s = ws(''), bot = { name, s, id: 0 }
    s.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === 'joined') bot.id = m.id }
    await new Promise((r) => { s.onopen = r }); s.send(JSON.stringify({ t: 'join', name, token: `demo-${name}-${t0}` }))
    bots.push(bot); await sleep(1100)
  }
  for (const name of ['Priya', 'Sam', 'Leo', 'Ana']) await join(name)

  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, recordVideo: { dir: `${RAW}/phone`, size: { width: 390, height: 844 } } })
  await phoneCtx.grantPermissions(['accelerometer', 'gyroscope', 'magnetometer'], { origin: BASE })   // Chromium asks like iOS does
  const phone = await phoneCtx.newPage()
  marks.phoneStart = (Date.now() - t0) / 1000
  await phone.addInitScript(TILT)
  await phone.goto(`${BASE}/r/${code}`); await phone.waitForTimeout(900)
  await phone.locator('#name').pressSequentially('Maya', { delay: 90 }); await phone.waitForTimeout(300)
  await phone.locator('#go').tap(); await phone.locator('#fire').waitFor({ state: 'visible' })
  await join('Kai')
  await host.waitForTimeout(2500)
  await click(host.locator('#start')); mark('play')
  await phone.evaluate(() => { window.__fly = true; document.getElementById('fire').dispatchEvent(new PointerEvent('pointerdown')) })

  let crash = false
  const pilot = setInterval(() => {
    if (!snap) return
    const ships = new Map(snap.sh.map((r) => [r[0], r]))
    for (const b of bots) {
      const me = ships.get(b.id)
      if (!me) continue
      const leader = [...ships.values()].filter((r) => r[1] === me[1] && r[8]).sort((x, y) => x[0] - y[0])[0]
      const enemies = snap.en.filter((e) => (crash ? e[3] > -70 : e[3] < -25)).sort((x, y) => y[3] - x[3])
      const target = crash ? enemies.sort((x, y) => Math.hypot(x[1] - me[2], x[2] - me[3]) - Math.hypot(y[1] - me[2], y[2] - me[3]))[0] : enemies[0]
      let [ax, ay] = [me[2], me[3]]
      if (!crash && leader && leader[0] !== b.id) [ax, ay] = [leader[2] + 5.5, leader[3]]          // wingmates hold formation: gold beam
      else if (target) [ax, ay] = [target[1], target[2]]
      b.s.send(JSON.stringify({ t: 'in', r: clamp((ax - me[2]) / 5), p: clamp((ay - me[3]) / 4) }))
      if (!b.firing) { b.firing = true; b.s.send('{"t":"fire","on":1}') }
    }
  }, 66)

  await host.waitForTimeout(26000); crash = true; mark('crash')
  for (let i = 0; i < 120 && snap?.s !== 'over'; i++) await sleep(500)
  mark('over')
  await host.waitForTimeout(8000)
  clearInterval(pilot)
  for (const b of bots) b.s.close()
  watcher.close()
  await phone.context().close()

  await host.goto(`${BASE}/v/${SLUG}`); await host.getByRole('heading', { name: 'Demo Night' }).waitFor(); await host.waitForTimeout(1000); mark('board')
  await host.mouse.move(640, 480, { steps: 30 }); await host.waitForTimeout(4500); mark('end')
  await host.context().close()
  await browser.close()

  renameSync(`${RAW}/${readdirSync(RAW).find((f) => f.endsWith('.webm'))}`, `${RAW}/host.webm`)
  renameSync(`${RAW}/phone/${readdirSync(`${RAW}/phone`)[0]}`, `${RAW}/phone.webm`)
  writeFileSync(`${RAW}/marks.json`, JSON.stringify(marks, null, 2))
}

// Title cards and captions are rendered as HTML so they use the app's fonts and colours.
async function cards(list) {
  const browser = await launch(), page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  const font = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=Space+Grotesk:wght@500;700&display=swap">'
  for (const [file, html, transparent] of list) {
    await page.setContent(`${font}<body style="margin:0;width:1280px;height:720px;${transparent ? 'background:transparent' : 'background:#0b1220'};color:#f2f6ff;font-family:Inter">${html}</body>`)
    await page.waitForTimeout(600)
    await page.screenshot({ path: file, omitBackground: !!transparent })
  }
  await browser.close()
}

async function edit() {
  const m = JSON.parse(readFileSync(`${RAW}/marks.json`, 'utf8'))
  const title = (big, small) => `<div style="height:100%;display:flex;flex-direction:column;justify-content:center;padding:0 110px">
    <div style="font:700 26px 'Space Grotesk';letter-spacing:.35em;color:#ffb020">AILERON</div>
    <div style="font:700 76px/1.05 'Space Grotesk';margin-top:18px;max-width:900px">${big}</div>
    <div style="font:400 26px Inter;color:#9aa7c2;margin-top:22px">${small}</div></div>`
  const caption = (text) => `<div style="position:absolute;left:40px;bottom:36px;padding:14px 22px;border-radius:14px;background:#0b1220e6;border:1px solid #243352;font:600 26px Inter">${text}</div>`
  const segs = [
    ['landing', m.landing, m.me - 0.3, 'A big screen for the sky. Phones for planes.'],
    ['me', m.me, m.venue, 'Sign in and claim a venue for your meetup'],
    ['venue', m.venue, m.lobby, 'Host a game from the venue page'],
    ['lobby', m.lobby, m.phoneStart, 'Scan the code. Pilots pair up as wingmates.'],
    ['join', m.phoneStart + 0.3, m.play, 'No app to install: type a name and fly'],
    ['play', m.play + 0.5, m.play + 15, 'Tilt to steer. Fly close to your wingmate to link up.'],
    ['play2', m.play + 15, m.crash, 'Every phone is a plane. Up to 24 per room.'],
    ['over', m.over - 1.5, m.over + 7, 'The score lands on the venue’s hall of fame'],
    ['board', m.board, m.end, 'Live leaderboards per venue, built on DeepSpace'],
  ]
  await cards([
    [`${RAW}/title.png`, title('Tilt your phone.<br>Fly together.', 'A co-op party game for meetups and classrooms')],
    [`${RAW}/end.png`, title('aileron.app.space', 'No app, no sign-up for players. Built on DeepSpace: realtime rooms, auth and records.')],
    ...segs.map(([k, , , text]) => [`${RAW}/cap-${k}.png`, caption(text), true]),
  ])

  const ff = (...args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' })
  const enc = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', '-crf', '20', '-preset', 'medium']
  const still = (png, out, secs) => ff('-loop', '1', '-t', String(secs), '-i', png, '-vf', `fade=in:0:12,fade=out:st=${secs - 0.4}:d=0.4`, ...enc, out)
  still(`${RAW}/title.png`, `${RAW}/s-title.mp4`, 3)
  still(`${RAW}/end.png`, `${RAW}/s-end.mp4`, 3.5)

  // The phone sits in a frame at the right while it is in the room.
  const phoneOn = (a, b) => a >= m.phoneStart - 0.5 && b <= m.over + 8
  for (const [k, a, b] of segs) {
    const dur = (b - a).toFixed(2)
    const inputs = ['-ss', a.toFixed(2), '-t', dur, '-i', `${RAW}/host.webm`, '-i', `${RAW}/cap-${k}.png`]
    let graph = '[0:v]fps=30,setpts=PTS-STARTPTS[v];[v][1:v]overlay=0:0[c]'
    if (phoneOn(a, b)) {
      inputs.push('-ss', Math.max(0, a - m.phoneStart).toFixed(2), '-t', dur, '-i', `${RAW}/phone.webm`)
      graph += ';[2:v]fps=30,setpts=PTS-STARTPTS,scale=230:-2,pad=iw+12:ih+12:6:6:color=0x243352[p];[c][p]overlay=W-w-36:(H-h)/2[c2]'
      ff(...inputs, '-filter_complex', graph, '-map', '[c2]', ...enc, `${RAW}/s-${k}.mp4`)
    } else ff(...inputs, '-filter_complex', graph, '-map', '[c]', ...enc, `${RAW}/s-${k}.mp4`)
  }
  const parts = ['title', ...segs.map(([k]) => k), 'end']
  writeFileSync(`${RAW}/list.txt`, parts.map((k) => `file 's-${k}.mp4'`).join('\n'))
  ff('-f', 'concat', '-safe', '0', '-i', `${RAW}/list.txt`, ...enc, '-movflags', '+faststart', `${OUT}/aileron-demo.mp4`)
  console.log(`${OUT}/aileron-demo.mp4`)
}

if (!process.argv.includes('--edit')) await record()
await edit()
