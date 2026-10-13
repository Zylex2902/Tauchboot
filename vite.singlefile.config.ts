import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/** One self-contained HTML file (no service worker) for hosted playtest links. */
export default defineConfig({
  base: './',
  define: { 'import.meta.env.VITE_SINGLEFILE': 'true' },
  build: { target: 'es2022', outDir: 'dist-single', emptyOutDir: true, copyPublicDir: false },
  plugins: [
    {
      // No service worker in the single-file build: stub the PWA module.
      name: 'stub-pwa-register',
      resolveId: (id) => (id === 'virtual:pwa-register' ? '\0pwa-stub' : null),
      load: (id) => (id === '\0pwa-stub' ? 'export const registerSW = () => () => {};' : null),
    },
    viteSingleFile(),
  ],
});
