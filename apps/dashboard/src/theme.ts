import { createTheme, type MantineColorsTuple } from "@mantine/core";

/**
 * 画面全体の見た目の決めごと。部品ごとに指定せず、ここで決める。
 *
 * 考え方: このダッシュボードは「進行表」。夜の対戦枠を、時刻の順に追いかけて、挙手を見て、マッチング処理を行い、結果を入れる。
 * - 時刻が、画面の目印になる（大きく、数字をそろえて出す）
 * - 箱で区切らず、細い線で区切る。強調の色は、コバルト 1 色だけ
 * - 取り消せない操作は、普段は静かに（赤い文字だけ）。押したときに、確認を出す
 */
const cobalt: MantineColorsTuple = ["#EEF3FF", "#DCE6FF", "#BACCFF", "#92ACFF", "#6D8DFA", "#4F72F0", "#2F54EB", "#2745C4", "#1E369B", "#162774"];

export const theme = createTheme({
  colors: { cobalt },
  primaryColor: "cobalt",
  primaryShade: { light: 6, dark: 4 },
  defaultRadius: "sm",
  fontFamily: '"IBM Plex Sans JP", system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif',
  fontSizes: { xs: "12px", sm: "13px", md: "14px", lg: "16px", xl: "20px" },
  headings: {
    fontFamily: '"IBM Plex Sans JP", system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif',
    fontWeight: "600",
    sizes: { h1: { fontSize: "22px", lineHeight: "1.3" }, h2: { fontSize: "15px", lineHeight: "1.4" }, h3: { fontSize: "13px", lineHeight: "1.4" } },
  },
  respectReducedMotion: true,
  components: {
    // 入力欄とボタンは、同じ大きさ（高さ）にそろえる。横に並べても、ガタつかない
    Button: { defaultProps: { size: "sm" } },
    NativeSelect: { defaultProps: { size: "sm" } },
    // 表の中では、文字を折り返さない（幅が足りないときは、表のスクロールで見る）
    Table: { defaultProps: { verticalSpacing: "xs", highlightOnHover: true, style: { whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" } } },
    // 説明は、入力欄の下に出す（説明が折り返しても、横に並べた入力欄の高さがずれない）
    TextInput: { defaultProps: { size: "sm", autoComplete: "off", inputWrapperOrder: ["label", "input", "description", "error"] } },
    Menu: { defaultProps: { transitionProps: { duration: 0 } } },
    // ダイアログの右上の×は、読み上げでも分かるように、名前を付ける
    Modal: { defaultProps: { transitionProps: { duration: 0 }, closeButtonProps: { "aria-label": "閉じる" } } },
    Popover: { defaultProps: { transitionProps: { duration: 0 } } },
  },
});
