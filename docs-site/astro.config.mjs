// @ts-check
import { defineConfig } from "astro/config"

export default defineConfig({
  site: "https://infinitel8p.github.io",
  base: "/Extreme-InfiniTV",
  trailingSlash: "ignore",
  build: {
    format: "directory",
  },
  markdown: {
    shikiConfig: {
      themes: { light: "github-light", dark: "github-dark" },
      wrap: true,
    },
  },
})
