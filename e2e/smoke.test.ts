/**
 * Smoke tests — verify the app boots and critical routes respond.
 *
 * These run against a live Next.js dev server (started automatically by
 * playwright.config.ts webServer). Keep them fast: no heavy user flows here.
 * Full user flows belong in e2e/flows/*.test.ts.
 */
import { test, expect } from '@playwright/test';

test('root renders app shell', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBeLessThan(500);
});

test('carousel route is reachable', async ({ page }) => {
  const response = await page.goto('/carousel');
  expect(response?.status()).toBeLessThan(500);
});

test('get-youtube-captions route is reachable', async ({ page }) => {
  const response = await page.goto('/get-youtube-captions');
  expect(response?.status()).toBeLessThan(500);
});

test('about route is reachable', async ({ page }) => {
  const response = await page.goto('/about');
  expect(response?.status()).toBeLessThan(500);
});

test('editor route is reachable', async ({ page }) => {
  const response = await page.goto('/editor');
  expect(response?.status()).toBeLessThan(500);
});

test('camera route is reachable', async ({ page }) => {
  const response = await page.goto('/camera');
  expect(response?.status()).toBeLessThan(500);
});
