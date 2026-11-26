import type { CollectionSchema } from 'deepspace/schema'

const nobody = { read: true, create: false, update: false, delete: false } as const

// Venues are created only through the createVenue action (slug rules, 5-per-user cap); owners may rename or delete theirs.
export const venuesSchema: CollectionSchema = {
  name: 'venues',
  columns: [
    { name: 'slug', storage: 'text', interpretation: 'plain', required: true, immutable: true, maxLength: 32 },
    { name: 'title', storage: 'text', interpretation: 'plain', required: true, maxLength: 60 },
    { name: 'ownerId', storage: 'text', interpretation: 'plain', userBound: true, immutable: true },
    { name: 'createdAt', storage: 'text', interpretation: { kind: 'datetime' }, immutable: true },
  ],
  uniqueOn: ['slug'],
  ownerField: 'ownerId',
  permissions: {
    '*': nobody,
    viewer: nobody,
    member: { read: true, create: false, update: 'own', delete: 'own', writableFields: ['title'] },
    admin: { read: true, create: false, update: true, delete: true, writableFields: ['title'] },
  },
}

// Runs are written only by the GameRoom, as the app, when a game ends.
export const runsSchema: CollectionSchema = {
  name: 'runs',
  columns: [
    { name: 'venueSlug', storage: 'text', interpretation: 'plain' },
    { name: 'code', storage: 'text', interpretation: 'plain' },
    { name: 'teamScore', storage: 'number', interpretation: 'plain' },
    { name: 'wave', storage: 'number', interpretation: 'plain' },
    { name: 'playerCount', storage: 'number', interpretation: 'plain' },
    { name: 'pilots', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'endedAt', storage: 'text', interpretation: { kind: 'datetime' } },
  ],
  permissions: {
    '*': nobody,
    viewer: nobody,
    member: nobody,
    admin: { read: true, create: false, update: false, delete: true },
  },
}

export type Venue = { slug: string; title: string; ownerId: string; createdAt: string }
export type Run = { venueSlug: string; code: string; teamScore: number; wave: number; playerCount: number; pilots: { name: string; kills: number }[]; endedAt: string }
