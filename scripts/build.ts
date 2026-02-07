import { build } from 'esbuild';
import { readFileSync, writeFileSync, chmodSync, mkdirSync, unlinkSync, existsSync } from 'fs';

async function buildSmriti() {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf-8'));
  const version = packageJson.version;

  // Ensure output directory exists
  mkdirSync('plugin/scripts', { recursive: true });

  console.log(`Building smriti v${version}...`);

  // Build worker-service.cjs (main entry point)
  await build({
    entryPoints: ['src/services/worker-service.ts'],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    outfile: 'plugin/scripts/worker-service.cjs',
    minify: true,
    logLevel: 'error',
    external: [
      'bun:sqlite',
      '@anthropic-ai/claude-code',
      'sqlite-vec',
      '@huggingface/transformers',
      'onnxruntime-node',
    ],
    define: {
      '__SMRITI_VERSION__': JSON.stringify(version),
    },
    banner: {
      js: '#!/usr/bin/env bun',
    },
  });

  // Make executable
  chmodSync('plugin/scripts/worker-service.cjs', 0o755);

  // Build UI dashboard (optional — doesn't fail the main build)
  try {
    if (existsSync('src/ui/index.tsx')) {
      console.log('Building UI dashboard...');

      await build({
        entryPoints: ['src/ui/index.tsx'],
        bundle: true,
        platform: 'browser',
        target: 'es2020',
        format: 'iife',
        outfile: 'plugin/scripts/viewer.js',
        minify: true,
        logLevel: 'error',
      });

      // Read the bundled JS and inline it into an HTML template
      const jsContent = readFileSync('plugin/scripts/viewer.js', 'utf-8');

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Smriti — Memory Dashboard</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0d1117; color: #c9d1d9; }
</style>
</head>
<body>
<div id="root"></div>
<script>${jsContent}</script>
</body>
</html>`;

      writeFileSync('plugin/scripts/viewer.html', html);

      // Remove intermediate JS file
      unlinkSync('plugin/scripts/viewer.js');

      console.log('Built UI dashboard -> plugin/scripts/viewer.html');
    } else {
      console.log('Skipping UI build (src/ui/index.tsx not found)');
    }
  } catch (err) {
    console.warn('UI build failed (non-fatal):', err);
  }

  // Generate plugin/package.json (zero runtime deps)
  writeFileSync('plugin/package.json', JSON.stringify({
    name: 'smriti-plugin',
    version,
    private: true,
    description: 'Runtime package for Smriti memory plugin',
    type: 'module',
    dependencies: {},
    engines: { bun: '>=1.0.0' },
  }, null, 2) + '\n');

  console.log(`Built smriti v${version} -> plugin/scripts/worker-service.cjs`);
}

buildSmriti().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
