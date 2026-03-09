import js from "@eslint/js";
import svelte from "eslint-plugin-svelte";
import globals from "globals";

/** @type {import('eslint').Linter.Config[]} */
export default [
  js.configs.recommended,
  ...svelte.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
    },
  },
  {
    ignores: ["dist/", "node_modules/"],
  },
];
