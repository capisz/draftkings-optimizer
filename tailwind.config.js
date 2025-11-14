/** @type {import('tailwindcss').Config} */
module.exports = {
 content: [
  './pages/**/*.{js,ts,jsx,tsx,mdx}',
  './components/**/*.{js,ts,jsx,tsx,mdx}',
  './app/**/*.{js,ts,jsx,tsx,mdx}',
  './app/globals.css',
  './src/**/*.{js,ts,jsx,tsx,mdx}',
  '*.{js,ts,jsx,tsx,mdx}'
],
  theme: {
    extend: {
      colors: {
        'carolina-blue': 'rgb(var(--carolina-blue) / <alpha-value>)',
        'blue-munsell': 'rgb(var(--blue-munsell) / <alpha-value>)',
        'rose-quartz': 'rgb(var(--rose-quartz) / <alpha-value>)',
        'cherry': '#D2042D',
        'pumpkin': '#FF7518',
        'goldenrod': '#DAA520',
        'starfish-orange': '#FF9E00',
      },
    },
  },
  plugins: [],
}

