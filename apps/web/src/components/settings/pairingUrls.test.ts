import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  resolveDesktopPairingUrl,
  resolveHostedPairingUrl,
  resolveLocalNetworkPairingHost,
} from "./pairingUrls";

describe("settings pairing URL helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses direct backend pairing URLs for HTTP endpoints", () => {
    expect(resolveHostedPairingUrl("http://192.168.1.44:3773", "PAIRCODE")).toBeNull();
    expect(resolveDesktopPairingUrl("http://192.168.1.44:3773", "PAIRCODE")).toBe(
      "http://192.168.1.44:3773/pair#token=PAIRCODE",
    );
  });

  it("uses hosted pairing URLs for HTTPS endpoints", () => {
    vi.stubEnv("VITE_HOSTED_APP_URL", "https://preview.t3.codes");

    expect(resolveHostedPairingUrl("https://host.tailnet.example.ts.net:3773", "PAIRCODE")).toBe(
      "https://preview.t3.codes/pair?host=https%3A%2F%2Fhost.tailnet.example.ts.net%3A3773#token=PAIRCODE",
    );
  });
});

describe("resolveLocalNetworkPairingHost", () => {
  it("names the host for a direct local-network pairing URL", () => {
    expect(resolveLocalNetworkPairingHost("http://192.168.1.21:3773/pair#token=PAIRCODE")).toBe(
      "192.168.1.21:3773",
    );
    expect(resolveLocalNetworkPairingHost("http://macbook.local:3773/pair#token=PAIRCODE")).toBe(
      "macbook.local:3773",
    );
  });

  it("follows the backend host inside a hosted pairing link", () => {
    expect(
      resolveLocalNetworkPairingHost(
        "https://app.t3.codes/pair?host=http%3A%2F%2F192.168.1.21%3A3773#token=PAIRCODE",
      ),
    ).toBe("192.168.1.21:3773");
  });

  it("stays quiet for hosts the other device can route to", () => {
    expect(
      resolveLocalNetworkPairingHost("https://desktop.tailnet.ts.net/pair#token=PAIRCODE"),
    ).toBeNull();
    expect(
      resolveLocalNetworkPairingHost(
        "https://app.t3.codes/pair?host=https%3A%2F%2Fdesktop.tailnet.ts.net#token=PAIRCODE",
      ),
    ).toBeNull();
    // Tailnet addresses route over the tailnet, so local-network advice would mislead.
    expect(
      resolveLocalNetworkPairingHost("http://100.82.16.5:3773/pair#token=PAIRCODE"),
    ).toBeNull();
  });

  it("returns null for input that is not a URL", () => {
    expect(resolveLocalNetworkPairingHost("PAIRCODE")).toBeNull();
    expect(resolveLocalNetworkPairingHost("")).toBeNull();
  });
});
