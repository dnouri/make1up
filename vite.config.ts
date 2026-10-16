import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "/make1up/",
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
