import { describe, expect, it } from "vitest";

import { generateTotpCode } from "../src/lib/totp.js";

describe("generateTotpCode", () => {
  it("matches the RFC 6238 reference vector", () => {
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    const timestamp = 59_000;

    expect(generateTotpCode(secret, timestamp, 30, 8)).toBe("94287082");
  });
});
