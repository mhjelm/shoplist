import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // Item pictures are small, user-uploaded, and served from a third-party
      // host (ImgBB). next/image would need every upload origin whitelisted and
      // would proxy each thumbnail through Vercel's paid image optimizer for no
      // real benefit at these sizes — so we intentionally use raw <img>.
      "@next/next/no-img-element": "off",
      // Honor the conventional `_`-prefix escape hatch for deliberately-unused
      // bindings (e.g. a mock that must accept an arg it ignores). Without this
      // a `_field` param still warns, which is noise, not a real issue.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
]);

export default eslintConfig;
