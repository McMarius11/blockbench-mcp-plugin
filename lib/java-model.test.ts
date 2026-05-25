/**
 * Unit tests for lib/java-model.ts. Pure-function tests — no Blockbench
 * runtime needed.
 *
 * Run:    bun test
 *         bun test lib/java-model.test.ts
 */
import { test, expect, describe } from "bun:test";
import { classifyModelSource, assertJavaModelShape } from "./java-model";

// --------------------------------------------------------------------------- //
// classifyModelSource
// --------------------------------------------------------------------------- //

describe("classifyModelSource", () => {
  test("inline JSON object", () => {
    const s = classifyModelSource('  {"elements": []}  ');
    expect(s.kind).toBe("inline");
    expect(s.value).toBe('{"elements": []}');
  });

  test("inline JSON array", () => {
    expect(classifyModelSource("[1,2,3]").kind).toBe("inline");
  });

  test("http URL", () => {
    const s = classifyModelSource("http://example.com/models/item/gun.json");
    expect(s.kind).toBe("url");
    expect(s.value).toBe("http://example.com/models/item/gun.json");
  });

  test("https URL", () => {
    expect(classifyModelSource("https://example.com/a.json").kind).toBe("url");
  });

  test("file: URL becomes a path", () => {
    const s = classifyModelSource("file:///home/user/models/gun.json");
    expect(s.kind).toBe("path");
    expect(s.value).toBe("/home/user/models/gun.json");
  });

  test("absolute unix path", () => {
    const s = classifyModelSource("/home/user/mod/models/item/gun.json");
    expect(s.kind).toBe("path");
    expect(s.value).toBe("/home/user/mod/models/item/gun.json");
  });

  test("relative path", () => {
    expect(classifyModelSource("models/item/gun.json").kind).toBe("path");
  });

  test("windows drive path is not treated as a URL", () => {
    const s = classifyModelSource("C:\\mods\\hardts_guns\\model.json");
    expect(s.kind).toBe("path");
  });

  test("non-http(s) protocols are not fetched", () => {
    // ftp:// must not be classified as a fetchable url
    expect(classifyModelSource("ftp://host/a.json").kind).toBe("path");
  });

  test("empty input throws", () => {
    expect(() => classifyModelSource("   ")).toThrow(/empty/i);
  });
});

// --------------------------------------------------------------------------- //
// assertJavaModelShape
// --------------------------------------------------------------------------- //

describe("assertJavaModelShape", () => {
  test("accepts a raw element model", () => {
    expect(() =>
      assertJavaModelShape({ elements: [{ from: [0, 0, 0], to: [1, 1, 1] }] })
    ).not.toThrow();
  });

  test("accepts a parent-only model", () => {
    expect(() => assertJavaModelShape({ parent: "item/generated" })).not.toThrow();
  });

  test("accepts a textures-only model", () => {
    expect(() => assertJavaModelShape({ textures: { "0": "block/stone" } })).not.toThrow();
  });

  test("accepts a display-only model", () => {
    expect(() => assertJavaModelShape({ display: {} })).not.toThrow();
  });

  test("rejects an object with none of the model keys", () => {
    expect(() => assertJavaModelShape({ foo: 1, credit: "x" })).toThrow(/not a java model/i);
  });

  test("rejects an array", () => {
    expect(() => assertJavaModelShape([1, 2, 3])).toThrow(/must be a json object/i);
  });

  test("rejects null", () => {
    expect(() => assertJavaModelShape(null)).toThrow(/must be a json object/i);
  });

  test("rejects a primitive", () => {
    expect(() => assertJavaModelShape("nope")).toThrow(/must be a json object/i);
  });
});
