/// <reference types="svelte" />
/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** When this copy of the app was built (ISO timestamp). */
  readonly VITE_BUILD_TIME: string;
}
