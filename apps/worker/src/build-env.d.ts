// ビルド時に、wrangler の `define` が置き換える値の型（esbuild が、使われない分岐を、コードごと消す）。
// import.meta.env.DEV: 開発（`wrangler dev --define import.meta.env.DEV:true`）のときだけ true。
// wrangler.jsonc の既定は false（本番）なので、`if (import.meta.env.DEV)` の中は、デプロイされるコードに、入らない。
interface ImportMetaEnv {
  readonly DEV: boolean;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
