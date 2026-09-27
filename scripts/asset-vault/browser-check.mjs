import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const value = (name) => {
  const joined = args.find((arg) => arg.startsWith(name + '='));
  if (joined) return joined.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

if (args.includes('--help')) {
  console.log(`Usage: node scripts/asset-vault/browser-check.mjs [options]

The Vite server must already be running. This script never starts a server.

  --url URL          Catalog URL (default: VAULT_URL or http://127.0.0.1:5176/asset-vault.html)
  --full             Validate all 4,000 assets, one family page at a time
  --thumbnails       Render one 512px PNG for each family, without the load sweep
  --families IDS     Limit --full or --thumbnails to comma-separated family IDs
  --screenshots      Save desktop and mobile catalog screenshots during the normal check
  --headed           Show Chrome while the check runs
  --timeout MS       Per-navigation/load timeout (default: 90000)
  --help             Show this help`);
  process.exit(0);
}

if (args.includes('--full') && args.includes('--thumbnails')) throw new Error('--full and --thumbnails are separate modes');
const mode = args.includes('--full') ? 'full' : args.includes('--thumbnails') ? 'thumbnails' : 'normal';
const hasFamilyFilter = args.some((arg) => arg === '--families' || arg.startsWith('--families='));
const familyFilterValue = value('--families');
if (hasFamilyFilter && mode === 'normal') throw new Error('--families requires --full or --thumbnails');
if (hasFamilyFilter && (!familyFilterValue || !familyFilterValue.trim() || familyFilterValue.startsWith('--'))) throw new Error('--families requires a non-empty comma-separated ID list');
const requestedFamilyIds = hasFamilyFilter ? familyFilterValue.split(',').map((id) => id.trim()) : null;
if (requestedFamilyIds?.some((id) => !id)) throw new Error('--families contains an empty family ID');
if (requestedFamilyIds && new Set(requestedFamilyIds).size !== requestedFamilyIds.length) throw new Error('--families contains a duplicate family ID');
const catalogUrl = new URL(value('--url') ?? process.env.VAULT_URL ?? 'http://127.0.0.1:5176/asset-vault.html');
const timeout = Number(value('--timeout') ?? 90_000);
if (!Number.isFinite(timeout) || timeout < 1_000) throw new Error('--timeout must be at least 1000 milliseconds');
const reportDir = path.join(repoRoot, 'shots', 'asset-vault');
const thumbnailDir = path.join(repoRoot, 'vault-public', 'asset-vault', 'thumbnails');
const reportPath = path.join(reportDir, mode === 'normal' ? 'check.json' : 'check-' + mode + '.json');

async function executable() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try { await fs.access(candidate); return candidate; } catch { /* Try the next installed browser. */ }
  }
  throw new Error('Chrome was not found. Set CHROME_PATH to a Chromium-compatible executable.');
}

const report = {
  schemaVersion: 1,
  mode,
  familyFilter: requestedFamilyIds,
  catalogUrl: catalogUrl.href,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  elapsedMs: 0,
  browser: null,
  manifest: null,
  checks: [],
  assetValidation: null,
  thumbnails: null,
  screenshots: [],
  browserErrors: [],
  failures: [],
};
const started = Date.now();
const check = (name, condition, details = undefined) => {
  report.checks.push({ name, ok: !!condition, ...(details === undefined ? {} : { details }) });
  if (!condition) report.failures.push({ phase: 'check', message: name, details });
};
const fail = (phase, error) => report.failures.push({ phase, message: error instanceof Error ? error.message : String(error) });

function watchPage(page, label) {
  page.on('console', (message) => {
    if (message.type() === 'error') report.browserErrors.push({ page: label, kind: 'console', message: message.text() });
  });
  page.on('pageerror', (error) => report.browserErrors.push({ page: label, kind: 'pageerror', message: error.message }));
  page.on('requestfailed', (request) => report.browserErrors.push({
    page: label, kind: 'requestfailed', url: request.url(), message: request.failure()?.errorText ?? 'request failed',
  }));
  page.on('response', (response) => {
    if (response.status() >= 400) report.browserErrors.push({
      page: label, kind: 'http', status: response.status(), url: response.url(),
    });
  });
}

