import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "out/**",
      "dist/**",
      "coverage/**",
      "next-env.d.ts",
      ".track-model-build/**",
      ".codex-tmp/**",
      ".playwright-cli/**",
      ".playwright-mcp/**",
      "test-results/**",
      "playwright-report/**",
      "output/**",
      "tmp/**",
    ],
  },
  ...nextVitals,
  ...nextTs,
];

export default eslintConfig;

