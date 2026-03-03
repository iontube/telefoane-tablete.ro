import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://telefoane-tablete.ro',
  trailingSlash: 'always',
  build: {
    format: 'directory'
  },
  integrations: [sitemap({ filter: () => false })],
  vite: {
    plugins: [tailwindcss()]
  }
});
