import { isPrivateNetworkHostname } from "@t3tools/shared/privateNetworkHost";

import { buildHostedPairingUrl } from "../../hostedPairing";
import { setPairingTokenOnUrl } from "../../pairingUrl";

export function resolveDesktopPairingUrl(endpointUrl: string, credential: string): string {
  const url = new URL(endpointUrl);
  url.pathname = "/pair";
  return setPairingTokenOnUrl(url, credential).toString();
}

export function resolveHostedPairingUrl(endpointUrl: string, credential: string): string | null {
  const url = new URL(endpointUrl);
  if (url.protocol !== "https:") {
    return null;
  }

  return buildHostedPairingUrl({
    host: endpointUrl,
    token: credential,
  });
}

/**
 * The backend host a pairing URL points at, when that host is local-network only.
 *
 * Pairing usually hands the other device an RFC1918 address, which silently
 * requires it to sit on this network — a phone on mobile data or another SSID
 * just gets a transport error. Returning the host lets the UI say so up front
 * rather than leaving the reader to discover it on the other device.
 *
 * Hosted links carry the backend in their `host` parameter, so the check follows
 * that rather than the hosted app's own domain. Returns `null` for routable
 * hosts and for anything unparseable.
 */
export function resolveLocalNetworkPairingHost(pairingUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(pairingUrl);
  } catch {
    return null;
  }

  const hostedBackend = url.searchParams.get("host");
  if (hostedBackend !== null && hostedBackend.length > 0) {
    try {
      const backendUrl = new URL(hostedBackend);
      return isPrivateNetworkHostname(backendUrl.hostname) ? backendUrl.host : null;
    } catch {
      return null;
    }
  }

  return isPrivateNetworkHostname(url.hostname) ? url.host : null;
}
