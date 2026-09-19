import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const productionBasePath = "/k-multiplayer-3d-game/";

export default defineConfig(({ command }) => ({
  base: command === "serve" ? "/" : productionBasePath,
  build: {
    sourcemap: true,
    target: "es2022"
  },
  plugins: [
    VitePWA({
      includeAssets: ["game-icon.svg"],
      manifest: {
        background_color: "#101b3b",
        description: "A mobile-first online 3D arena game.",
        display: "standalone",
        icons: [
          {
            src: "game-icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable"
          }
        ],
        name: "scooter-shooter",
        orientation: "any",
        short_name: "scooter-shooter",
        start_url: productionBasePath,
        theme_color: "#101b3b"
      },
      registerType: "prompt",
      strategies: "generateSW",
      workbox: {
        cleanupOutdatedCaches: true,
        globPatterns: ["**/*.{css,html,js,svg,webmanifest}"],
        navigateFallback: "index.html",
        runtimeCaching: []
      }
    })
  ]
}));
