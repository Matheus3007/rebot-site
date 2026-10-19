import { defineConfig } from 'vite';

// .glb is served as model/gltf-binary (never octet-stream) so download managers leave it alone.
const glbMime = () => ({
  name: 'glb-mime',
  configureServer(s) { s.middlewares.use((q, r, n) => { if (q.url && q.url.split('?')[0].endsWith('.glb')) r.setHeader('Content-Type', 'model/gltf-binary'); n(); }); },
  configurePreviewServer(s) { s.middlewares.use((q, r, n) => { if (q.url && q.url.split('?')[0].endsWith('.glb')) r.setHeader('Content-Type', 'model/gltf-binary'); n(); }); },
});

export default defineConfig({
  base: './',
  plugins: [glbMime()],
  build: { target: 'es2020', chunkSizeWarningLimit: 900 },
});
