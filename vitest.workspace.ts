import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  {
    test: {
      name: "api",
      include: ["apps/api/tests/**/*.test.ts"],
      environment: "node",
    },
  },
  {
    test: {
      name: "web",
      include: ["apps/web/src/**/*.test.ts", "apps/web/src/**/*.test.tsx"],
      environment: "jsdom",
    },
  },
]);
