// Lets `node --test` run the app's plain-TypeScript modules (src/mesh/*) as the app
// imports them: extensionless relative imports and the `@/` alias. Node strips the
// types itself (Node 23+); this only fills in the paths. Used by `npm run test:mesh`.
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';

const SRC = new URL('../src/', import.meta.url);

registerHooks({
  resolve(specifier, context, next) {
    let spec = specifier;
    if (spec.startsWith('@/')) spec = new URL(spec.slice(2), SRC).href;
    if ((spec.startsWith('.') || spec.startsWith('file:')) && !/\.[cm]?[jt]sx?$/.test(spec)) {
      const base = new URL(spec, context.parentURL);
      for (const ext of ['.ts', '.tsx', '/index.ts']) {
        const candidate = new URL(base.href + ext);
        if (existsSync(fileURLToPath(candidate))) return next(pathToFileURL(fileURLToPath(candidate)).href, context);
      }
    }
    return next(spec, context);
  },
});
