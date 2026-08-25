/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // Dark navy navigation shell (blueprint section 28).
        navy: {
          50: "#f4f6fb",
          100: "#c7cee3",
          700: "#1e2a4a",
          800: "#16203a",
          900: "#0f172b",
          950: "#0a1020",
        },
        // Red accent reserved for blood operations.
        blood: {
          50: "#fef2f2",
          100: "#fee2e2",
          500: "#dc2626",
          600: "#c62222",
          700: "#a51b1b",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "Segoe UI",
          "system-ui",
          "-apple-system",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      borderRadius: {
        card: "0.5rem",
      },
    },
  },
  plugins: [],
};
