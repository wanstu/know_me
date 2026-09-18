import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "know_me", template: "%s · know_me" },
  description: "个人主页、博客与浏览器起始页。"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
