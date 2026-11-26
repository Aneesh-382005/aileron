import { test, expect, loadAllTestAccounts } from 'deepspace/testing'

test.skip(loadAllTestAccounts().length < 2, 'Needs 2 test accounts: npx deepspace test accounts create --email <name>@deepspace.test --password-stdin')

type Page = Parameters<Parameters<typeof test>[2]>[0]['page']
const action = (page: Page, params: object) => page.evaluate(async (params) => {
  const { token } = await (await fetch('/api/auth/token', { method: 'POST', credentials: 'include' })).json()
  const res = await fetch('/api/actions/createVenue', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(params) })
  return res.json() as Promise<{ success: boolean; error?: string }>
}, params)

test('venues: create from /me, unique slugs, reserved names, five per user, public page', async ({ users }) => {
  const [a, b] = await users(2)
  await a.page.goto('/me')
  await expect(a.page.getByRole('heading', { name: 'Your venues' })).toBeVisible({ timeout: 15_000 })
  await a.page.waitForTimeout(1000)
  for (let n = await a.page.getByTestId('venue-row').count(); n > 0; n--) {
    await a.page.getByRole('button', { name: 'Delete' }).first().click()
    await a.page.getByRole('button', { name: 'Delete', exact: true }).last().click()
    await expect(a.page.getByTestId('venue-row')).toHaveCount(n - 1)
  }

  const slug = `e2e-${Date.now().toString(36)}`
  await a.page.getByLabel('Name').fill('E2E Meetup')
  await a.page.getByLabel('Address').fill(slug)
  await a.page.getByRole('button', { name: 'Create venue' }).click()
  await expect(a.page.getByTestId('venue-row')).toHaveCount(1)

  await b.page.goto('/me')
  expect(await action(b.page, { slug, title: 'Stolen' })).toMatchObject({ success: false, error: expect.stringMatching(/taken/) })
  expect(await action(b.page, { slug: 'api', title: 'x' })).toMatchObject({ success: false, error: expect.stringMatching(/reserved/) })
  expect(await action(b.page, { slug: 'Bad_Slug', title: 'x' })).toMatchObject({ success: false })

  for (let i = 1; i < 5; i++) expect(await action(a.page, { slug: `${slug}-${i}`, title: `Extra ${i}` })).toMatchObject({ success: true })
  expect(await action(a.page, { slug: `${slug}-6`, title: 'One too many' })).toMatchObject({ success: false, error: expect.stringMatching(/up to 5/) })

  await b.page.goto(`/v/${slug}`)
  await expect(b.page.getByRole('heading', { name: 'E2E Meetup' })).toBeVisible({ timeout: 15_000 })
  await expect(b.page.getByRole('link', { name: 'Host a game here' })).toHaveAttribute('href', `/host?venue=${slug}`)
})
