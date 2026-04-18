/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        noma: {
          red: '#b91c1c',
          orange: '#ea580c',
          yellow: '#ca8a04',
          green: '#15803d',
        }
      }
    },
  },
  plugins: [],
}
