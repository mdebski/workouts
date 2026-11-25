/// <reference types="svelte" />
/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** When this copy of the app was built (ISO timestamp). */
  readonly VITE_BUILD_TIME: string;
  /** The version in package.json, e.g. 0.8.0. */
  readonly VITE_APP_VERSION: string;
}
