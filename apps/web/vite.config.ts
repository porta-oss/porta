import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const sharedSrcPath = fileURLToPath(
  new URL("../../packages/shared/src", import.meta.url)
);

const webSrcPath = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      "@shared": sharedSrcPath,
      "@": webSrcPath,
    },
  },
  server: {
    host: process.env.WEB_HOST ?? "0.0.0.0",
    port: Number(process.env.WEB_PORT ?? 5173),
  },
  preview: {
    host: process.env.WEB_HOST ?? "0.0.0.0",
    port: 4173,
  },
});
