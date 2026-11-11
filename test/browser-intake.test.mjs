import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import puppeteer from 'puppeteer-core';
import { writeFixtures } from './synthetic-report.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.pdf': 'application/pdf',
  '.gz': 'application/gzip',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
};

function startServer() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const path = join(ROOT, relative);
    if (!path.startsWith(ROOT)) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      const body = readFileSync(path);
      res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('missing');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('a photo and a scanned PDF open on this device, then the letter argues the codes', { timeout: 180000 }, async () => {
  const fixtures = await writeFixtures(new URL('./fixtures/', import.meta.url).pathname);
  const server = await startServer();
  const port = server.address().port;
  const userDataDir = mkdtempSync(join(tmpdir(), 'pete-chrome-'));
  const browser = await puppeteer.launch({
    executablePath: '/usr/local/bin/google-chrome',
    headless: true,
    userDataDir,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(120000);
  const logs = [];
  page.on('console', (message) => logs.push(message.text()));
  page.on('pageerror', (error) => logs.push(String(error)));
  page.on('dialog', (dialog) => dialog.accept());
  try {
    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(globalThis.PeteShop && globalThis.PeteShop.bureauLetter));
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((node) => node.textContent.includes('Open practice file')));
    const label = await page.$eval('label.intake-file', (node) => node.textContent);
    assert.match(label, /PDF or photo/);

    await page.evaluate(() => {
      const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Open practice file');
      button.click();
    });
    await page.waitForFunction(() => document.body.innerText.includes('Northwind Card'));
    await page.evaluate(() => {
      const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Letters');
      button.click();
    });
    await page.evaluate(() => {
      const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Bureau letter');
      button.click();
    });
    await page.waitForFunction(() => document.body.innerText.includes('Why these codes cannot all be true'));
    const letterText = await page.evaluate(() => document.body.innerText);
    assert.match(letterText, /Why this letter/);
    assert.match(letterText, /Field 18/);
    assert.doesNotMatch(letterText, /not mine|isn't mine/i);
    await page.evaluate(() => {
      const button = [...document.querySelectorAll('button')].find((node) => node.textContent.includes('second letter'));
      button.click();
    });
    await page.waitForFunction(() => document.body.innerText.includes('Who you contacted'));
    const follow = await page.evaluate(() => document.body.innerText);
    assert.match(follow, /What you sent them/);
    assert.match(follow, /What they sent back/);
    assert.match(follow, /does not repeat that dispute/);

    await page.evaluate(() => {
      const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Intake');
      button.click();
    });
    const picker = await page.$('label.intake-file input[type=file]');
    assert.ok(picker, 'file picker is on the page');
    await picker.uploadFile(fixtures.pngPath);
    await page.waitForFunction(() => {
      const box = document.querySelector('textarea');
      return Boolean(box && /Northwind/.test(box.value) && /4412/.test(box.value));
    }, { timeout: 120000 });
    await page.waitForFunction(() => document.body.innerText.includes('Read 1 accounts'));

    await page.evaluate(() => {
      const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Discard');
      button.click();
    });
    await page.waitForFunction(() => !document.body.innerText.includes('Read 1 accounts'));
    const pickerAgain = await page.$('label.intake-file input[type=file]');
    await pickerAgain.uploadFile(fixtures.pdfPath);
    await page.waitForFunction(() => document.body.innerText.includes('Read 1 accounts'), { timeout: 120000 });
    const scanned = await page.$eval('textarea', (node) => node.value);
    assert.match(scanned, /Northwind/);
    assert.match(scanned, /4412/);
  } catch (error) {
    const shot = join(tmpdir(), 'pete-intake-failure.png');
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    const body = await page.evaluate(() => document.body?.innerText?.slice(0, 2000)).catch(() => '');
    console.error(logs.slice(-30).join('\n'));
    console.error(body);
    console.error('screenshot', shot);
    throw error;
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
