/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Basis-URL der API, z. B. https://api.einkauf.example.com. Leer = gleiche Origin (lokal über den Vite-Proxy). */
  readonly VITE_API_URL?: string;
}
