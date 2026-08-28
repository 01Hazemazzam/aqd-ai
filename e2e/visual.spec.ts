import { test, expect } from '@playwright/test'

const SCREENS = ['/signup', '/login', '/reset']

for (const path of SCREENS) {
  for (const theme of ['light', 'dark'] as const) {
    for (const locale of ['en', 'ar'] as const) {
      test(`${path} renders in ${theme} ${locale}`, async ({ page, context }) => {
        await context.addCookies([
          { name: 'aqd_locale', value: locale, url: 'http://localhost:3000' },
        ])
        await page.emulateMedia({ colorScheme: theme })
        await page.goto(path)
        await expect(page).toHaveScreenshot(`${path.slice(1)}-${theme}-${locale}.png`, {
          fullPage: true,
          maxDiffPixelRatio: 0.01,
        })
      })
    }
  }
}
