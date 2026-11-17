module.exports = {
  content: ["./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Archivo"', "system-ui", "sans-serif"],
        sans: ['"IBM Plex Sans"', "system-ui", "sans-serif"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "monospace"],
      },
      boxShadow: { card: "0 1px 0 0 rgb(255 255 255 / 0.03) inset, 0 10px 30px -12px rgb(0 0 0 / 0.6)" },
    },
  },
};
