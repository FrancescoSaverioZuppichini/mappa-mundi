import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // [Agent] MapLibre creates its worker as a module worker, so the bundled worker must be an ES module too.
  worker: { format: 'es' },
})
