import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/** Sound test page as one self-contained HTML file (dev tool, not shipped). */
export default defineConfig({
  root: 'tools/soundboard',
  base: './',
  build: { target: 'es2022', outDir: '../../dist-sounds', emptyOutDir: true, copyPublicDir: false },
  plugins: [viteSingleFile()],
});