async function afterTwoFrames(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function openCatalog(page, url, expectedAsset) {
  const response = await page.goto(url, { waitUntil: 'networkidle', timeout });
  if (!response?.ok()) throw new Error(`Catalog returned HTTP ${response?.status() ?? 'unknown'}: ${url}`);
  await page.waitForFunction(
    (id) => {
      const viewport = document.querySelector('#viewport');
      return viewport?.dataset.loaded && (!id || viewport.dataset.loaded === id);
    },
    expectedAsset ?? null,
    { timeout },
  );
  await afterTwoFrames(page);
}

async function readManifest() {
  const url = new URL('./asset-vault/manifest.json', catalogUrl);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Manifest returned HTTP ${response.status}: ${url}`);
  const manifest = await response.json();
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.families) || !Array.isArray(manifest.assets)) {
    throw new Error('Manifest shape is unsupported');
  }
  return manifest;
}

async function validateAssets(page, ids) {
  return page.evaluate(async ({ ids }) => {
    const [{ VaultLibrary }, THREE] = await Promise.all([
      import('/src/asset-vault/library.ts'),
      import('/@id/three'),
    ]);
    THREE.Cache.enabled = true;
    const vault = await VaultLibrary.open();
    const failures = [];
    const lodTotals = [0, 0, 0];
    let loaded = 0;
    for (const id of ids) {
      let handle;
      try {
        handle = await vault.load(id, 0);
        for (const level of [0, 1, 2]) {
          handle.setLOD(level);
          handle.root.updateMatrixWorld(true);
          if (handle.root.userData.assetId !== id || handle.root.userData.lod !== level) {
            throw new Error(`root metadata mismatch at LOD ${level}`);
          }
          let meshes = 0;
          let triangles = 0;
          handle.root.traverse((object) => {
            if (!(object instanceof THREE.Mesh)) return;
            meshes++;
            const geometry = object.geometry;
            for (const attributeName of ['position', 'normal', 'uv']) {
              const attribute = geometry.attributes[attributeName];
              if (!attribute) throw new Error(`${object.name || 'mesh'} missing ${attributeName}`);
              for (const number of attribute.array) if (!Number.isFinite(number)) {
                throw new Error(`${object.name || 'mesh'} has non-finite ${attributeName}`);
              }
            }
            for (const number of object.matrixWorld.elements) if (!Number.isFinite(number)) {
              throw new Error(`${object.name || 'mesh'} has a non-finite transform`);
            }
            triangles += (geometry.index?.count ?? geometry.attributes.position.count) / 3;
          });
          const expected = handle.asset.lods[level];
          if (meshes !== expected.drawCalls) throw new Error(`LOD ${level} has ${meshes} meshes; manifest says ${expected.drawCalls}`);
          if (Math.abs(triangles - expected.triangles) > 0.01) throw new Error(`LOD ${level} has ${triangles} triangles; manifest says ${expected.triangles}`);
          const bounds = new THREE.Box3().setFromObject(handle.root);
          const values = [...bounds.min.toArray(), ...bounds.max.toArray()];
          if (bounds.isEmpty() || values.some((number) => !Number.isFinite(number))) throw new Error(`LOD ${level} has invalid bounds`);
          lodTotals[level] += meshes;
        }
        handle.dispose();
        if (handle.root.children.length) throw new Error('dispose left scene children attached');
        let rejected = false;
        try { handle.setLOD(0); } catch { rejected = true; }
        if (!rejected) throw new Error('disposed handle still accepts setLOD');
        loaded++;
      } catch (error) {
        try { handle?.dispose(); } catch { /* Preserve the primary validation error. */ }
        failures.push({ id, message: error instanceof Error ? error.message : String(error) });
      }
    }
    THREE.Cache.clear();
    return { requested: ids.length, loaded, lodScenes: loaded * 3, lodMeshTotals: lodTotals, failures };
  }, { ids });
}

async function exerciseUi(page, manifest) {
  await openCatalog(page, catalogUrl.href);
  check('catalog marks the live asset as loaded', !!(await page.locator('#viewport').getAttribute('data-loaded')));
  check('catalog starts at LOD 0', (await page.locator('#viewport').getAttribute('data-lod')) === '0');
  check('initial result count is 4,000', (await page.locator('#count').textContent())?.trim() === '4,000 ASSETS');
  check('initial page contains 40 asset cards', await page.locator('#list .asset-card').count() === 40);
  check('initial pagination is 1 / 100', (await page.locator('#page-label').textContent())?.trim() === '1 / 100');
  check('family selector contains all 100 families', await page.locator('#family option').count() === 101);
  check('category controls exist', await page.locator('#categories button').count() === new Set(manifest.families.map((family) => family.category)).size + 1);

  const uniqueAsset = manifest.assets.at(-1);
  await page.locator('#search').fill(uniqueAsset.id);
  await page.waitForFunction(() => document.querySelector('#count')?.textContent?.trim() === '1 ASSETS');
  check('search narrows to an exact asset', await page.locator('#list .asset-card').count() === 1);
  await page.locator('#search').fill('');
  await page.waitForFunction(() => document.querySelector('#count')?.textContent?.trim() === '4,000 ASSETS');

  const category = manifest.families[0].category;
  const expectedCategory = manifest.families.filter((family) => family.category === category).reduce((sum, family) => sum + family.count, 0);
  await page.locator('#categories button', { hasText: new RegExp(`^${category}$`, 'i') }).click();
  await page.waitForFunction((text) => document.querySelector('#count')?.textContent?.trim() === text, `${expectedCategory.toLocaleString()} ASSETS`);
  check('category filter count matches the manifest', (await page.locator('#count').textContent())?.trim() === `${expectedCategory.toLocaleString()} ASSETS`);
  await page.locator('#categories button', { hasText: /^All$/ }).click();

  const family = manifest.families[Math.floor(manifest.families.length / 2)];
  await page.locator('#family').selectOption(family.id);
  await page.waitForFunction(() => document.querySelector('#count')?.textContent?.trim() === '40 ASSETS');
  check('family filter exposes 40 plans', await page.locator('#list .asset-card').count() === 40);
  await page.locator('#family').selectOption('');
  await page.locator('#next').click();
  check('pagination advances to page 2', (await page.locator('#page-label').textContent())?.trim() === '2 / 100');
  await page.locator('#previous').click();

  const beforeVariant = await page.locator('#viewport').getAttribute('data-loaded');
  const selectedIndex = await page.locator('#variants button').evaluateAll((buttons) => buttons.findIndex((button) => button.classList.contains('selected')));
  const targetIndex = selectedIndex === 0 ? 1 : 0;
  await page.locator('#variants button').nth(targetIndex).click();
  await page.waitForFunction((id) => document.querySelector('#viewport')?.dataset.loaded !== id, beforeVariant, { timeout });
  const afterVariant = await page.locator('#viewport').getAttribute('data-loaded');
  check('variant buttons load a different structural plan', !!afterVariant && afterVariant !== beforeVariant);
  check('details reflect the loaded asset ID', (await page.locator('#asset-id').textContent())?.trim() === afterVariant);

  for (const level of ['1', '2', '0']) {
    await page.locator('#lod').selectOption(level);
    await page.waitForFunction((lod) => document.querySelector('#viewport')?.dataset.lod === lod, level);
    check(`LOD ${level} updates the live viewport dataset`, (await page.locator('#viewport').getAttribute('data-lod')) === level);
  }
  await page.locator('#wire').click();
  check('wireframe control toggles on', (await page.locator('#wire').getAttribute('aria-pressed')) === 'true');
  await page.locator('#wire').click();
  check('wireframe control toggles off', (await page.locator('#wire').getAttribute('aria-pressed')) === 'false');
  await page.locator('#reset').click();

  if (args.includes('--screenshots')) {
    const desktop = path.join(reportDir, 'desktop.png');
    await page.screenshot({ path: desktop, fullPage: true, type: 'png' });
    report.screenshots.push(path.relative(repoRoot, desktop).replaceAll('\\', '/'));
    const mobile = await page.context().newPage();
    watchPage(mobile, 'mobile-screenshot');
    await mobile.setViewportSize({ width: 390, height: 844 });
    await openCatalog(mobile, catalogUrl.href);
    const mobilePath = path.join(reportDir, 'mobile.png');
    await mobile.screenshot({ path: mobilePath, fullPage: true, type: 'png' });
    report.screenshots.push(path.relative(repoRoot, mobilePath).replaceAll('\\', '/'));
    await mobile.close();
  }
}

async function normalCheck(context, manifest) {
  const page = await context.newPage();
  watchPage(page, 'catalog');
  await page.setViewportSize({ width: 1440, height: 1100 });
  await exerciseUi(page, manifest);
  const ids = manifest.families.map((family) => {
    const asset = manifest.assets.find((candidate) => candidate.family === family.id && candidate.variant === 0);
    if (!asset) throw new Error(`Family ${family.id} has no variant 0`);
    return asset.id;
  });
  const validation = await validateAssets(page, ids);
  report.assetValidation = { scope: 'family representatives', ...validation };
  check('100 family representatives loaded and disposed', validation.loaded === 100 && validation.failures.length === 0, validation.failures);
  await page.close();
}

async function fullCheck(context, manifest, families) {
  const expectedAssets = families.length * 40;
  const aggregate = { scope: requestedFamilyIds ? 'selected assets' : 'all assets', requested: expectedAssets, loaded: 0, lodScenes: 0, lodMeshTotals: [0, 0, 0], failures: [] };
  for (let index = 0; index < families.length; index++) {
    const family = families[index];
    const assets = manifest.assets.filter((asset) => asset.family === family.id).sort((a, b) => a.variant - b.variant);
    if (assets.length !== 40 || assets[0]?.variant !== 0) {
      aggregate.failures.push({ id: family.id, message: `expected variants 0–39, found ${assets.length} assets` });
      continue;
    }
    const page = await context.newPage();
    watchPage(page, `full:${family.id}`);
    try {
      const url = new URL(catalogUrl);
      url.searchParams.set('asset', assets[0].id);
      url.searchParams.set('capture', '1');
      await openCatalog(page, url.href, assets[0].id);
      const result = await validateAssets(page, assets.map((asset) => asset.id));
      aggregate.loaded += result.loaded;
      aggregate.lodScenes += result.lodScenes;
      result.lodMeshTotals.forEach((count, level) => { aggregate.lodMeshTotals[level] += count; });
      aggregate.failures.push(...result.failures);
    } catch (error) {
      aggregate.failures.push({ id: family.id, message: error instanceof Error ? error.message : String(error) });
    } finally {
      await page.close();
    }
    if ((index + 1) % 5 === 0 || index + 1 === families.length) {
      console.log(`Validated ${index + 1} / ${families.length} families (${aggregate.loaded.toLocaleString()} assets)`);
    }
  }
  report.assetValidation = aggregate;
  const label = requestedFamilyIds
    ? `all ${expectedAssets.toLocaleString()} selected assets loaded across all three LODs and disposed`
    : 'all 4,000 assets loaded across all three LODs and disposed';
  check(label, aggregate.loaded === expectedAssets && aggregate.failures.length === 0, aggregate.failures);
}

async function renderThumbnails(context, manifest, families) {
  await fs.mkdir(thumbnailDir, { recursive: true });
  const page = await context.newPage();
  watchPage(page, 'thumbnails');
  await page.setViewportSize({ width: 512, height: 512 });
  const failures = [];
  let rendered = 0;
  for (let index = 0; index < families.length; index++) {
    const family = families[index];
    const asset = manifest.assets.find((candidate) => candidate.family === family.id && candidate.variant === 0);
    if (!asset) { failures.push({ id: family.id, message: 'variant 0 not found' }); continue; }
    try {
      const url = new URL(catalogUrl);
      url.searchParams.set('asset', asset.id);
      url.searchParams.set('capture', '1');
      await openCatalog(page, url.href, asset.id);
      await page.screenshot({ path: path.join(thumbnailDir, family.id + '.png'), type: 'png' });
      rendered++;
    } catch (error) {
      failures.push({ id: family.id, message: error instanceof Error ? error.message : String(error) });
    }
    if ((index + 1) % 10 === 0 || index + 1 === families.length) console.log(`Rendered ${index + 1} / ${families.length} family thumbnails`);
  }
  await page.close();
  report.thumbnails = {
    directory: path.relative(repoRoot, thumbnailDir).replaceAll('\\', '/'),
    requested: families.length,
    rendered,
    failures,
  };
  const label = requestedFamilyIds
    ? `${families.length} selected family thumbnails rendered from variant 0`
    : '100 family thumbnails rendered from variant 0';
  check(label, rendered === families.length && failures.length === 0, failures);
}

let browser;
try {
  await fs.mkdir(reportDir, { recursive: true });
  const manifest = await readManifest();
  report.manifest = {
    schemaVersion: manifest.schemaVersion,
    families: manifest.families.length,
    assets: manifest.assets.length,
    sharedGeometryBytes: manifest.sharedGeometry?.bytes,
  };
  check('manifest contains 100 families', manifest.families.length === 100, manifest.families.length);
  check('manifest contains 4,000 assets', manifest.assets.length === 4_000, manifest.assets.length);
  check('every family has a variant 0', manifest.families.every((family) => manifest.assets.some((asset) => asset.family === family.id && asset.variant === 0)));
  const familyById = new Map(manifest.families.map((family) => [family.id, family]));
  const unknownFamilyIds = requestedFamilyIds?.filter((id) => !familyById.has(id)) ?? [];
  if (unknownFamilyIds.length) throw new Error(`Unknown family ID${unknownFamilyIds.length === 1 ? '' : 's'}: ${unknownFamilyIds.join(', ')}`);
  const selectedFamilies = requestedFamilyIds ? requestedFamilyIds.map((id) => familyById.get(id)) : manifest.families;
  report.selection = { families: selectedFamilies.map((family) => family.id), count: selectedFamilies.length };
  const executablePath = await executable();
  report.browser = { executablePath, headless: !args.includes('--headed') };
  browser = await chromium.launch({
    executablePath,
    headless: !args.includes('--headed'),
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox'],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
  context.setDefaultTimeout(timeout);
  context.setDefaultNavigationTimeout(timeout);
  if (mode === 'thumbnails') await renderThumbnails(context, manifest, selectedFamilies);
  else if (mode === 'full') await fullCheck(context, manifest, selectedFamilies);
  else await normalCheck(context, manifest);
  await context.close();
} catch (error) {
  fail('runner', error);
} finally {
  try { await browser?.close(); } catch (error) { fail('browser-close', error); }
  if (report.browserErrors.length) report.failures.push({ phase: 'browser', message: `${report.browserErrors.length} browser/console/HTTP errors`, details: report.browserErrors });
  report.finishedAt = new Date().toISOString();
  report.elapsedMs = Date.now() - started;
  await fs.mkdir(reportDir, { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
}

const summary = {
  mode,
  ok: report.failures.length === 0,
  families: report.manifest?.families,
  selectedFamilies: report.selection?.count,
  assets: report.assetValidation?.loaded,
  thumbnails: report.thumbnails?.rendered,
  browserErrors: report.browserErrors.length,
  elapsedSeconds: +(report.elapsedMs / 1000).toFixed(1),
  report: path.relative(repoRoot, reportPath).replaceAll('\\', '/'),
};
console.log(JSON.stringify(summary, null, 2));
if (report.failures.length) process.exitCode = 1;
