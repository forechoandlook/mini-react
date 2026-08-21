import { build } from 'esbuild';
import { readFileSync } from 'fs';
import { gzipSync } from 'zlib';

const { version } = JSON.parse(readFileSync('./package.json', 'utf8'));

const rewriteInternals = ext => ({
  name: 'rewrite-mini-react-internals',
  setup(api) {
    const map = {
      './core.js': `./mini-react.core${ext}`,
      './dom.js': `./mini-react.dom${ext}`,
      './query.js': `./mini-react.query${ext}`,
      './data.js': `./mini-react.data${ext}`,
      './components.js': `./mini-react.components${ext}`,
    };
    api.onResolve({ filter: /^\.\/(core|dom|query|data|components)\.js$/ }, args => {
      const path = map[args.path];
      return path ? { path, external: true } : null;
    });
  },
});

const entries = [
  { in: 'src/core.js',       out: 'dist/mini-react.core',       name: 'core' },
  { in: 'src/query.js',      out: 'dist/mini-react.query',      name: 'query' },
  { in: 'src/dom.js',        out: 'dist/mini-react.dom',        name: 'dom' },
  { in: 'src/data.js',       out: 'dist/mini-react.data',       name: 'data' },
  { in: 'src/components.js', out: 'dist/mini-react.components', name: 'components' },
  { in: 'src/all.js',        out: 'dist/mini-react',            name: 'all' },
];

async function buildOne({ in: entry, out, name }, minify) {
  const ext = minify ? '.min.js' : '.js';
  const banner = minify ? undefined : { js: `/* mini-react/${name} v${version} | https://github.com/forechoandlook/mini-react */` };
  await build({
    entryPoints: [entry],
    outfile: `${out}${minify ? '.min.js' : '.js'}`,
    bundle: true,
    minify,
    format: 'esm',
    platform: 'browser',
    define: { __VERSION__: `"${version}"` },
    banner,
    legalComments: 'none',
    plugins: [rewriteInternals(ext)],
  });
}

for (const entry of entries) {
  await buildOne(entry, false);
  await buildOne(entry, true);
  const raw     = readFileSync(`${entry.out}.js`);
  const min     = readFileSync(`${entry.out}.min.js`);
  const size    = (raw.length / 1024).toFixed(1);
  const sizeMin = (min.length / 1024).toFixed(1);
  const sizeGz  = (gzipSync(min, { level: 9 }).length / 1024).toFixed(1);
  console.log(`${entry.name.padEnd(12)} v${version}  ${size}KB → ${sizeMin}KB (min) → ${sizeGz}KB (gz)`);
}

const cssBanner = `/* mini-react/css v${version} | https://github.com/forechoandlook/mini-react */`;
for (const [outfile, minify] of [['dist/mini-react.css', false], ['dist/mini-react.min.css', true]]) {
  await build({ entryPoints: ['src/mini-react.css'], outfile, minify, banner: { css: cssBanner } });
}
const css = readFileSync('dist/mini-react.css'), cssMin = readFileSync('dist/mini-react.min.css');
console.log(`css          v${version}  ${(css.length / 1024).toFixed(1)}KB → ${(cssMin.length / 1024).toFixed(1)}KB (min) → ${(gzipSync(cssMin, { level: 9 }).length / 1024).toFixed(1)}KB (gz)`);
