import { defineConfig } from "vite"
import { devtools } from "@tanstack/devtools-vite"
import tsconfigPaths from "vite-tsconfig-paths"

import { tanstackStart } from "@tanstack/react-start/plugin/vite"

import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { nitro } from "nitro/vite"

const isTest = process.env.VITEST === "true"

const config = defineConfig({
  plugins: isTest
    ? [
        devtools(),
        tsconfigPaths({ projects: ["./tsconfig.json"] }),
        tailwindcss(),
        viteReact(),
      ]
    : [
        devtools(),
        nitro({ rollupConfig: { external: [/^@sentry\//] } }),
        tsconfigPaths({ projects: ["./tsconfig.json"] }),
        tailwindcss(),
        tanstackStart(),
        viteReact(),
      ],
  server: {
    proxy: {
      '/policies': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
})

export default config
