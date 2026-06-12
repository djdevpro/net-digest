import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: {
    name: 'NetDigest',
    description:
      'Compact network capture for DevTools: recursively truncated payloads and bodies, deduped and exported as token-efficient TOON.',
    permissions: ['clipboardWrite'],
  },
});
