import type { IncomingHttpHeaders } from "node:http";
import { BlockList, isIP } from "node:net";

const normalize = (ip: string) => ip.replace(/^::ffff:/, "");
/** Trusted peers are deployment configuration, never taken from HTTP headers. */
export function proxyConfiguration(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  if (env.HTTP_FROM_PROXY !== "1") return null;
  const provider = env.TRUST_PROXY_PROVIDER;
  if (provider !== "fly" && provider !== "railway")
    throw new Error("Explicit proxy provider required");
  const peers = new BlockList();
  const cidrs = (env.TRUSTED_PROXY_CIDRS ?? "").split(",").filter(Boolean);
  if (!cidrs.length)
    throw new Error("Explicit trusted proxy peer CIDRs required");
  for (const cidr of cidrs) {
    const [address = "", prefix] = cidr.trim().split("/");
    const family = isIP(address);
    const bits =
      prefix === undefined ? (family === 4 ? 32 : 128) : Number(prefix);
    if (
      !family ||
      !Number.isInteger(bits) ||
      bits < 1 ||
      bits > (family === 4 ? 32 : 128)
    )
      throw new Error("Invalid trusted proxy peer CIDR");
    peers.addSubnet(address, bits, family === 4 ? "ipv4" : "ipv6");
  }
  const publicUrl = new URL(env.BETTER_AUTH_URL ?? "");
  if (
    publicUrl.protocol !== "https:" ||
    publicUrl.username ||
    publicUrl.password
  )
    throw new Error("Proxy mode requires an HTTPS public URL");
  return { provider, peers, publicUrl };
}
export function proxyClientIp(
  config: ReturnType<typeof proxyConfiguration>,
  remote: string,
  headers: IncomingHttpHeaders,
) {
  const ip = normalize(remote);
  if (!config) return ip;
  const family = isIP(ip);
  if (!family || !config.peers.check(ip, family === 4 ? "ipv4" : "ipv6"))
    throw new Error("Untrusted proxy peer");
  const forwarded =
    headers[config.provider === "fly" ? "fly-client-ip" : "x-real-ip"];
  if (typeof forwarded !== "string" || !isIP(forwarded))
    throw new Error("Missing platform client IP");
  return normalize(forwarded);
}
