/**
 * Smoke tests — verify the app boots and critical routes respond.
 *
 * These run against a live Next.js dev server (started automatically by
 * playwright.config.ts webServer). Keep them fast: no heavy user flows here.
 * Full user flows belong in e2e/flows/*.test.ts.
 */
import { test, expect } from '@playwright/test';

test('root redirects to login or renders app shell', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBeLessThan(500);
});

test('editor route is reachable', async ({ page }) => {
  const response = await page.goto('/editor');
  // Allow redirect to login (302) or page render (200) but not server errors
  expect(response?.status()).toBeLessThan(500);
});

test('camera route is reachable', async ({ page }) => {
  const response = await page.goto('/camera');
  expect(response?.status()).toBeLessThan(500);
});
