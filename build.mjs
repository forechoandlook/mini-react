import { build } from 'esbuild';
import { readFileSync } from 'fs';
import { gzipSync } from 'zlib';

const { version } = JSON.parse(readFileSync('./package.json', 'utf8'));

const entries = [
  { in: 'src/core.js', out: 'dist/mini-react.core' },
  { in: 'src/dom.js',  out: 'dist/mini-react.dom'  },
  { in: 'src/data.js', out: 'dist/mini-react.data' },
  { in: 'src/all.js',  out: 'dist/mini-react'      },
];

for (const { in: entry, out } of entries) {
  const name   = entry.replace('src/', '').replace('.js', '');
  const banner = `/* mini-react/${name} v${version} | https://github.com/forechoandlook/mini-react */`;

  await build({
    entryPoints: [entry],
    outfile: `${out}.js`,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    define: { __VERSION__: `"${version}"` },
    banner: { js: banner },
    legalComments: 'none',
  });

  await build({
    entryPoints: [entry],
    outfile: `${out}.min.js`,
    bundle: true,
    minify: true,
    format: 'esm',
    platform: 'browser',
    define: { __VERSION__: `"${version}"` },
    legalComments: 'none',
  });

  const raw     = readFileSync(`${out}.js`);
  const min     = readFileSync(`${out}.min.js`);
  const size    = (raw.length / 1024).toFixed(1);
  const sizeMin = (min.length / 1024).toFixed(1);
  const sizeGz  = (gzipSync(min, { level: 9 }).length / 1024).toFixed(1);
  console.log(`${name.padEnd(10)} v${version}  ${size}KB → ${sizeMin}KB (min) → ${sizeGz}KB (gz)`);
}

const cssBanner = `/* mini-react/css v${version} | https://github.com/forechoandlook/mini-react */`;
for (const [outfile, minify] of [['dist/mini-react.css', false], ['dist/mini-react.min.css', true]]) {
  await build({ entryPoints: ['src/mini-react.css'], outfile, minify, banner: { css: cssBanner } });
}
const css = readFileSync('dist/mini-react.css'), cssMin = readFileSync('dist/mini-react.min.css');
console.log(`css        v${version}  ${(css.length / 1024).toFixed(1)}KB → ${(cssMin.length / 1024).toFixed(1)}KB (min) → ${(gzipSync(cssMin, { level: 9 }).length / 1024).toFixed(1)}KB (gz)`);
