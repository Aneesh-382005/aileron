// Records a game on the live site in a hidden GPU browser, then cuts it into the demo video.
//   node scripts/demo.mjs <venue-slug>          record + edit  ->  demo/aileron-demo.mp4
//   node scripts/demo.mjs <venue-slug> --edit   re-edit the last recording
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'

const BASE = process.env.AILERON_URL || 'https://aileron.app.space'
const VENUE = process.argv[2], OUT = 'demo', RAW = `${OUT}/raw`, W = 1920, H = 1080
if (!VENUE || VENUE.startsWith('-')) throw new Error('usage: node scripts/demo.mjs <venue-slug> [--edit]')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const clamp = (v) => Math.max(-1, Math.min(1, v))
const TURN = [22, 0.55], CLIMB = [18, 0.8]                 // [degrees, seconds per radian] for the phone's wheel turn and pitch

// A visible cursor, since synthetic mouse moves don't move the real one.
const CURSOR = `addEventListener('DOMContentLoaded', () => {
  const c = document.createElement('div')
  c.style.cssText = 'position:fixed;z-index:99999;width:24px;height:24px;margin:-12px 0 0 -12px;border-radius:50%;border:3px solid #fff;background:#ffb02088;pointer-events:none;transition:transform .1s;left:-50px;top:-50px'
  document.body.append(c); window.__cursor = c
  addEventListener('mousemove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px' }, true)
  addEventListener('mousedown', () => { c.style.transform = 'scale(.7)' }, true)
  addEventListener('mouseup', () => { c.style.transform = '' }, true)
})`

// The phone is held sideways like a wheel: still until window.__fly, then it turns and climbs and dives on two rhythms.
const TILT = `localStorage.setItem('ail.land', '1')
setInterval(() => {
  const D = Math.PI / 180, s = window.__fly ? (performance.now() - window.__fly) / 1000 : 0
  const w = ${TURN[0]} * D * Math.sin(s / ${TURN[1]}), p = (${CLIMB[0]} * Math.sin(s / ${CLIMB[1]}) - 25) * D
  const sx = -Math.sin(w) * Math.cos(p), sy = Math.cos(w) * Math.cos(p)
  dispatchEvent(Object.assign(new Event('deviceorientation'), { alpha: 0, beta: Math.asin(-sx) / D, gamma: Math.atan2(-sy, Math.sin(p)) / D }))
}, 50)`

