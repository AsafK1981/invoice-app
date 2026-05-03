// Minimal ESLint config — just enforces React hooks rules.
// Pre-push hook runs this to catch hook-order bugs (e.g. React error #310,
// shipped in commit b676137 when a useState was placed after an early return).
//
// We deliberately do NOT pull in the full eslint-config-next here: the rest of
// the codebase hasn't been linted, and turning everything on would cascade
// hundreds of unrelated warnings into the pre-push gate. Add more rules as the
// codebase converges.

import reactHooks from "eslint-plugin-react-hooks";
import tsParser from "@typescript-eslint/parser";

export default [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "scripts/**",
      "tests/**",
      "*.config.*",
    ],
  },
  {
    files: ["src/**/*.{ts,tsx,js,jsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
    },
  },
];
