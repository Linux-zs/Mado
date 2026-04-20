import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('highlight.js')) {
            return 'highlight';
          }

          if (id.includes('@milkdown')) {
            return 'milkdown';
          }

          if (id.includes('remark-parse') || id.includes('remark-gfm') || id.includes('unified')) {
            return 'markdown';
          }
        }
      }
    }
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true
  }
});