if (!process.argv.includes('--edit')) {
  rmSync(OUT, { recursive: true, force: true }); mkdirSync(RAW, { recursive: true })
  const gpu = await chromium.launch({ args: ['--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu'] })
  const hostCtx = await gpu.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: `${RAW}/host`, size: { width: W, height: H } } })
  const host = await hostCtx.newPage()
  const t0 = Date.now(), marks = {}, mark = (k) => { marks[k] = (Date.now() - t0) / 1000; console.log(k, marks[k]) }
  const click = async (loc) => {
    const b = await loc.boundingBox()
    await host.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 30 }); await host.waitForTimeout(250)
    await host.mouse.down(); await host.mouse.up()
  }

  await host.addInitScript(CURSOR)
  await host.goto(BASE); await host.waitForTimeout(800); mark('landing')
  await host.mouse.move(1000, 640, { steps: 20 }); await host.waitForTimeout(3500)
  await host.goto(`${BASE}/v/${VENUE}`); await host.getByRole('link', { name: 'Host a game here' }).waitFor(); await host.waitForTimeout(800); mark('venue')
  await host.waitForTimeout(2500)
  await click(host.getByRole('link', { name: 'Host a game here' }))
  await host.locator('#code').waitFor(); await host.waitForTimeout(1500); mark('lobby')
  const code = (await host.locator('#code').textContent()).trim()

  // Watch the game like a second screen so the scripted pilots can see it. Sockets retry instead of waiting forever.
  const ws = async (onmessage) => {
    for (let tries = 1; ; tries++) {
      const s = new WebSocket(`${BASE.replace(/^http/, 'ws')}/ws/game/${code}`)
      s.onmessage = onmessage
      const opened = await Promise.race([new Promise((r) => { s.onopen = () => r(true); s.onerror = s.onclose = () => r(false) }), sleep(8000).then(() => false)])
      if (opened) return s
      try { s.close() } catch { /* never opened */ }
      if (tries === 3) throw new Error(`could not connect to room ${code}`)
      console.log(`socket retry ${tries}`)
    }
  }
  let snap = null
  const watcher = await ws((e) => { const m = JSON.parse(e.data); if (m.t === 'snap') snap = m })
  watcher.send('{"t":"watch"}'); console.log('watching', code)
  const bots = []
  const join = async (name) => {
    const bot = { name, id: 0 }
    bot.s = await ws((e) => { const m = JSON.parse(e.data); if (m.t === 'joined') bot.id = m.id })
    bot.s.send(JSON.stringify({ t: 'join', name, token: `demo-${name}-${t0}` }))
    bots.push(bot); console.log('joined', name); await sleep(1100)
  }
  for (const name of ['Priya', 'Sam', 'Leo', 'Ana']) await join(name)

  const phoneCtx = await gpu.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, recordVideo: { dir: `${RAW}/phone`, size: { width: 844, height: 390 } } })
  await phoneCtx.grantPermissions(['accelerometer', 'gyroscope', 'magnetometer'], { origin: BASE })   // Chromium asks like iOS does
  const phone = await phoneCtx.newPage()
  marks.phoneStart = (Date.now() - t0) / 1000; console.log('phone', marks.phoneStart)
  await phone.addInitScript(TILT)
  await phone.goto(`${BASE}/r/${code}`); await phone.waitForTimeout(900)
  await phone.locator('#name').pressSequentially('Maya', { delay: 90 }); await phone.waitForTimeout(300)
  await phone.locator('#go').tap(); await phone.locator('#fire').waitFor({ state: 'visible' })
  await join('Kai')
  await host.waitForTimeout(2500)
  await click(host.locator('#start')); mark('play')
  await host.evaluate(() => window.__cursor.remove())
  const fly = await phone.evaluate(() => { window.__fly = performance.now(); document.getElementById('fire').dispatchEvent(new PointerEvent('pointerdown')); return performance.timeOrigin + window.__fly })
  marks.fly = (fly - t0) / 1000

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
      if (b.firing !== !crash) { b.firing = !crash; b.s.send(`{"t":"fire","on":${crash ? 0 : 1}}`) }   // stop shooting so the hull runs out
    }
  }, 66)

  await host.waitForTimeout(26000); crash = true; mark('crash')
  await phone.evaluate(() => document.getElementById('fire').dispatchEvent(new PointerEvent('pointerup')))
  for (let i = 0; i < 180 && snap?.s !== 'over'; i++) await sleep(500)
  mark('over')
  await host.waitForTimeout(8000)
  clearInterval(pilot)
  for (const b of bots) b.s.close()
  watcher.close()
  marks.phoneEnd = (Date.now() - t0) / 1000; await phoneCtx.close()

  await host.goto(`${BASE}/v/${VENUE}`); await host.getByRole('link', { name: 'Host a game here' }).waitFor(); await host.waitForTimeout(1000); mark('board')
  await host.mouse.move(1300, 900, { steps: 30 }); await host.waitForTimeout(4500); mark('end')
  await hostCtx.close(); await gpu.close()
  for (const k of ['host', 'phone']) renameSync(`${RAW}/${k}/${readdirSync(`${RAW}/${k}`)[0]}`, `${RAW}/${k}.webm`)
  writeFileSync(`${RAW}/marks.json`, JSON.stringify(marks, null, 2))
}

const m = JSON.parse(readFileSync(`${RAW}/marks.json`, 'utf8'))
// Playwright's videos start a moment after their pages do. The host's offset comes from its length; the phone's from
// matching the steering dot in its footage against the tilt it was fed, which pins it to the frame.
const length = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]))
const hostShift = Math.max(0, m.end - length(`${RAW}/host.webm`))
const steer = (t) => { const w = TURN[0] * Math.sin(Math.max(0, t - m.fly) / TURN[1]); return Math.sign(w) * Math.min(1, Math.max(0, (Math.abs(w) - 3) / 21)) ** 1.4 }
const dots = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(m.fly + 1 - m.phoneStart), '-t', '20', '-i', `${RAW}/phone.webm`,
  '-vf', 'fps=25,crop=354:300:0:70,scale=88:75', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 27 })
