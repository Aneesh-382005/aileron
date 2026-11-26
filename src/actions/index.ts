import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import { MAX_VENUES_PER_USER, slugProblem } from '../game/constants'

export const actions: Record<string, ActionHandler<Env>> = {
  // create() with a known recordId upserts, so check first; immutable ownerId/createdAt refuse a racing duplicate.
  createVenue: async ({ userId, params, tools }) => {
    if (userId.startsWith('anon-')) return { success: false, error: 'Sign in to create a venue.' }
    const slug = String(params.slug ?? '').trim().toLowerCase()
    const title = String(params.title ?? '').trim().replace(/\s+/g, ' ').slice(0, 60)
    const problem = slugProblem(slug) ?? (title ? null : 'Give your venue a name.')
    if (problem) return { success: false, error: problem }
    const mine = await tools.query('venues', { where: { ownerId: userId }, limit: MAX_VENUES_PER_USER + 1 })
    if (!mine.success) return mine
    if (mine.data.count >= MAX_VENUES_PER_USER) return { success: false, error: `You can have up to ${MAX_VENUES_PER_USER} venues.` }
    const taken = await tools.get('venues', slug)
    if (taken.success) return { success: false, error: 'That address is taken. Try another.' }
    const made = await tools.create('venues', { slug, title, ownerId: userId, createdAt: new Date().toISOString() }, slug)
    if (!made.success) return { success: false, error: /duplicate/i.test(made.error) ? 'That address is taken. Try another.' : made.error }
    return { success: true, data: { slug } }
  },
}
