import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        // Split the long-lived dependencies away from app code so a content
        // change does not force users to re-download React/Supabase, and the
        // study data does not sit in the same chunk as the UI shell.
        codeSplitting: {
          groups: [
            { name: 'react-vendor', test: /node_modules[/\\](react|react-dom|scheduler)[/\\]/ },
            { name: 'supabase', test: /node_modules[/\\]@supabase[/\\]/ },
            { name: 'icons', test: /node_modules[/\\]lucide-react[/\\]/ },
            { name: 'study-data', test: /src[/\\](data\.js|data[/\\])/ },
          ],
        },
      },
    },
  },
})
