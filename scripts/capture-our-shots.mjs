#!/usr/bin/env node
/** 截我们应用的主要视图（Playwright Chromium；对比即梦观察用） */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE ?? 'http://127.0.0.1:3100';
const outDir = path.join(process.cwd(), '.tmp', 'our-shots');
mkdirSync(outDir, { recursive: true });

const views = [
  ['create', '#/create'],
  ['canvas', '#/canvas'],
  ['runs', '#/runs'],
  ['library', '#/library'],
  ['overview', '#/overview'],
  ['logs', '#/logs'],
  ['skills', '#/skills'],
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' }).catch(() => {});

for (const [name, hash] of views) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  console.log(`OK ${name}`);
}
await browser.close();
