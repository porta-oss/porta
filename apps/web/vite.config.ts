import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const sharedSrcPath = fileURLToPath(
  new URL("../../packages/shared/src", import.meta.url)
);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": sharedSrcPath,
    },
  },
  server: {
    host: "127.0.0.1",
    port: Number(process.env.WEB_PORT ?? 5173),
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
  },
});
