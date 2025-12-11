// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    proxy: {
      // Proxy all /api requests to the AI server running on port 8787
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
        secure: false,
      },
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(
    Boolean
  ),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Force Vite to use the npm "buffer" polyfill instead of the Node builtin
      buffer: "buffer/",
    },
  },
  optimizeDeps: {
    // Ensure "buffer" is pre-bundled for the browser
    include: ["buffer"],
  },
}));






