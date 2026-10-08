/** 現在時刻の取得を差し替えられるようにするための口。ドメイン規則は Date.now() を直接呼ばない。 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export function fixedClock(at: Date | string): Clock {
  const fixed = new Date(at);
  return { now: () => new Date(fixed) };
}
