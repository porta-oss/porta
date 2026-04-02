import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const sharedSrcPath = fileURLToPath(
  new URL("../../packages/shared/src", import.meta.url)
);

export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      "@shared": sharedSrcPath,
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    host: "localhost",
    port: Number(process.env.WEB_PORT ?? 5173),
  },
  preview: {
    host: "localhost",
    port: 4173,
  },
});
