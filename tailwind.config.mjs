/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        carbon: {
          950: '#160F0C',
          900: '#1C1410',
          800: '#241914',
          700: '#2A1F1A',
          600: '#3A2A22',
          500: '#4A372C'
        },
        ruby: {
          950: '#4A0820',
          900: '#6B0C2A',
          800: '#9F1239',
          700: '#BE1948',
          600: '#DC2659',
          500: '#E84A78'
        },
        cherry: { 700: '#B91C1C', 600: '#DC2626', 500: '#EF4444' },
        blush: { 200: '#FBCFE8', 300: '#F9A8D4' },
        peach: { 200: '#FED7AA', 300: '#FDBA74' },
        bone: {
          100: '#FEF3C7',
          200: '#F5E5C0',
          300: '#E6D3A3',
          400: '#C9B596',
          500: '#A89678',
          600: '#876F58'
        }
      },
      fontFamily: {
        display: ['"Playfair Display"', 'Cormorant Garamond', 'Georgia', 'serif'],
        cormorant: ['"Cormorant Garamond"', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif']
      },
      boxShadow: {
        'ruby-sm': '0 2px 8px -2px rgba(159, 18, 57, 0.25)',
        'ruby-md':
          '0 8px 24px -8px rgba(159, 18, 57, 0.45), 0 2px 4px rgba(159, 18, 57, 0.18)',
        'ruby-lg':
          '0 24px 60px -20px rgba(159, 18, 57, 0.55), 0 8px 16px -8px rgba(159, 18, 57, 0.30)',
        ember: '0 6px 30px -8px rgba(220, 38, 38, 0.45)'
      },
      keyframes: {
        'appear-up': {
          '0%': { opacity: 0, transform: 'translateY(18px)' },
          '100%': { opacity: 1, transform: 'translateY(0)' }
        },
        'appear-soft': {
          '0%': { opacity: 0, transform: 'translateY(8px)' },
          '100%': { opacity: 1, transform: 'translateY(0)' }
        },
        breath: {
          '0%,100%': {
            boxShadow:
              '0 0 0 0 rgba(220, 38, 38, 0.55), 0 10px 30px rgba(159, 18, 57, 0.45)'
          },
          '50%': {
            boxShadow:
              '0 0 0 14px rgba(220, 38, 38, 0), 0 14px 36px rgba(159, 18, 57, 0.55)'
          }
        },
        shimmer: {
          '0%': { transform: 'translateX(-130%)' },
          '100%': { transform: 'translateX(230%)' }
        }
      },
      animation: {
        'appear-up': 'appear-up 0.55s cubic-bezier(0.22, 1, 0.36, 1) both',
        'appear-soft': 'appear-soft 0.4s cubic-bezier(0.22, 1, 0.36, 1) both',
        breath: 'breath 2.8s ease-in-out infinite',
        shimmer: 'shimmer 2.4s ease-in-out infinite'
      }
    }
  },
  plugins: []
}
