import { build } from 'esbuild';
import { readFileSync } from 'fs';

const { version } = JSON.parse(readFileSync('./package.json', 'utf8'));

const entries = [
  { in: 'src/core.js', out: 'dist/mini-react.core' },
  { in: 'src/dom.js',  out: 'dist/mini-react.dom'  },
  { in: 'src/data.js', out: 'dist/mini-react.data' },
];

for (const { in: entry, out } of entries) {
  const name   = entry.replace('src/', '').replace('.js', '');
  const banner = `/* mini-react/${name} v${version} | https://github.com/forechoandlook/webui */`;

  await build({
    entryPoints: [entry],
    outfile: `${out}.js`,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    define: { __VERSION__: `"${version}"` },
    banner: { js: banner },
  });

  await build({
    entryPoints: [entry],
    outfile: `${out}.min.js`,
    bundle: true,
    minify: true,
    format: 'esm',
    platform: 'browser',
    define: { __VERSION__: `"${version}"` },
    banner: { js: banner },
  });

  const size    = (readFileSync(`${out}.js`).length / 1024).toFixed(1);
  const sizeMin = (readFileSync(`${out}.min.js`).length / 1024).toFixed(1);
  console.log(`${name.padEnd(10)} v${version}  ${size}KB → ${sizeMin}KB (min)`);
}
