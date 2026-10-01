const v = (n) => `rgb(var(--${n}) / <alpha-value>)`;
module.exports = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: v("ink"),
        mist: v("mist"),
        sub: v("sub"),
        surface: v("surface"),
        seg: v("seg"),
        onink: v("onink"),
        azure: "#0A84FF",
      },
    },
  },
};
