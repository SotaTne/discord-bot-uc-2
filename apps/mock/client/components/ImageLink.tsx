import { Image, Modal } from "@mantine/core";
import { useState } from "react";

/** 「画像」の青いリンク。押すと、別のページには移らず、その場のポップアップで、画像を大きく出す */
export function ImageLink({ seq }: { seq: number }) {
  const [opened, setOpened] = useState(false);
  const src = `/mock-api/screenshots/${seq}`;
  return (
    <>
      {/* href を残す: 画面のスクリプトが動かないときも、リンクとして開ける */}
      <a
        className="link-button"
        href={src}
        target="_blank"
        rel="noreferrer"
        onClick={(event) => {
          event.preventDefault();
          setOpened(true);
        }}
      >
        画像
      </a>
      <Modal opened={opened} onClose={() => setOpened(false)} title="画像" size="auto" centered>
        <Image src={src} alt={`勝利#${seq}の画像`} mah="80vh" fit="contain" />
      </Modal>
    </>
  );
}
