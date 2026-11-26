export const THEMES = [{ id: 'dusk', label: 'Dusk', description: 'Navy sky with an amber wing link.' }] as const

export type ThemeId = (typeof THEMES)[number]['id']
