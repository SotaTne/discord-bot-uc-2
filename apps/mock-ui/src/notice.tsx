import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type NoticeApi = { notify: (text: string) => void };
const NoticeContext = createContext<NoticeApi>({ notify: () => undefined });
export const useNotice = () => useContext(NoticeContext);

/** 失敗したときだけ、画面の上に、理由を出す（10 秒で消える）。成功は、出さない */
export function NoticeProvider({ children }: { children: ReactNode }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (text === null) return;
    const timer = setTimeout(() => setText(null), 10_000);
    return () => clearTimeout(timer);
  }, [text]);

  return (
    <NoticeContext.Provider value={{ notify: setText }}>
      {text !== null && (
        <div role="alert" style={{ position: "fixed", left: "50%", top: 12, transform: "translateX(-50%)", zIndex: 1000, maxWidth: "90vw" }}>
          <div className="surface" style={{ padding: "8px 14px", color: "var(--mantine-color-red-filled)" }}>
            {text}
          </div>
        </div>
      )}
      {children}
    </NoticeContext.Provider>
  );
}
