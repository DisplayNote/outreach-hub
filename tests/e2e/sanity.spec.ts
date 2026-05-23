import { test, expect } from '@playwright/test';

test('home redirects unauthenticated users to /login', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in with Microsoft' })).toBeVisible();
});
