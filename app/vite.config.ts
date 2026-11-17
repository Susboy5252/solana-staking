import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // Codama-generated code references process.env.NODE_ENV.
  define: { 'process.env.NODE_ENV': JSON.stringify(mode) },
}));
