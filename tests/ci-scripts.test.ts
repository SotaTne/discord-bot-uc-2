import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe(".github/scripts", () => {
  it("相対の import は、拡張子（.ts）つき（vitest は、なくても読めるが、CD の node は、なければ、読めない）", () => {
    const dir = new URL("../.github/scripts/", import.meta.url);
    for (const file of readdirSync(dir).filter((name) => name.endsWith(".ts"))) {
      for (const [, path] of readFileSync(new URL(file, dir), "utf8").matchAll(/from "(\.[^"]*)"/g)) {
        expect(path, `${file}: ${path}`).toMatch(/\.ts$/);
      }
    }
  });
});
