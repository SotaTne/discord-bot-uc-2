import { describe, expect, it } from "vitest";
import { originForWorker } from "./proxy-origin";

const workerOrigin = "http://localhost:8787";

describe("originForWorker", () => {
  it("ブラウザ自身（この dev サーバー）の Origin は、worker の Origin に書き換える", () => {
    expect(originForWorker({ origin: "http://localhost:5173", host: "localhost:5173", workerOrigin })).toBe(workerOrigin);
  });

  it("dev サーバーのポートが違っても、自分自身なら書き換える", () => {
    expect(originForWorker({ origin: "http://localhost:5174", host: "localhost:5174", workerOrigin })).toBe(workerOrigin);
  });

  it("ほかのサイトの Origin は、書き換えずにそのまま渡す（worker が拒否できるように）", () => {
    expect(originForWorker({ origin: "https://evil.example", host: "localhost:5173", workerOrigin })).toBe("https://evil.example");
    expect(originForWorker({ origin: "http://localhost:9999", host: "localhost:5173", workerOrigin })).toBe("http://localhost:9999");
  });

  it("Origin がなければ、なしのまま（作らない）", () => {
    expect(originForWorker({ origin: undefined, host: "localhost:5173", workerOrigin })).toBeUndefined();
  });
});
