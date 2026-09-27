import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright-core';

const DEFAULT_URL = 'http://127.0.0.1:5174/asset-library.html';
const DEFAULT_CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const pageUrl = process.argv.find((value, index) => index > 1 && !value.startsWith('-'))
  ?? process.env.ASSET_LIBRARY_URL
  ?? DEFAULT_URL;
const executablePath = process.env.CHROME_PATH ?? DEFAULT_CHROME;
const shotsDir = path.resolve(process.env.ASSET_LIBRARY_SHOTS ?? 'shots/asset-library');

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

async function waitForSelection(page, assetId, lod = '0') {
  await page.waitForFunction(
    ([id, level]) => {
      const viewport = document.querySelector('#viewport');
      const loading = document.querySelector('#loading');
      return viewport?.dataset.loaded === id
        && viewport?.dataset.lod === level
        && loading?.hidden === true;
    },
    [assetId, String(lod)],
    { timeout: 30_000 },
  );
}

async function selectById(page, id) {
  await page.getByRole('button', { name: 'All', exact: true }).click();
  const search = page.locator('#search');
  await search.fill(id);
  const cards = page.locator('.asset-card');
  await cards.first().waitFor({ state: 'visible' });
  check(await cards.count() === 1, `Expected a unique catalog match for ${id}`);
  await cards.first().click();
  await waitForSelection(page, id, await page.locator('#lod').inputValue());
}

