import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  build: {
    target: 'es2020',
    assetsInlineLimit: 100000000,
    cssCodeSplit: false,
    reportCompressedSize: false
  },
  plugins: [viteSingleFile()]
});
