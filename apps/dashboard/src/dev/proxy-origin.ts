/**
 * 開発中の Vite の proxy で、API に送る Origin を決める。
 *
 * worker は、状態を変える操作の Origin が自分自身のものか確認する（CSRF 対策）。
 * 開発中は、ブラウザの画面が Vite の URL なので、そのままだと確認に通らない。
 * そこで、ブラウザ自身（この dev サーバーの画面）からの Origin だけを、worker の Origin に書き換える。
 * ほかのサイトの Origin は、そのまま渡して、worker に拒否させる。
 */
export function originForWorker(input: { origin: string | undefined; host: string | undefined; workerOrigin: string }): string | undefined {
  if (input.origin !== undefined && input.origin === `http://${input.host}`) {
    return input.workerOrigin;
  }
  return input.origin;
}
