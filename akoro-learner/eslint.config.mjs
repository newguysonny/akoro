// Deliberately ONE rule: no-undef. It is the class of bug that shipped
// silently in the reader — a helper called outside its scope ("ready is not
// defined") and a function used without its import (background PDF
// extraction threw inside a silent catch). Widen the rule set on purpose,
// not by accident.
import globals from "globals";

// The source carries `eslint-disable-next-line react-hooks/exhaustive-deps`
// comments; a no-op stand-in keeps them valid without enabling that rule.
const reactHooksStub = {
  rules: { "exhaustive-deps": { meta: { schema: false }, create: () => ({}) } },
};

export default [
  { ignores: ["dist/**", "node_modules/**", "public/**"] },
  {
    files: ["src/**/*.{js,jsx,mjs}"],
    plugins: { "react-hooks": reactHooksStub },
    linterOptions: { reportUnusedDisableDirectives: "off" },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node },
    },
    rules: { "no-undef": "error" },
  },
];
