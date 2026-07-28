import type { Metadata } from "next";
import "@fontsource/noto-sans/400.css";
import "@fontsource/noto-sans/400-italic.css";
import "@fontsource/noto-sans/700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenReview Live Preview",
  description:
    "An independent, unofficial live preview compatible with OpenReview Markdown and TeX.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
