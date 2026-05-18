import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],
  base: '/static/',
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@xterm/')) return 'xterm';
          // lang-* and legacy-modes are dynamic imports in CodeEditor — let Rollup keep them as individual chunks
          if (id.includes('@codemirror/lang-') || id.includes('@codemirror/legacy-modes')) return undefined;
          if (id.includes('@codemirror/') || id.includes('@lezer/') || id.includes('@replit/codemirror')) return 'codemirror';
          if (id.includes('marked')) return 'marked';
        },
      },
    },
  },
})