async function main() {
  check(await exists(executablePath), `Chrome executable not found: ${executablePath}. Set CHROME_PATH to override it.`);
  await mkdir(shotsDir, { recursive: true });

  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--enable-webgl', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(30_000);

  const consoleErrors = [];
  const pageErrors = [];
  const failedResponses = [];
  const requestFailures = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
  });
  page.on('requestfailed', (request) => {
    requestFailures.push(`${request.failure()?.errorText ?? 'request failed'} ${request.url()}`);
  });

  const report = {
    url: pageUrl,
    generatedAt: new Date().toISOString(),
    viewport: { width: 1600, height: 1000, deviceScaleFactor: 1 },
    initialAsset: '',
    categoriesVisited: [],
    interactionChecks: [],
    exhaustiveLoad: null,
    screenshots: [],
  };

  try {
    const response = await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
    check(response?.ok(), `Catalog navigation failed: ${response?.status() ?? 'no response'} ${pageUrl}`);
    await page.waitForFunction(() => Boolean(document.querySelector('#viewport')?.dataset.loaded), null, { timeout: 30_000 });

    const manifest = await page.evaluate(async () => {
      const response = await fetch(new URL('./asset-library/manifest.json', document.baseURI));
      if (!response.ok) throw new Error(`Manifest returned HTTP ${response.status}`);
      return response.json();
    });
    check(Array.isArray(manifest.assets) && manifest.assets.length > 0, 'Manifest contains no assets');
    check(new Set(manifest.assets.map((asset) => asset.id)).size === manifest.assets.length, 'Manifest contains duplicate asset IDs');
    const categories = [...new Set(manifest.assets.map((asset) => asset.category))];
    check(categories.length > 0, 'Manifest contains no categories');

    report.initialAsset = await page.locator('#viewport').getAttribute('data-loaded');
    check(manifest.assets.some((asset) => asset.id === report.initialAsset), 'Initial preview did not load a manifest asset');
    check(await page.locator('#viewport').getAttribute('data-lod') === '0', 'Initial preview was not LOD 0');
    check(await page.locator('.asset-card').count() === manifest.assets.length, 'Initial card list does not match manifest size');
    check((await page.locator('#summary').innerText()).includes(String(manifest.assets.length)), 'Summary omits the manifest asset count');
    report.interactionChecks.push('initial asset and full list');

    const filteredCategory = categories.includes('services') ? 'services' : categories[0];
    const categoryAssets = manifest.assets.filter((asset) => asset.category === filteredCategory);
    await page.getByRole('button', { name: filteredCategory, exact: true }).click();
    check(await page.locator('.asset-card').count() === categoryAssets.length, `Category filter mismatch for ${filteredCategory}`);
    check((await page.locator('#count').innerText()) === `${categoryAssets.length} COMPONENTS`, 'Category count label is stale');

    const searchAsset = categoryAssets.find((asset) => asset.id === 'service-water-tower-elevated') ?? categoryAssets[0];
    const query = searchAsset.id;
    const expectedSearchCount = categoryAssets.filter((asset) =>
      `${asset.label} ${asset.description} ${asset.id}`.toLowerCase().includes(query.toLowerCase()),
    ).length;
    await page.locator('#search').fill(query);
    check(await page.locator('.asset-card').count() === expectedSearchCount, 'Search results do not match manifest filtering');
    check(expectedSearchCount === 1, `Expected ${query} to uniquely identify one asset`);
    await page.locator('.asset-card').click();
    await waitForSelection(page, searchAsset.id, '0');
    report.interactionChecks.push('category filter and search');

    await page.locator('#lod').selectOption('1');
    await waitForSelection(page, searchAsset.id, '1');
    check((await page.locator('#download').getAttribute('href'))?.includes('.lod1.gltf'), 'LOD 1 download link was not updated');
    await page.locator('#lod').selectOption('2');
    await waitForSelection(page, searchAsset.id, '2');
    check((await page.locator('#download').getAttribute('href'))?.includes('.lod2.gltf'), 'LOD 2 download link was not updated');
    report.interactionChecks.push('LOD 1 and LOD 2 preview loads');

    const wire = page.locator('#wire');
    check(await wire.getAttribute('aria-pressed') === 'false', 'Wireframe should begin disabled');
    await wire.click();
    check(await wire.getAttribute('aria-pressed') === 'true', 'Wireframe did not enable');
    await wire.click();
    check(await wire.getAttribute('aria-pressed') === 'false', 'Wireframe did not disable');
    const canvasBox = await page.locator('#viewport canvas').boundingBox();
    check(canvasBox, '3D preview canvas has no visible bounds');
    await page.mouse.move(canvasBox.x + canvasBox.width * 0.55, canvasBox.y + canvasBox.height * 0.55);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x + canvasBox.width * 0.68, canvasBox.y + canvasBox.height * 0.45, { steps: 5 });
    await page.mouse.up();
    await page.locator('#reset').click();
    check(await page.locator('#viewport').getAttribute('data-loaded') === searchAsset.id, 'Reset changed the selected asset');
    report.interactionChecks.push('wireframe toggle and camera reset');

    await page.locator('#search').fill('');
    for (const category of categories) {
      await page.getByRole('button', { name: category, exact: true }).click();
      const first = manifest.assets.find((asset) => asset.category === category);
      check(first, `No representative asset found for ${category}`);
      const firstCard = page.locator('.asset-card').first();
      await firstCard.waitFor({ state: 'visible' });
      await firstCard.click();
      await waitForSelection(page, first.id, '2');
      report.categoriesVisited.push({ category, asset: first.id });
    }
    report.interactionChecks.push(`representative live preview in ${categories.length} categories`);

    report.exhaustiveLoad = await page.evaluate(async () => {
      const [{ CivicLibrary, disposeAsset }, THREE] = await Promise.all([
        import('/src/asset-library/library.ts'),
        import('/@id/three'),
      ]);
      const library = await CivicLibrary.open();
      const failures = [];
      let variants = 0;
      let meshes = 0;
      for (const asset of library.manifest.assets) {
        for (const lod of [0, 1, 2]) {
          let root;
          try {
            root = await library.load(asset.id, lod);
            root.updateMatrixWorld(true);
            const box = new THREE.Box3().setFromObject(root);
            const values = [...box.min.toArray(), ...box.max.toArray()];
            if (box.isEmpty() || values.some((value) => !Number.isFinite(value))) {
              throw new Error(`invalid bounds ${values.join(', ')}`);
            }
            root.traverse((object) => {
              if (!object.isMesh) return;
              meshes += 1;
              const position = object.geometry?.attributes?.position;
              if (!position || position.count === 0) throw new Error(`mesh ${object.name || '(unnamed)'} has no positions`);
              if (!Array.from(position.array).every(Number.isFinite)) throw new Error(`mesh ${object.name || '(unnamed)'} has non-finite positions`);
            });
            variants += 1;
          } catch (error) {
            failures.push(`${asset.id} LOD ${lod}: ${error instanceof Error ? error.message : String(error)}`);
          } finally {
            if (root) disposeAsset(root);
          }
        }
      }
      return { assets: library.manifest.assets.length, variants, meshes, failures };
    });
    check(report.exhaustiveLoad.assets === manifest.assets.length, 'CivicLibrary manifest changed during the run');
    check(report.exhaustiveLoad.variants === manifest.assets.length * 3, `Loaded ${report.exhaustiveLoad.variants} of ${manifest.assets.length * 3} variants`);
    check(report.exhaustiveLoad.failures.length === 0, `Exhaustive GLTF load failures:\n${report.exhaustiveLoad.failures.join('\n')}`);
    report.interactionChecks.push(`all ${report.exhaustiveLoad.variants} glTF variants have finite bounds`);

    const screenshotTargets = [
      ['selected-storefront.png', manifest.assets.find((asset) => asset.category === 'storefronts')?.id],
      ['selected-water-tower.png', manifest.assets.find((asset) => asset.id === 'service-water-tower-elevated')?.id],
      ['selected-tree.png', manifest.assets.find((asset) => asset.id === 'tree-maple-street')?.id ?? manifest.assets.find((asset) => asset.category === 'vegetation')?.id],
      ['selected-roof.png', manifest.assets.find((asset) => asset.category === 'roofs')?.id],
    ];
    await page.locator('#lod').selectOption('0');
    for (const [filename, id] of screenshotTargets) {
      check(id, `No asset available for screenshot ${filename}`);
      await selectById(page, id);
      await page.waitForTimeout(200);
      const output = path.join(shotsDir, filename);
      await page.screenshot({ path: output, animations: 'disabled' });
      report.screenshots.push({ file: filename, asset: id });
    }
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await page.locator('#search').fill('');
    const listOutput = path.join(shotsDir, 'asset-list.png');
    await page.locator('aside').screenshot({ path: listOutput, animations: 'disabled' });
    report.screenshots.push({ file: 'asset-list.png', asset: null });

    await page.waitForTimeout(250);
    check(consoleErrors.length === 0, `Console errors:\n${consoleErrors.join('\n')}`);
    check(pageErrors.length === 0, `Page errors:\n${pageErrors.join('\n')}`);
    check(failedResponses.length === 0, `HTTP failures:\n${failedResponses.join('\n')}`);
    check(requestFailures.length === 0, `Request failures:\n${requestFailures.join('\n')}`);

    report.diagnostics = { consoleErrors, pageErrors, failedResponses, requestFailures };
    await writeFile(path.join(shotsDir, 'screenshots.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`PASS ${manifest.assets.length} assets / ${report.exhaustiveLoad.variants} glTF variants / ${categories.length} categories`);
    console.log(`Screenshots: ${shotsDir}`);
  } catch (error) {
    report.diagnostics = { consoleErrors, pageErrors, failedResponses, requestFailures };
    report.failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
    await writeFile(path.join(shotsDir, 'screenshots.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    throw error;
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
