import { createTheme } from "@mantine/core";

/** 画面全体の見た目の既定。部品ごとに指定せず、ここで決める */
export const theme = createTheme({
  primaryColor: "indigo",
  defaultRadius: "md",
  fontFamily: 'system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif',
  components: {
    Button: { defaultProps: { size: "xs" } },
    Table: { defaultProps: { verticalSpacing: "xs", highlightOnHover: true } },
    Modal: { defaultProps: { transitionProps: { duration: 0 } } },
    Popover: { defaultProps: { transitionProps: { duration: 0 } } },
    Card: { defaultProps: { withBorder: true, padding: "md" } },
  },
});
