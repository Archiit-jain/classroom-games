// Bundles the server (and the workspace packages it imports as TypeScript source)
// into dist/index.js. The server's own npm dependencies stay external and are
// resolved from node_modules at runtime; everything else is bundled.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const external = Object.entries(pkg.dependencies ?? {})
  .filter(([, version]) => !String(version).startsWith('workspace:'))
  .map(([name]) => name);

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: true,
  external,
  banner: {
    // Lets bundled CommonJS dependencies use require() inside the ESM output.
    js: "import { createRequire as __cgCreateRequire } from 'node:module'; const require = __cgCreateRequire(import.meta.url);",
  },
  logLevel: 'info',
});
