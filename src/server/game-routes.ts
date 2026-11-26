// Static game pages (public/screen.html, public/pad.html) at product URLs, ahead of the SPA fallback.

import type { Context, Hono } from 'hono'
import type { AppContext } from '../../worker.js'
import { isRoomCode, isVenueSlug } from '../game/constants.js'
import { appTool } from './app-tool.js'

// The asset layer serves foo.html at /foo and redirects /foo.html there.
async function page(c: Context<AppContext>, name: 'screen' | 'pad'): Promise<Response> {
  const res = await c.env.ASSETS.fetch(new Request(new URL(`/${name}`, c.req.url), c.req.raw))
  const headers = new Headers(res.headers)
  headers.set('Cache-Control', 'no-cache')
  return new Response(res.body, { status: res.status, headers })
}

export function registerGameRoutes(app: Hono<AppContext>): void {
  app.get('/healthz', (c) => c.text('ok'))
  app.get('/host', (c) => page(c, 'screen'))
  app.get('/v/:slug/host', (c) => (isVenueSlug(c.req.param('slug')) ? page(c, 'screen') : c.notFound()))
  app.get('/r/:code/watch', (c) => page(c, 'screen'))
  app.get('/r/:code', (c) => {
    const raw = c.req.param('code'), code = raw.toUpperCase()
    if (raw !== code && isRoomCode(code)) {
      const url = new URL(c.req.url); url.pathname = `/r/${code}`
      return c.redirect(url.toString(), 302)
    }
    return page(c, 'watch' in c.req.queries() ? 'screen' : 'pad')
  })
  app.get('/r', (c) => page(c, 'pad'))

  // Hall of fame for the host screen's game-over card; React pages use useQuery.
  app.get('/api/venues/:slug/hall', async (c) => {
    const slug = c.req.param('slug')
    if (!isVenueSlug(slug)) return c.json({ error: 'not_found' }, 404)
    const [venue, runs] = await Promise.all([
      appTool(c.env, 'records.get', { collection: 'venues', recordId: slug }),
      appTool(c.env, 'records.query', { collection: 'runs', where: { venueSlug: slug }, orderBy: 'teamScore', orderDir: 'desc', limit: 200 }),
    ])
    if (!venue.success) return c.json({ error: 'not_found' }, 404)
    const weekAgo = Date.now() - 7 * 864e5
    const rows = (runs.data?.records ?? []).map((r: { data: object }) => r.data) as { endedAt: string }[]
    return c.json({
      title: venue.data.record.data.title,
      allTime: rows.slice(0, 5),
      week: rows.filter((r) => Date.parse(r.endedAt) >= weekAgo).slice(0, 5),
    }, 200, { 'Cache-Control': 'no-store' })
  })
}
