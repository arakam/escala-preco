import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          blue: "#1e3a8a",   // azul royal
          "blue-light": "#2563eb",
          "blue-dark": "#1e40af",
          orange: "#ea580c",  // laranja
          "orange-light": "#f97316",
          "orange-dark": "#c2410c",
        },
      },
    },
  },
  plugins: [],
};
export default config;
