import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import next from "@next/eslint-plugin-next";
import globals from "globals";

/**
 * Flat-config ESLint.
 *
 * `next lint` was removed in Next 16, so this replaces it directly rather than through a
 * wrapper. The rule selection is deliberately narrow: TypeScript already catches most of
 * what a linter historically did, so the rules kept here are the ones that catch things
 * the compiler cannot — misused promises, dead conditionals, and the React and Next
 * mistakes that fail at runtime rather than at build.
 *
 * Stylistic rules are entirely absent on purpose. Arguing about them in review is the
 * fastest way to make a linter unwelcome, and none of them prevent a bug.
 */
export default tseslint.config(
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "drizzle/**",
      "data/**",
      "backups/**",
      "next-env.d.ts",
      // Agent worktrees are whole checkouts of this repo. Without this, every
      // problem in the tree gets reported once per worktree, and a stale one
      // reports problems from code that is no longer on any branch.
      ".claude/worktrees/**",
    ],
  },

  js.configs.recommended,

  // Type-aware linting. It is slower than the syntactic-only preset, and it is the
  // reason floating promises and unnecessary conditionals can be detected at all —
  // exactly the checks worth having in a codebase that is largely async and DB-bound.
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node, ...globals.browser },
    },
  },

  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "@next/next": next,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...next.configs.recommended.rules,
      ...next.configs["core-web-vitals"].rules,

      /*
       * The rule that earns this config its place. An un-awaited promise in a route
       * handler or a server action silently does nothing, and neither TypeScript nor
       * the tests would notice — the request simply returns before the work happens.
       */
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",

      // Unused code is usually a half-finished edit. Underscore-prefixed args are the
      // documented escape hatch, used by the server actions' `_prev` parameter.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "none",
        },
      ],

      /*
       * Downgraded, not disabled. Drizzle's query builders and JSON.parse legitimately
       * produce `any` at the boundary, and every such site here is already narrowed by
       * a zod schema or an explicit cast. Erroring would train people to sprinkle
       * eslint-disable comments, which is worse than seeing the warning.
       */
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",

      // `catch {}` around a best-effort operation is a deliberate pattern here, always
      // with a comment explaining why the failure is acceptable.
      "@typescript-eslint/no-empty-function": "off",

      // Interfaces with no members are used as extension points in a couple of places.
      "@typescript-eslint/no-empty-object-type": "off",
    },
  },

  /*
   * Server Components may read the clock.
   *
   * React Compiler's purity rule flags `Date.now()` during render, and it is right to do
   * so in a client component: render must be repeatable for memoisation and concurrent
   * features to be safe. A Server Component in this app runs exactly once per request and
   * is `force-dynamic`, so reading the current time is not a violation — it is the
   * feature. "This incident has been open 4m 12s" has no other implementation.
   *
   * Scoped to src/app rather than disabled globally: every file there is a Server
   * Component (verified — no "use client" under src/app), while the client components in
   * src/components keep the rule.
   */
  {
    files: ["src/app/**/*.{ts,tsx}"],
    rules: {
      "react-hooks/purity": "off",
    },
  },

  // Tests and scripts are not application code: they run once, by a human or by CI, and
  // the type-aware promise rules mostly get in the way there.
  {
    files: ["**/*.test.ts", "scripts/**/*.{ts,mts}"],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
    },
  },

  // Config files sit outside the tsconfig project, so type-aware rules cannot run on
  // them. Lint them syntactically rather than excluding them entirely.
  {
    files: ["*.mjs", "*.config.{js,mjs,ts}", "scripts/**/*.mts"],
    ...tseslint.configs.disableTypeChecked,
  },
);