const dot = []
for (let f = 0; f < dots.length / (88 * 75 * 3); f++) {
  let sum = 0, n = 0
  for (let i = 0; i < 88 * 75; i++) {
    const o = (f * 88 * 75 + i) * 3
    if (dots[o] > 200 && dots[o + 1] > 170 && dots[o + 2] < 120) { sum += i % 88; n++ }
  }
  if (n > 4) dot.push([m.fly + 1 + f / 25, sum / n])
}
const corr = (d) => {
  const xs = dot.map(([, x]) => x), ys = dot.map(([t]) => steer(t + d)), mean = (a) => a.reduce((p, q) => p + q) / a.length
  const mx = mean(xs), my = mean(ys)
  return xs.reduce((p, x, i) => p + (x - mx) * (ys[i] - my), 0) / Math.sqrt(xs.reduce((p, x) => p + (x - mx) ** 2, 0) * ys.reduce((p, y) => p + (y - my) ** 2, 0))
}
const phoneShift = Array.from({ length: 151 }, (_, i) => -1.5 + i * 0.02).reduce((best, d) => (corr(d) > corr(best) ? d : best))
console.log(`phone footage offset ${phoneShift.toFixed(2)}s (match ${corr(phoneShift).toFixed(3)})`)
const title = (big, small) => `<div style="height:100%;display:flex;flex-direction:column;justify-content:center;padding:0 170px">
  <div style="font:700 38px 'Space Grotesk';letter-spacing:.35em;color:#ffb020">AILERON</div>
  <div style="font:700 116px/1.05 'Space Grotesk';margin-top:26px;max-width:1400px">${big}</div>
  <div style="font:400 40px Inter;color:#9aa7c2;margin-top:34px">${small}</div></div>`
