import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  
  // Ensure dev server runs on port 1420 (Tauri default)
  server: {
    port: 1420,
    strictPort: true,
    host: "localhost",
  },

  // Build configuration
  build: {
    // Tauri uses Chromium on Windows which supports ES2021
    target: "es2021",
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },

  // Prevent vite from obscuring rust errors
  clearScreen: false,
});
