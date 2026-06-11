import { config } from "@repo/eslint-config/react-internal";

/** @type {import("eslint").Linter.Config[]} */
export default [{ ignores: ["out/**", "app/routeTree.gen.ts"] }, ...config];
