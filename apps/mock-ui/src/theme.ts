import { createTheme, type MantineColorsTuple } from "@mantine/core";

/**
 * 疑似 Discord の見た目の決めごと。ダッシュボード（apps/dashboard/src/theme.ts）と、同じにしてある
 * （書体・コバルト 1 色・線で区切る）。別のアプリなので、値だけを写している。
 */
const cobalt: MantineColorsTuple = ["#EEF3FF", "#DCE6FF", "#BACCFF", "#92ACFF", "#6D8DFA", "#4F72F0", "#2F54EB", "#2745C4", "#1E369B", "#162774"];
const font = '"IBM Plex Sans JP", system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif';

export const theme = createTheme({
  colors: { cobalt },
  primaryColor: "cobalt",
  primaryShade: { light: 6, dark: 4 },
  defaultRadius: "sm",
  fontFamily: font,
  headings: { fontFamily: font, fontWeight: "600" },
  respectReducedMotion: true,
  components: {
    Button: { defaultProps: { size: "sm" } },
    NativeSelect: { defaultProps: { size: "sm" } },
    TextInput: { defaultProps: { size: "sm", autoComplete: "off" } },
    Modal: { defaultProps: { transitionProps: { duration: 0 }, closeButtonProps: { "aria-label": "閉じる" } } },
    Table: { defaultProps: { verticalSpacing: "xs", style: { whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" } } },
  },
});
