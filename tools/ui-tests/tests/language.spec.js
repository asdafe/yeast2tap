import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server/server.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');

const LANGUAGES = [
  { lang: 'english', expectLang: 'en' },
  { lang: 'chinese', expectLang: 'zh-tw' },
  { lang: 'spanish', expectLang: 'es' },
  { lang: 'portuguese-br', expectLang: 'pt-br' },
  { lang: 'slovak', expectLang: 'sk' },
  { lang: 'italian', expectLang: 'it' },
  { lang: 'norwegian', expectLang: 'nei' },
  { lang: 'turkish', expectLang: 'tr' },
];

for (const { lang, expectLang } of LANGUAGES) {
  const port = 4198 + LANGUAGES.findIndex((x) => x.lang === lang);

  test(`index.htm uses compiled language assets: ${lang}`, async ({ page }) => {
    const { url, close } = await startServer({ repoRoot, port, language: lang });
    try {
      const response = await page.goto(url + '/index.htm', { waitUntil: 'load' });
      expect(response.status()).toBe(200);

      const checks = await page.evaluate(() => ({
        lang: document.documentElement.lang || '',
        bodyText: document.body.innerText.trim().length,
      }));
      expect(checks.lang).toBe(expectLang);
      expect(checks.bodyText).toBeGreaterThan(0);

      const theme = await (await page.request.get('/theme')).json();
      expect(theme.theme).toBe('');
    } finally {
      await close();
    }
  });
}

test('scale page is translated too', async ({ page }) => {
  const { url, close } = await startServer({ repoRoot, port: 4205, language: 'turkish' });
  try {
    const response = await page.goto(url + '/scale.htm', { waitUntil: 'load' });
    expect(response.status()).toBe(200);
    const checks = await page.evaluate(() => ({
      lang: document.documentElement.lang || '',
      text: document.body.innerText,
    }));
    expect(checks.lang).toBe('tr');
    // A page that silently fell back to English would fail these.
    expect(checks.text).toContain('Tartı');
    expect(checks.text).not.toContain('Zero empty platform');
  } finally {
    await close();
  }
});

test('turkish pages keep their layout and use turkish text', async ({ page }) => {
  const port = 4210;
  const { url, close } = await startServer({ repoRoot, port, language: 'turkish' });
  try {
    for (const page_ of ['index.htm', 'control.htm', 'setup.htm', 'logging.htm', 'config.htm', 'gravity.htm', 'pressure.htm', 'scale.htm']) {
      const response = await page.goto(url + '/' + page_, { waitUntil: 'load' });
      expect(response.status()).toBe(200);
      const checks = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        text: document.body.innerText.trim().length,
      }));
      // Turkish words are longer than their English originals; the layout must
      // still fit at the desktop viewport.
      expect(checks.overflow, `${page_} yatay taşma`).toBeLessThanOrEqual(2);
      expect(checks.text, `${page_} boş`).toBeGreaterThan(0);
    }
  } finally {
    await close();
  }
});

// The Independent heater used to be a time/slope learner. The page text was left
// behind in seven languages, so the Turkish UI described a controller that no
// longer exists. Every locale must describe the pulse PI instead.
test('the heater switch explains the pulse PI in every language', async ({ page }) => {
  const EXPECT = {
    english: ['duty cycle', 'Pulse (sensor steps)'],
    turkish: ['görev oranına', 'Darbe (sensör adımı)'],
    chinese: ['duty cycle'],
    spanish: ['duty cycle'],
    'portuguese-br': ['duty cycle'],
    slovak: ['duty cycle'],
    italian: ['duty cycle'],
    norwegian: ['duty cycle'],
  };
  const STALE = ['time and slope learner', 'zaman ve eğim öğrenici', 'Predictive heater', 'Öngörülü ısıtıcı'];
  let port = 4220;
  for (const [lang, needles] of Object.entries(EXPECT)) {
    const { url, close } = await startServer({ repoRoot, port: port++, language: lang });
    try {
      await page.goto(url + '/control.htm', { waitUntil: 'load' });
      // The heater switch lives in a collapsed <details>, which innerText skips.
      const text = await page.evaluate(() =>
        Array.from(document.querySelectorAll('details')).map((d) => d.textContent).join('\n')
      );
      expect(text.length).toBeGreaterThan(200);
      for (const needle of needles) expect(text, `${lang}: ${needle}`).toContain(needle);
      for (const stale of STALE) expect(text, `${lang} still shows: ${stale}`).not.toContain(stale);
    } finally {
      await close();
    }
  }
});
