import type { Env } from '../../worker.js'

// Calls the app's RecordRoom as the app (X-App-Action), never as a player.
export async function appTool<T = any>(env: Env, tool: string, params: object): Promise<{ success: boolean; data?: T; error?: string }> {
  const stub = env.RECORD_ROOMS.get(env.RECORD_ROOMS.idFromName(`app:${env.DEEPSPACE_APP_ID}`))
  const res = await stub.fetch(new Request('https://internal/api/tools/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': env.OWNER_USER_ID, 'X-App-Action': 'true' },
    body: JSON.stringify({ tool, params }),
  }))
  return res.json()
}
