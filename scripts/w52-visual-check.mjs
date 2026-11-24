// W52 live visual check — screenshot the running app (localhost:3000) at three
// corner-radius tiers. The hook writes `--ct-radius` from the sustainability
// score; at boot (neutral@5) it writes 0.125rem. We capture that, then inject
// 0rem (brutalist@0, sharp) + 0.25rem (floral@10, original Tailwind radii) to
// verify the radius shift's visual effect + the computed .rounded-lg value.
//
// Run after `next start -p 3000`:
//   node /home/z/my-project/capitalist-tree/scripts/w52-visual-check.mjs
import { chromium } from 'playwright';
import { mkdirSync, rmSync } from 'node:fs';

const OUT = '/tmp/render';
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });

// Wait for boot: the hook stamps data-aesthetic on <html> once the score is
// available (post-boot). Poll up to ~15s.
for (let i = 0; i < 60; i++) {
  const attr = await page.evaluate(() =>
    document.documentElement.getAttribute('data-aesthetic'),
  );
  if (attr != null) break;
  await page.waitForTimeout(250);
}

const readState = () =>
  page.evaluate(() => ({
    aesthetic: document.documentElement.getAttribute('data-aesthetic'),
    ctRadius: getComputedStyle(document.documentElement)
      .getPropertyValue('--ct-radius')
      .trim(),
    // Computed border-radius of the first .rounded-lg element (a panel/card).
    roundedLg: (() => {
      const el = document.querySelector('.rounded-lg');
      return el ? getComputedStyle(el).borderRadius : '(no .rounded-lg)';
    })(),
  }));

const boot = await readState();
console.log('boot:', JSON.stringify(boot));

// 1. neutral@5 (the boot state — hook wrote --ct-radius for score 5).
await page.screenshot({ path: `${OUT}/w52-neutral-5.jpg`, type: 'jpeg', quality: 70 });

// 2. brutalist@0 — inject --ct-radius: 0rem (what the hook writes at score 0).
await page.evaluate(() =>
  document.documentElement.style.setProperty('--ct-radius', '0rem'),
);
await page.waitForTimeout(200);
const brutalist = await readState();
console.log('brutalist:', JSON.stringify(brutalist));
await page.screenshot({ path: `${OUT}/w52-brutalist-0.jpg`, type: 'jpeg', quality: 70 });

// 3. floral@10 — inject --ct-radius: 0.25rem (what the hook writes at score 10).
await page.evaluate(() =>
  document.documentElement.style.setProperty('--ct-radius', '0.25rem'),
);
await page.waitForTimeout(200);
const floral = await readState();
console.log('floral:', JSON.stringify(floral));
await page.screenshot({ path: `${OUT}/w52-floral-10.jpg`, type: 'jpeg', quality: 70 });

await browser.close();
console.log('screenshots saved to', OUT);
