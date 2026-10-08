import type { Config } from "@react-router/dev/config";
import { vercelPreset } from "@vercel/react-router/vite";

// App-proxy pages use the Shopify storefront origin, so lazy route discovery
// would request /__manifest from the storefront and receive a 404.
export default {
  routeDiscovery: { mode: "initial" },
  presets: [vercelPreset()],
} satisfies Config;
