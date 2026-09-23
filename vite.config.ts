import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// base: precisa bater com o nome do repositorio no GitHub Pages.
export default defineConfig({
  // a pasta do projeto pode estar atrás de um link do sistema; sem isto o
  // Vite resolve index.html para fora da raiz e o build quebra
  resolve: { preserveSymlinks: true },
  base: process.env.PAGES_BASE ?? '/financeo/',
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',   // SW próprio: precisamos do handler de push
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectManifest: { globPatterns: ['**/*.{js,css,html,svg,png,woff2}'] },
      devOptions: { enabled: true, type: 'module' },
      manifest: {
        name: 'Finanças',
        short_name: 'Finanças',
        description: 'Controle financeiro pessoal',
        lang: 'pt-BR',
        dir: 'ltr',
        categories: ['finance', 'productivity'],
        theme_color: '#0f1115',
        background_color: '#0f1115',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