const ff = (...args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' })
// The thumbnail is cut at a full right turn (phone, dot and Maya's plane all bank the same way), the one where the yellow pair flies furthest right.
const yellowAt = (t) => {
  const px = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t - hostShift), '-i', `${RAW}/host.webm`, '-frames:v', '1', '-vf', 'crop=1920:980:0:100,scale=192:98', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
  let [x, y, n] = [0, 0, 0]
  for (let i = 0; i < 192 * 98; i++) if (px[i * 3] > 200 && px[i * 3 + 1] > 170 && px[i * 3 + 2] < 120) { x += i % 192; y += Math.floor(i / 192); n++ }
  return { t, x: (x / n) * 10, y: (y / n) * 10 + 100, n }
}
const turns = Array.from({ length: 12 }, (_, k) => m.fly + TURN[1] * Math.PI * (2 * k + 0.5)).filter((t) => t > m.fly + 2 && t < m.crash - 1)
const best = turns.map(yellowAt).filter((c) => c.n > 30).reduce((a, b) => (b.x > a.x ? b : a))
ff('-ss', String(best.t - hostShift), '-i', `${RAW}/host.webm`, '-frames:v', '1', '-vf', 'crop=1920:980:0:100', `${RAW}/thumb-sky.png`)   // no score or room code
ff('-ss', String(best.t - m.phoneStart - phoneShift), '-i', `${RAW}/phone.webm`, '-frames:v', '1', `${RAW}/thumb-phone.png`)
// The sky may slide right into the left third: the dark gradient there hides the gap.
const zoom = 1.15, bx = Math.min(560, Math.max(W - W * zoom, 1350 - best.x * zoom)), by = Math.min(0, Math.max(H - 980 * zoom, 380 - (best.y - 100) * zoom))
const png = (f) => `data:image/png;base64,${readFileSync(f).toString('base64')}`
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
// Cards and captions are rendered as HTML so they use the app's fonts and colours.
const browser = await chromium.launch(), page = await browser.newPage({ viewport: { width: W, height: H } })
for (const [file, html, transparent] of [
  [`${RAW}/title.png`, title('Tilt your phone.<br>Fly together.', 'A co-op party game for meetups and classrooms')],
  [`${RAW}/end.png`, title('aileron.app.space', 'No app, no sign-up. Built on DeepSpace: realtime rooms, auth and records.')],
  [`${RAW}/go.png`, `<div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;background:repeating-linear-gradient(100deg,#0b1220 0 60px,#111a2e 60px 64px)">
    <div style="font:700 220px 'Space Grotesk';letter-spacing:.08em;color:#ffb020;text-shadow:0 0 60px #ffb02066">TAKEOFF</div>
    <div style="font:600 40px Inter;letter-spacing:.4em;color:#9aa7c2;margin-top:10px">WAVE 1 INCOMING</div></div>`],
  [`${OUT}/aileron-thumbnail.jpg`, `<div style="position:absolute;inset:0;background:url(${png(`${RAW}/thumb-sky.png`)}) ${bx}px ${by}px/${W * zoom}px auto no-repeat"></div>
    <div style="position:absolute;inset:0;background:linear-gradient(90deg,#0b1220 ${bx}px,#0b122000 ${bx + 280}px),linear-gradient(90deg,#0b1220f2 0%,#0b1220d0 34%,#0b122000 58%)"></div>
    <div style="position:absolute;left:96px;top:138px;width:960px">
      <div style="font:700 51px 'Space Grotesk';letter-spacing:.38em;color:#ffb020">AILERON</div>
      <div style="font:700 156px/0.98 'Space Grotesk';margin-top:33px;text-shadow:0 9px 45px #0008">Your phone is the joystick</div></div>
    <div style="position:absolute;right:110px;bottom:90px;perspective:2100px"><img src="${png(`${RAW}/thumb-phone.png`)}" style="display:block;width:600px;border:18px solid #05080f;outline:4px solid #ffb020;border-radius:39px;box-shadow:45px 60px 90px #000a;transform:rotateY(-22deg) rotateX(8deg) rotateZ(${TURN[0] * 0.5}deg)"></div>`],
  ...segs.map(([k, , , text]) => [`${RAW}/cap-${k}.png`, `<div style="position:absolute;left:60px;bottom:56px;padding:20px 32px;border-radius:20px;background:#0b1220e6;border:2px solid #243352;font:600 40px Inter">${text}</div>`, true]),
]) {
  await page.setContent(`<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=Space+Grotesk:wght@500;700&display=swap"><body style="margin:0;width:${W}px;height:${H}px;background:${transparent ? 'transparent' : '#0b1220'};color:#f2f6ff;font-family:Inter">${html}</body>`)
  await page.waitForTimeout(600)
  await page.screenshot({ path: file, ...(transparent && { omitBackground: true }), ...(file.endsWith('.jpg') && { quality: 90 }) })
}
await browser.close()

const enc = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '25', '-crf', '18', '-preset', 'slow']
// Stills get a camera move: a slow push-in for the title, a punch-in for TAKEOFF.
const still = (png, out, secs, zoom, fade) => ff('-loop', '1', '-framerate', '25', '-t', String(secs), '-i', png, '-vf',
  `scale=${W * 2}:${H * 2},zoompan=z='${zoom}':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=${W}x${H}:fps=25${fade}`, ...enc, out)
still(`${RAW}/title.png`, `${RAW}/s-title.mp4`, 3.2, '1+0.025*on/25', ',fade=in:0:15')
still(`${RAW}/go.png`, `${RAW}/s-go.mp4`, 1.2, 'max(1,1.35-0.03*on)', '')
still(`${RAW}/end.png`, `${RAW}/s-end.mp4`, 3.5, '1.04-0.01*on/25', `,fade=out:st=3:d=0.5`)

