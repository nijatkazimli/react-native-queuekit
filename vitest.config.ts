import ts from "typescript";
import { defineConfig } from "vitest/config";

// The default transformer cannot parse standard decorators, so lower them with TypeScript.
const lowerDecorators = {
  name: "lower-decorators",
  enforce: "pre" as const,
  transform(code: string, id: string) {
    if (!id.endsWith("decorators.test.ts")) return null;
    const { outputText } = ts.transpileModule(code, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    });
    return { code: outputText, map: null };
  },
};

export default defineConfig({
  plugins: [lowerDecorators],
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      // index.ts only re-exports and types.ts holds type declarations.
      exclude: ["src/index.ts", "src/types.ts"],
      thresholds: { 100: true },
    },
  },
});
