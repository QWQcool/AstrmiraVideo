import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 开发代理：`/api` 与 `/media` **都必须**转发到 Fastify（3000）。
 *
 * `/media` 是成片直链（后端 `staticOutputs` 提供 206 Range 静态服务）。
 * 漏了它会得到一个很像"播放器坏了"的症状：任务 `succeeded`、URL 也有值，
 * 但请求打到 5173 的 SPA fallback 拿到 `index.html`，浏览器把它当视频解码 →
 * `MEDIA_ERR_SRC_NOT_SUPPORTED`，且 Network 面板里状态码是 **200**（不是 404），极易误判。
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/media': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
});
