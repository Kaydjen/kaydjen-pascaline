import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

describe("fonts", () => {
  it("no system-font names are used for canvas text (A10: bundled faces only)", () => {
    const offenders = sources("src").filter((file) => /Georgia|Segoe|Brush Script|Times New Roman|cursive/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});
