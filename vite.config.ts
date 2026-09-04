import { defineConfig } from 'vite';

// GitHub Pages のプロジェクトページは /hiroshima-kart/ 配下で配信されるため
// base が要る。command で分岐すると `vite preview` が 'serve' 扱いになり、
// ビルド成果物を root で配信してしまって検証にならないので環境変数で渡す。
//   BASE_PATH=/hiroshima-kart/ npm run build && BASE_PATH=/hiroshima-kart/ npm run preview
// 開発サーバーは既定 (/) のまま。
// public/ 配下のアセットは src/geo.ts の assetUrl() が BASE_URL を見て解決する。
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  server: { port: 5180, open: false },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
