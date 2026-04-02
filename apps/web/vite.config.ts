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
<<<<<<< HEAD
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    host: "localhost",
    port: Number(process.env.WEB_PORT ?? 5173),
  },
  preview: {
    host: "localhost",
=======
      "@": webSrcPath,
    },
  },
  server: {
    host: process.env.WEB_HOST ?? "0.0.0.0",
    port: Number(process.env.WEB_PORT ?? 5173),
  },
  preview: {
    host: process.env.WEB_HOST ?? "0.0.0.0",
>>>>>>> milestone/M002
    port: 4173,
  },
});
