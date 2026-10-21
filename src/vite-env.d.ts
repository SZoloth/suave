/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LIBRARY_URL: string;
  readonly VITE_THUMBNAIL_URL: string;
  readonly VITE_PUBLIC_DEMO?: string;
  readonly VITE_BROWSER_RETRIEVAL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
