import { describe, expect, it } from "vite-plus/test";

import { isPrivateNetworkHostname, isPrivateNetworkUrl } from "./privateNetworkHost.ts";

describe("isPrivateNetworkHostname", () => {
  it.each([
    "127.0.0.1",
    "127.1.2.3",
    "10.0.0.1",
    "172.16.0.1",
    "172.31.255.254",
    "192.168.1.21",
    "192.168.2.37",
    "169.254.10.20",
    "localhost",
    "app.localhost",
    "macbook-air.local",
    "MacBook-Air.Local",
    "::1",
    "[::1]",
    "fd12:3456::1",
    "fe80::1",
  ])("treats %s as local-network only", (hostname: string) => {
    expect(isPrivateNetworkHostname(hostname)).toBe(true);
  });

  it.each([
    "example.com",
    "app.t3.codes",
    "8.8.8.8",
    "172.15.0.1",
    "172.32.0.1",
    "192.169.1.1",
    "11.0.0.1",
    "2606:4700::1111",
    "",
    "   ",
  ])("treats %s as routable", (hostname: string) => {
    expect(isPrivateNetworkHostname(hostname)).toBe(false);
  });

  it("leaves tailnet CGNAT addresses out, since they route over the tailnet", () => {
    // Local-network advice would be wrong for these, so they must not match.
    expect(isPrivateNetworkHostname("100.82.16.5")).toBe(false);
    expect(isPrivateNetworkHostname("100.90.1.2")).toBe(false);
  });

  it("rejects malformed IPv4 literals rather than guessing", () => {
    expect(isPrivateNetworkHostname("192.168.1.999")).toBe(false);
    expect(isPrivateNetworkHostname("10.0.0")).toBe(false);
  });
});

describe("isPrivateNetworkUrl", () => {
  it("reads the hostname out of a full URL", () => {
    expect(isPrivateNetworkUrl("http://192.168.2.37:3773/.well-known/t3/environment")).toBe(true);
    expect(isPrivateNetworkUrl("https://app.t3.codes/pair")).toBe(false);
  });

  it("returns false for input that is not an absolute URL", () => {
    expect(isPrivateNetworkUrl("192.168.2.37:3773")).toBe(false);
    expect(isPrivateNetworkUrl("")).toBe(false);
  });
});
