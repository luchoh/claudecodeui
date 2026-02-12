import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command, mode }) => {
  // Load env file based on `mode` in the current working directory.
  const env = loadEnv(mode, process.cwd(), '')
  
  
  return {
    plugins: [react()],
    optimizeDeps: {
      exclude: ['refractor'],
      include: [
        'react-syntax-highlighter',
        'refractor/core',
        'react-syntax-highlighter/dist/esm/languages/prism/javascript',
        'react-syntax-highlighter/dist/esm/languages/prism/typescript',
        'react-syntax-highlighter/dist/esm/languages/prism/jsx',
        'react-syntax-highlighter/dist/esm/languages/prism/tsx',
        'react-syntax-highlighter/dist/esm/languages/prism/python',
        'react-syntax-highlighter/dist/esm/languages/prism/markup',
        'react-syntax-highlighter/dist/esm/languages/prism/css',
        'react-syntax-highlighter/dist/esm/languages/prism/scss',
        'react-syntax-highlighter/dist/esm/languages/prism/json',
        'react-syntax-highlighter/dist/esm/languages/prism/bash',
        'react-syntax-highlighter/dist/esm/languages/prism/sql',
        'react-syntax-highlighter/dist/esm/languages/prism/markdown',
        'react-syntax-highlighter/dist/esm/languages/prism/yaml',
        'react-syntax-highlighter/dist/esm/languages/prism/java',
        'react-syntax-highlighter/dist/esm/languages/prism/go',
        'react-syntax-highlighter/dist/esm/languages/prism/rust',
        'react-syntax-highlighter/dist/esm/languages/prism/c',
        'react-syntax-highlighter/dist/esm/languages/prism/cpp',
        'react-syntax-highlighter/dist/esm/languages/prism/csharp',
        'react-syntax-highlighter/dist/esm/languages/prism/ruby',
        'react-syntax-highlighter/dist/esm/languages/prism/php',
        'react-syntax-highlighter/dist/esm/languages/prism/swift',
        'react-syntax-highlighter/dist/esm/languages/prism/kotlin',
        'react-syntax-highlighter/dist/esm/languages/prism/toml',
        'react-syntax-highlighter/dist/esm/languages/prism/docker',
        'react-syntax-highlighter/dist/esm/languages/prism/graphql',
      ]
    },
    server: {
      port: parseInt(env.VITE_PORT) || 5173,
      watch: null,
      proxy: {
        '/api': `http://localhost:${env.PORT || 3001}`,
        '/ws': {
          target: `ws://localhost:${env.PORT || 3001}`,
          ws: true
        },
        '/shell': {
          target: `ws://localhost:${env.PORT || 3001}`,
          ws: true
        }
      }
    },
    build: {
      outDir: 'dist',
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-codemirror': [
              '@uiw/react-codemirror',
              '@codemirror/lang-css',
              '@codemirror/lang-html',
              '@codemirror/lang-javascript',
              '@codemirror/lang-json',
              '@codemirror/lang-markdown',
              '@codemirror/lang-python',
              '@codemirror/theme-one-dark',
              '@codemirror/view',
              '@codemirror/merge'
            ],
            'vendor-xterm': ['@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-clipboard', '@xterm/addon-webgl', '@xterm/addon-web-links']
          }
        }
      }
    }
  }
})
