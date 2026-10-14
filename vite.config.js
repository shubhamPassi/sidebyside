import { defineConfig } from 'vite';
export default defineConfig({ server: { proxy: { '/api': 'http://127.0.0.1:3001', '/socket': { target: 'ws://127.0.0.1:3001', ws: true } } } });
