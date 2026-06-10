import { defineConfig } from "vite";

// GitHub Pages serves the site under /<repo>/
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/jiyugaoka-digital-twin/" : "/",
}));
