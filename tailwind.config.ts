import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        pink: {
          50:  '#FFF0F5',
          100: '#FFE1EC',
          200: '#FFC5D9',
          300: '#FF92BA',
          400: '#F75C9E',
          500: '#EF4187',
          600: '#EA1E63',
          700: '#C4155A',
          800: '#9B0E48',
          900: '#72083A',
        },
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        '4xl': '2rem',
        '5xl': '2.5rem',
      },
    },
  },
  plugins: [],
}

export default config
