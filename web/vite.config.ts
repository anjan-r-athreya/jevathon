import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The server owns the pipeline and the cached Browserbase screenshots.
    proxy: {
      "/api": "http://localhost:8787",
      "/shots": "http://localhost:8787",
    },
  },
});
