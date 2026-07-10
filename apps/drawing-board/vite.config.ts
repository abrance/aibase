import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const defaultHost = process.env.DRAWING_BOARD_HOST ?? "0.0.0.0";

const aibaseBackend =
  process.env.AIBASE_BACKEND_URL ?? "http://127.0.0.1:3001";

export default defineConfig({
  plugins: [react()],
  server: {
    host: defaultHost,
    port: 5173,
    strictPort: false,
    proxy: {
      "/api": {
        target: aibaseBackend,
        changeOrigin: true,
      },
    },
  },
});