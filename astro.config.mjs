import { defineConfig } from 'astro/config';

const apiTarget = process.env.GOLDILOCKS_API_URL ?? 'http://localhost:8081';

export default defineConfig({
  output: 'static',
  vite: {
    server: {
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
  },
});
