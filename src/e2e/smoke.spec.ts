import { expect, test } from '@playwright/test'

test('serves the app and shows the empty status', async ({
  page,
}): Promise<void> => {
  await page.goto('/')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'www.wildshard.io',
  )
  await expect(page.getByRole('region', { name: 'Status' })).toContainText(
    'Nothing here yet.',
  )
  await expect(page.getByText(/^v\d+\.\d+\.\d+$/u)).toBeVisible()
})
