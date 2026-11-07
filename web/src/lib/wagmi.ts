import { createConfig, fallback, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { sepolia } from "wagmi/chains";
import { RPC_URLS } from "./config";

export const wagmiConfig = createConfig({
  chains: [sepolia],
  connectors: [injected()],
  transports: { [sepolia.id]: fallback(RPC_URLS.map((url) => http(url, { timeout: 8000, retryCount: 1 }))) },
  ssr: true,
});
