import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

describe("next.config: dev origins", () => {
  // `next dev` refuses the dev WebSocket from any hostname it does not trust. The page then renders and native
  // inputs work, but React never hydrates, so every button is dead. See the comment in next.config.ts.
  it("trusts 127.0.0.1 so the app also works when opened by IP", () => {
    expect(nextConfig.allowedDevOrigins).toContain("127.0.0.1");
  });

  it("trusts the local network address that `next dev` prints as Network", () => {
    const origins = nextConfig.allowedDevOrigins ?? [];
    expect(origins.some((o) => o === "192.168.*.*")).toBe(true);
  });

  it("only lists bare hostnames (no scheme or port, which Next ignores or rejects)", () => {
    for (const o of nextConfig.allowedDevOrigins ?? []) expect(o).toMatch(/^[\w*.-]+$/);
  });
});
