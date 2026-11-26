// Records the demo video against the live site, from a venue's page: scripted pilots plus one phone
// (simulated tilt) fly a game and the score lands on the venue's board. The host screen runs fullscreen
// on this machine's GPU and is captured with ffmpeg at 60 fps, so it takes over the screen for ~2.5 min.
//   node scripts/demo.mjs <venue-slug>          record + edit  ->  demo/aileron-demo.mp4
//   node scripts/demo.mjs <venue-slug> --edit   re-edit the last recording
import { chromium } from '@playwright/test'
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'

const BASE = process.env.AILERON_URL || 'https://aileron.app.space'
const VENUE = process.argv[2], OUT = 'demo', RAW = `${OUT}/raw`, W = 1920, H = 1200
const DISPLAY = process.env.DISPLAY || ':1'
if (!VENUE || VENUE.startsWith('-')) throw new Error('usage: node scripts/demo.mjs <venue-slug> [--edit]')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const clamp = (v) => Math.max(-1, Math.min(1, v))

// A visible cursor, since synthetic mouse moves don't move the real one.
const CURSOR = `addEventListener('DOMContentLoaded', () => {
  const c = document.createElement('div')
  c.style.cssText = 'position:fixed;z-index:99999;width:24px;height:24px;margin:-12px 0 0 -12px;border-radius:50%;border:3px solid #fff;background:#ffb02088;pointer-events:none;transition:transform .1s;left:-50px;top:-50px'
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
  rmSync(OUT, { recursive: true, force: true }); mkdirSync(`${RAW}/phone`, { recursive: true })
  const screenSize = execFileSync('xdpyinfo', { env: { ...process.env, DISPLAY } }).toString().match(/dimensions:\s+(\d+x\d+)/)[1]
  const gpu = await chromium.launch({ headless: false, env: { ...process.env, DISPLAY }, args: ['--kiosk', '--force-device-scale-factor=1.5', '--ignore-gpu-blocklist'] })
  const host = await (await gpu.newContext({ viewport: null })).newPage()
  await host.addInitScript(CURSOR)
  await host.goto('about:blank'); await host.waitForTimeout(1500)

  const grab = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'x11grab', '-framerate', '60', '-video_size', screenSize, '-draw_mouse', '0', '-i', `${DISPLAY}.0+0,0`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '14', `${RAW}/host.mkv`], { stdio: ['pipe', 'inherit', 'inherit'] })
  const t0 = Date.now(), marks = {}, mark = (k) => { marks[k] = (Date.now() - t0) / 1000; console.log(k, marks[k]) }
  const click = async (loc) => {
    const b = await loc.boundingBox()
    await host.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 30 }); await host.waitForTimeout(250)
    await host.mouse.down(); await host.mouse.up()
  }

  await host.goto(BASE); await host.waitForTimeout(800); mark('landing')
  await host.mouse.move(700, 450, { steps: 20 }); await host.waitForTimeout(3500)
  await host.goto(`${BASE}/v/${VENUE}`); await host.getByRole('link', { name: 'Host a game here' }).waitFor(); await host.waitForTimeout(800); mark('venue')
  await host.waitForTimeout(2500)
  await click(host.getByRole('link', { name: 'Host a game here' }))
  await host.locator('#code').waitFor(); await host.waitForTimeout(1500); mark('lobby')
  const code = (await host.locator('#code').textContent()).trim()

  // Watch the game like a second screen so the scripted pilots can see it.
  const ws = () => new WebSocket(`${BASE.replace(/^http/, 'ws')}/ws/game/${code}`)
  let snap = null
  const watcher = ws(); watcher.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === 'snap') snap = m }
  await new Promise((r) => { watcher.onopen = r }); watcher.send('{"t":"watch"}')
  const bots = []
  const join = async (name) => {
    const s = ws(), bot = { name, s, id: 0 }
    s.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === 'joined') bot.id = m.id }
    await new Promise((r) => { s.onopen = r }); s.send(JSON.stringify({ t: 'join', name, token: `demo-${name}-${t0}` }))
    bots.push(bot); await sleep(1100)
  }
  for (const name of ['Priya', 'Sam', 'Leo', 'Ana']) await join(name)

  const headless = await chromium.launch()
  const phoneCtx = await headless.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, recordVideo: { dir: `${RAW}/phone`, size: { width: 780, height: 1688 } } })
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
      const near = (e) => Math.hypot(e[1] - me[2], e[2] - me[3])
      const target = crash ? snap.en.filter((e) => e[3] > -70).sort((x, y) => near(x) - near(y))[0] : snap.en.filter((e) => e[3] < -25).sort((x, y) => y[3] - x[3])[0]
      let [ax, ay] = [me[2], me[3]]
      if (!crash && leader && leader[0] !== b.id) [ax, ay] = [leader[2] + 5.5, leader[3]]          // wingmates hold formation: gold beam
      else if (target) [ax, ay] = [target[1], target[2]]
      b.s.send(JSON.stringify({ t: 'in', r: clamp((ax - me[2]) / 5), p: clamp((ay - me[3]) / 4) }))
      if (!b.firing) { b.firing = true; b.s.send('{"t":"fire","on":1}') }
    }
  }, 66)

  await host.waitForTimeout(26000); crash = true; mark('crash')
  for (let i = 0; i < 180 && snap?.s !== 'over'; i++) await sleep(500)
  mark('over')
  await host.waitForTimeout(8000)
  clearInterval(pilot)
  for (const b of bots) b.s.close()
  watcher.close()
  await phoneCtx.close(); await headless.close()

  await host.goto(`${BASE}/v/${VENUE}`); await host.getByRole('link', { name: 'Host a game here' }).waitFor(); await host.waitForTimeout(1000); mark('board')
  await host.mouse.move(900, 700, { steps: 30 }); await host.waitForTimeout(4500); mark('end')
  grab.stdin.write('q'); await new Promise((r) => grab.on('close', r))
  await gpu.close()

  renameSync(`${RAW}/phone/${readdirSync(`${RAW}/phone`)[0]}`, `${RAW}/phone.webm`)
  writeFileSync(`${RAW}/marks.json`, JSON.stringify(marks, null, 2))
}

// Title cards and captions are rendered as HTML so they use the app's fonts and colours.
async function cards(list) {
  const browser = await chromium.launch(), page = await browser.newPage({ viewport: { width: W, height: H } })
  const font = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=Space+Grotesk:wght@500;700&display=swap">'
  for (const [file, html, transparent] of list) {
    await page.setContent(`${font}<body style="margin:0;width:${W}px;height:${H}px;${transparent ? 'background:transparent' : 'background:#0b1220'};color:#f2f6ff;font-family:Inter">${html}</body>`)
    await page.waitForTimeout(600)
    await page.screenshot({ path: file, omitBackground: !!transparent })
  }
  await browser.close()
}

async function edit() {
  const m = JSON.parse(readFileSync(`${RAW}/marks.json`, 'utf8'))
  const title = (big, small) => `<div style="height:100%;display:flex;flex-direction:column;justify-content:center;padding:0 170px">
    <div style="font:700 38px 'Space Grotesk';letter-spacing:.35em;color:#ffb020">AILERON</div>
    <div style="font:700 116px/1.05 'Space Grotesk';margin-top:26px;max-width:1400px">${big}</div>
    <div style="font:400 40px Inter;color:#9aa7c2;margin-top:34px">${small}</div></div>`
  const caption = (text) => `<div style="position:absolute;left:60px;bottom:56px;padding:20px 32px;border-radius:20px;background:#0b1220e6;border:2px solid #243352;font:600 40px Inter">${text}</div>`
  const segs = [
    ['landing', m.landing, m.venue - 0.3, 'A big screen for the sky. Phones for planes.'],
    ['venue', m.venue, m.lobby - 0.2, 'Venues keep a hall of fame for your group'],
    ['lobby', m.lobby, m.phoneStart, 'Scan the code. Pilots pair up as wingmates.'],
    ['join', m.phoneStart + 0.3, m.play, 'No app to install: type a name and fly'],
    ['play', m.play + 0.5, m.play + 15, 'Tilt to steer. Fly close to your wingmate to link up.'],
    ['play2', m.play + 15, m.crash, 'Every phone is a plane. Up to 24 per room.'],
    ['over', m.over - 1.5, m.over + 7, 'The score lands on the venue’s hall of fame'],
    ['board', m.board, m.end, 'Live leaderboards per venue, built on DeepSpace'],
  ]
  await cards([
    [`${RAW}/title.png`, title('Tilt your phone.<br>Fly together.', 'A co-op party game for meetups and classrooms')],
    [`${RAW}/end.png`, title('aileron.app.space', 'No app, no sign-up. Built on DeepSpace: realtime rooms, auth and records.')],
    ...segs.map(([k, , , text]) => [`${RAW}/cap-${k}.png`, caption(text), true]),
  ])

  const ff = (...args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' })
  const enc = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '60', '-crf', '18', '-preset', 'slow']
  const still = (png, out, secs) => ff('-loop', '1', '-framerate', '60', '-t', String(secs), '-i', png, '-vf', `fade=in:0:20,fade=out:st=${secs - 0.4}:d=0.4`, ...enc, out)
  still(`${RAW}/title.png`, `${RAW}/s-title.mp4`, 3)
  still(`${RAW}/end.png`, `${RAW}/s-end.mp4`, 3.5)

  for (const [k, a, b] of segs) {
    const dur = (b - a).toFixed(2)
    const inputs = ['-ss', a.toFixed(2), '-t', dur, '-i', `${RAW}/host.mkv`, '-i', `${RAW}/cap-${k}.png`]
    let graph = `[0:v]scale=${W}:${H}:flags=lanczos,setpts=PTS-STARTPTS[v];[v][1:v]overlay=0:0[out]`
    if (a >= m.phoneStart - 0.5 && b <= m.over + 8) {                                 // the phone sits in a frame at the right
      inputs.push('-ss', Math.max(0, a - m.phoneStart).toFixed(2), '-t', dur, '-i', `${RAW}/phone.webm`)
      graph += ';[2:v]fps=60,setpts=PTS-STARTPTS,scale=-2:700:flags=lanczos,pad=iw+16:ih+16:8:8:color=0x243352[p];[out][p]overlay=W-w-56:(H-h)/2[pip]'
    }
    ff(...inputs, '-filter_complex', graph, '-map', graph.endsWith('[pip]') ? '[pip]' : '[out]', ...enc, `${RAW}/s-${k}.mp4`)
  }
  writeFileSync(`${RAW}/list.txt`, ['title', ...segs.map(([k]) => k), 'end'].map((k) => `file 's-${k}.mp4'`).join('\n'))
  ff('-f', 'concat', '-safe', '0', '-i', `${RAW}/list.txt`, '-c', 'copy', '-movflags', '+faststart', `${OUT}/aileron-demo.mp4`)
  console.log(`${OUT}/aileron-demo.mp4`)
}

if (!process.argv.includes('--edit')) await record()
await edit()
