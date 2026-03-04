import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        /* Tema inspirado em TailAdmin: primary (azul), accent (laranja), semânticos */
        primary: {
          DEFAULT: "#3C50E0",
          light: "#4F6BF5",
          lighter: "#8093F5",
          dark: "#2E42B8",
          darker: "#1E3A8a",
        },
        secondary: {
          DEFAULT: "#64748B",
          light: "#94A3B8",
          dark: "#475569",
        },
        body: {
          DEFAULT: "#F1F5F9",
          dark: "#0F172A",
        },
        stroke: {
          DEFAULT: "#E2E8F0",
          dark: "#334155",
        },
        success: {
          DEFAULT: "#12B76A",
          light: "#D1FADF",
          dark: "#039855",
        },
        error: {
          DEFAULT: "#F04438",
          light: "#FEE4E2",
          dark: "#D92D20",
        },
        warning: {
          DEFAULT: "#F79009",
          light: "#FEF0C7",
          dark: "#DC6803",
        },
        /* Mantém compatibilidade com o que já existe */
        brand: {
          blue: "#1e3a8a",
          "blue-light": "#2563eb",
          "blue-dark": "#1e40af",
          orange: "#ea580c",
          "orange-light": "#f97316",
          "orange-dark": "#c2410c",
        },
      },
      borderRadius: {
        "app": "0.5rem",
        "app-lg": "0.75rem",
      },
      boxShadow: {
        "card": "0 1px 3px 0 rgb(0 0 0 / 0.06), 0 1px 2px -1px rgb(0 0 0 / 0.06)",
        "card-hover": "0 4px 6px -1px rgb(0 0 0 / 0.08), 0 2px 4px -2px rgb(0 0 0 / 0.06)",
        "dropdown": "0 10px 15px -3px rgb(0 0 0 / 0.08), 0 4px 6px -4px rgb(0 0 0 / 0.04)",
      },
    },
  },
  plugins: [],
};
export default config;
