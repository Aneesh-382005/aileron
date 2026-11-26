/** Shared by the worker (GameRoom, actions) and the React pages. */

/** Room codes: 4 letters, no I or O so they read cleanly off a projector. */
export const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
export const isRoomCode = (s: string) => /^[A-HJ-NP-Z]{4}$/.test(s)

/** One colour per wing crew, shared by the screen and the phones. */
export const COLORS = [0xff6b6b, 0x4dd0e1, 0xffd93d, 0xb388ff, 0x69f0ae, 0xff9ff3, 0xffa94d, 0x74c0fc]

export const TICK_HZ = 30
/** Set from the load spike: see README "Capacity". */
export const MAX_PLAYERS = 24
export const PHONE_GRACE_MS = 20_000
export const SCREEN_GRACE_MS = 120_000

/** Venue slugs: lowercase a-z, 0-9 and hyphens, 3 to 32 characters, no leading/trailing/double hyphen. */
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9]|-(?!-)){1,30}[a-z0-9]$/
export const MAX_VENUES_PER_USER = 5

/** Paths a venue slug may never take, now or later. */
export const RESERVED_SLUGS = new Set([
  'r', 'v', 'me', 'api', 'ws', 'assets', 'internal', 'v1', '_deepspace', 'llms.txt', 'llms-full.txt', 'healthz',
  'host', 'play', 'join', 'watch', 'admin', 'settings', 'home', 'login', 'logout', 'signin', 'signout', 'auth',
  'vendor', 'static', 'public', 'new', 'create', 'edit', 'delete', 'about', 'help', 'docs', 'terms', 'privacy',
  'aileron', 'deepspace', 'well-known', 'sitemap', 'robots', 'favicon', 'null', 'undefined', 'test',
])

export function slugProblem(slug: string): string | null {
  if (slug.length < 3 || slug.length > 32) return 'Use 3 to 32 characters.'
  if (!SLUG_RE.test(slug)) return 'Use lowercase letters, numbers and single hyphens, starting and ending with a letter or number.'
  if (RESERVED_SLUGS.has(slug)) return 'That name is reserved. Try another.'
  return null
}

export const isVenueSlug = (s: string) => slugProblem(s) === null
