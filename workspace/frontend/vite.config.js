import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], server: { port: 5173, strictPort: true, proxy: { '/auth': 'http://localhost:3001', '/api': 'http://localhost:3001' } } });
