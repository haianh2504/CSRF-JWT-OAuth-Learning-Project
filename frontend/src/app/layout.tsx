import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Auth Lab — JWT & OAuth Mock Shop",
  description: "Tìm hiểu luồng đăng nhập, OAuth và JWT qua một cửa hàng mô phỏng."
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
