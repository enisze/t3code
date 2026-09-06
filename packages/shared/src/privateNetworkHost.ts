/**
 * Recognise hosts that only answer from the local machine or its local network.
 *
 * Pairing a phone with a desktop backend usually means handing the phone an
 * RFC1918 address. When the phone is on mobile data, on a different SSID, or
 * holding an address the desktop had on an earlier network, the connection dies
 * at the transport layer with nothing to distinguish it from a crashed server —
 * so callers use this to say "check the network" instead of surfacing a bare
 * transport error, and to pick `http` over `https` for scheme-less input.
 *
 * Deliberately excluded: the `100.64.0.0/10` carrier-grade NAT range that
 * Tailscale hands out. Those addresses are private too, but they route over the
 * tailnet rather than the local network, so local-network advice would be wrong.
 *
 * @module privateNetworkHost
 */

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

const stripIpv6Brackets = (hostname: string): string =>
  hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;

const parseIpv4Octets = (hostname: string): readonly number[] | null => {
  const match = IPV4_PATTERN.exec(hostname);
  if (!match) {
    return null;
  }

  const octets = match.slice(1, 5).map((octet) => Number.parseInt(octet, 10));
  return octets.every((octet) => octet <= 255) ? octets : null;
};

/** `true` for an IPv4 literal in a range that never routes past the local network. */
const isPrivateIpv4 = (octets: readonly number[]): boolean => {
  const [first = 0, second = 0] = octets;

  // 127.0.0.0/8 loopback, 10.0.0.0/8, 192.168.0.0/16, 169.254.0.0/16 link-local.
  if (first === 127 || first === 10) return true;
  if (first === 192 && second === 168) return true;
  if (first === 169 && second === 254) return true;
  // 172.16.0.0/12.
  return first === 172 && second >= 16 && second <= 31;
};

/** `true` for an IPv6 loopback, unique-local (`fc00::/7`), or link-local (`fe80::/10`) literal. */
const isPrivateIpv6 = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase();
  if (normalized === "::1" || normalized === "::") {
    return true;
  }
  if (!normalized.includes(":")) {
    return false;
  }

  const [firstGroup = ""] = normalized.split(":");
  if (firstGroup.length === 0) {
    return false;
  }

  const prefix = Number.parseInt(firstGroup.padEnd(4, "0"), 16);
  if (Number.isNaN(prefix)) {
    return false;
  }

  // fc00::/7 unique-local, fe80::/10 link-local.
  return (prefix & 0xfe00) === 0xfc00 || (prefix & 0xffc0) === 0xfe80;
};

/**
 * Whether `hostname` is reachable only from this machine or its local network.
 *
 * Expects a bare hostname without a port — `new URL(...).hostname` is already in
 * that shape, IPv6 brackets included or not.
 */
export function isPrivateNetworkHostname(hostname: string): boolean {
  const normalized = stripIpv6Brackets(hostname.trim().toLowerCase()).replace(/\.$/, "");
  if (normalized.length === 0) {
    return false;
  }

  if (normalized === "localhost" || normalized.endsWith(".localhost")) {
    return true;
  }
  // mDNS names (`macbook.local`) resolve over the local link only.
  if (normalized.endsWith(".local")) {
    return true;
  }

  const octets = parseIpv4Octets(normalized);
  return octets ? isPrivateIpv4(octets) : isPrivateIpv6(normalized);
}

/**
 * Whether `url` points at a host reachable only from the local network.
 *
 * Returns `false` for input that isn't a parseable absolute URL, so callers can
 * pass raw user input without guarding first.
 */
export function isPrivateNetworkUrl(url: string): boolean {
  try {
    return isPrivateNetworkHostname(new URL(url).hostname);
  } catch {
    return false;
  }
}
