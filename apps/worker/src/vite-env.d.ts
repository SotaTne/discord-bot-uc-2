// Vite（apps/dashboard が、worker もビルドする）が、ビルド時に置き換える値の型。
// DEV: 開発のときだけ true。本番のビルドでは false に置き換わり、`if (import.meta.env.DEV)` の中は、コードごと消える。
// （vite の型は、worker の依存ではないので、必要な分だけ、ここで宣言する）
interface ImportMetaEnv {
  readonly DEV: boolean;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
