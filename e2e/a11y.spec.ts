import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const SCREENS = ['/signup', '/login', '/reset']

for (const path of SCREENS) {
  for (const theme of ['light', 'dark'] as const) {
    test(`${path} has no accessibility violations in ${theme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme })
      await page.goto(path)
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa'])
        .analyze()
      expect(results.violations).toEqual([])
    })
  }
}
