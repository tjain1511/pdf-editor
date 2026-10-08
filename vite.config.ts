import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'pdfjs', test: /node_modules[\\/]pdfjs-dist/ },
            { name: 'pdflib', test: /node_modules[\\/](pdf-lib|@pdf-lib|pako)/ },
          ],
        },
      },
    },
  },
  worker: { format: 'es' },
});
