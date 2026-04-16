/**
 * Dry-run: test accessibility tree capture and element library building
 * without making any LLM calls. Run with: npx tsx scripts/test-discovery.ts
 */
import { BrowserController } from '../src/browser/controller';
import { buildElementLibrary } from '../src/elements/builder';
import { saveElementLibrary } from '../src/elements/cache';

const URL = 'https://www.monash.edu/';

async function main() {
  console.log('Dry-run: Discovery only (no LLM calls)\n');

  const browser = new BrowserController();
  await browser.launch({ headless: true });

  try {
    console.log(`Navigating to ${URL} ...`);
    await browser.navigate(URL);

    console.log('Capturing accessibility tree...');
    const rawNodes = await browser.captureAccessibilityTree();
    console.log(`  Raw nodes: ${rawNodes.length}`);

    console.log('Building element library...');
    const library = buildElementLibrary(rawNodes, URL);
    console.log(`  Elements in library: ${library.elements.length}`);
    console.log(`  Library hash: ${library.hash}`);

    const libPath = await saveElementLibrary(library);
    console.log(`  Saved to: ${libPath}`);

    console.log('\nSample elements:');
    library.elements.slice(0, 15).forEach((e, i) => {
      console.log(`  ${String(i + 1).padStart(2)}. [${e.role.padEnd(12)}] ${e.description}`);
      console.log(`      ${e.locator}`);
    });

    console.log('\n✓ Discovery dry-run complete');
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('✗ Error:', err.message);
  process.exit(1);
});
