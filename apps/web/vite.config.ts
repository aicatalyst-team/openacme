import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";

export default defineConfig({
  plugins: [
    // Router plugin must run before react() so route files are transformed first.
    tanstackRouter({
      target: "react",
      routesDirectory: "./app/routes",
      generatedRouteTree: "./app/routeTree.gen.ts",
      autoCodeSplitting: true,
    }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, ".") },
  },
  // Pre-bundle the lazily-loaded picker so first open doesn't trigger a
  // dev-time "new dependencies optimized" full reload.
  optimizeDeps: { include: ["emoji-picker-react"] },
  // "out" keeps the server's prepack copy and workspace static fallback unchanged.
  build: { outDir: "out", emptyOutDir: true },
});