for (const [k, a, b] of segs) {
  const dur = (b - a).toFixed(2)
  const inputs = ['-i', `${RAW}/host.webm`, '-i', `${RAW}/cap-${k}.png`]
  let graph = `[0:v]trim=start=${Math.max(0, a - hostShift).toFixed(2)}:duration=${dur},fps=25,setpts=PTS-STARTPTS[v];[v][1:v]overlay=0:0[out]`
  if (a >= m.phoneStart - 0.5 && b <= m.over + 8) {
    // The phone floats in 3D at the right, turned toward the sky, and moves with the TURN and CLIMB that TILT feeds it:
    // wheel turn in ld(0), pitch in ld(1), a fixed yaw in ld(2), projected with a 1400 px focal length.
    const s = `(in/25+${(a - m.fly).toFixed(2)})`, on = `gte(${s},0)`
    const pre = `st(0,${on}*${TURN[0]}*PI/180*sin(${s}/${TURN[1]}));st(1,-0.2-${on}*${CLIMB[0]}*PI/180*sin(${s}/${CLIMB[1]}));st(2,-0.35)`
    const corner = (X, Y) => {
      const xy = `${pre};st(3,${X}*cos(ld(0))-(${Y})*sin(ld(0)));st(4,${X}*sin(ld(0))+(${Y})*cos(ld(0)));st(5,1400/(1400-ld(3)*sin(ld(2))+ld(4)*sin(ld(1))*cos(ld(2))))`
      return [`'${xy};450+(ld(3)*cos(ld(2))+ld(4)*sin(ld(1))*sin(ld(2)))*ld(5)'`, `'${xy};450+ld(4)*cos(ld(1))*ld(5)'`]
    }
    const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = [corner(-450, -450), corner(450, -450), corner(-450, 450), corner(450, 450)]
    inputs.push('-i', `${RAW}/phone.webm`)
    graph += `;[2:v]trim=start=${Math.max(0, a - m.phoneStart - phoneShift).toFixed(2)}:duration=${dur},fps=25,setpts=PTS-STARTPTS,scale=600:-2:flags=lanczos,`
      + `pad=iw+28:ih+28:14:14:color=0x05080f,pad=iw+4:ih+4:2:2:color=0x3a4a6b,format=rgba,pad=900:900:(ow-iw)/2:(oh-ih)/2:color=black@0,`
      + `perspective=x0=${x0}:y0=${y0}:x1=${x1}:y1=${y1}:x2=${x2}:y2=${y2}:x3=${x3}:y3=${y3}:sense=destination:eval=frame,split[p][s];`
      + `[s]colorchannelmixer=rr=0:gg=0:bb=0:aa=0.5,boxblur=20[sh];[out][sh]overlay=W-800:130[o];[o][p]overlay=W-830:90[pip]`
  }
  ff(...inputs, '-filter_complex', graph, '-map', graph.endsWith('[pip]') ? '[pip]' : '[out]', ...enc, `${RAW}/s-${k}.mp4`)
}
// Each clip blends into the next with a game-style transition; the two flying clips stay one shot.
const chain = [['title'], ['landing', 'pixelize'], ['venue', 'slideleft'], ['lobby', 'circleopen'], ['join', 'hlslice'], ['go', 'zoomin'],
  ['play', 'pixelize'], ['play2', 'fade'], ['over', 'radial'], ['board', 'slideleft'], ['end', 'fadeblack']]
let graph = '', last = '[0:v]', at = length(`${RAW}/s-title.mp4`)
chain.slice(1).forEach(([k, transition], i) => {
  const d = transition === 'fade' ? 0.04 : 0.5
  graph += `${last}[${i + 1}:v]xfade=transition=${transition}:duration=${d}:offset=${(at - d).toFixed(3)}[x${i}];`
  last = `[x${i}]`; at += length(`${RAW}/s-${k}.mp4`) - d
})
ff(...chain.flatMap(([k]) => ['-i', `${RAW}/s-${k}.mp4`]), '-filter_complex', graph.slice(0, -1), '-map', last, ...enc, '-movflags', '+faststart', `${OUT}/aileron-demo.mp4`)
console.log(`${OUT}/aileron-demo.mp4 and ${OUT}/aileron-thumbnail.jpg`)
