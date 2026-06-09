import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// In local dev, run `vercel dev` (which serves both Vite and the /api
// functions), or run `npm run dev` and point VITE_API_BASE at a deployed
// instance of the API.
export default defineConfig({
  plugins: [react(), tailwindcss()],
});
