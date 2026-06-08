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
      // Enforce the mutation-path rule (CLAUDE.md / REFACTOR.md): the raw
      // item-mutation server actions must never be imported directly by a
      // component — all item writes go through the outbox (`mu*` helpers in
      // src/lib/sync/mutations.ts). The dispatcher src/lib/sync/engine.ts is the
      // sole legitimate caller and is allowlisted below. These 7 names are
      // unique to src/app/lists/[id]/actions/items.ts across the repo, so
      // name-filtering is precise even with broad path globs. Deliberately NOT
      // blocked (documented direct-call exceptions): addItems (batch),
      // clearShoppedItems, clearAllItems, categorizeItem, deleteHistoryItem,
      // copy/move/shareItemsToList, touchListView, suggestItemName, uploadImage.
      "no-restricted-imports": ["error", {
        patterns: [{
          group: [
            "@/app/lists/[id]/actions",
            "@/app/lists/[id]/actions/items",
            "**/lists/*/actions",
            "**/lists/*/actions/items",
            "./actions",
            "./actions/items",
            "../actions",
            "../actions/items",
          ],
          importNames: [
            "addItem", "updateItem", "toggleItem", "reorderItem",
            "deleteItem", "mergeItems", "setItemCategory",
          ],
          message:
            "Item mutations must go through the outbox (mu* helpers in " +
            "src/lib/sync/mutations.ts), not direct server actions. The " +
            "dispatcher src/lib/sync/engine.ts is the only allowed caller. " +
            "See the mutation-path rule in CLAUDE.md / REFACTOR.md.",
        }],
      }],
    },
  },
  // The outbox dispatcher is the one place allowed to call the raw item
  // mutations (it drains the outbox by invoking the real server actions).
  {
    files: ["src/lib/sync/engine.ts"],
    rules: { "no-restricted-imports": "off" },
  },
]);

export default eslintConfig;
