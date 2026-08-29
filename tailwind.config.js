/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['system-ui', 'Segoe UI', 'Roboto', 'Hiragino Sans', 'Yu Gothic', 'Noto Sans JP', 'sans-serif'],
      },
      colors: {
        bun: {
          900: '#0f1220',
          850: '#12162a',
          800: '#1b1f36',
          750: '#212644',
          700: '#2a2f4e',
          600: '#373c5e',
          500: '#454a70',
          400: '#5d6288',
          accent: '#8b5cf6',
          'accent-light': '#a78bfa',
          cyan: '#22d3ee',
          success: '#34d399',
          warn: '#fbbf24',
          danger: '#f87171',
        },
      },
      animation: {
        'fade-in': 'fadeIn 0.4s ease-out',
        'slide-up': 'slideUp 0.35s ease-out',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
      },
    },
  },
  plugins: [],
}
