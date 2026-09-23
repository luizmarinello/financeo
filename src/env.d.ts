/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** URL do Worker de push, ex.: https://financas-push.xxx.workers.dev */
  readonly VITE_PUSH_API?: string
  /** Chave pública VAPID (pode ir para o repositório) */
  readonly VITE_VAPID_PUBLIC_KEY?: string
  /** Segredo compartilhado com o Worker, só para evitar escrita de estranhos */
  readonly VITE_PUSH_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
