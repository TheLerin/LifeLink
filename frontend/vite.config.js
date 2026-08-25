import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// LifeLink frontend dev server.
// The dev server proxies /api to the FastAPI backend so the browser makes
// same-origin requests. This avoids CORS issues entirely during development.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY_TARGET || "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
