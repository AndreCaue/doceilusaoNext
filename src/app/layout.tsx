import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Doce Ilusao",
  description: "Plataforma de e-commerce de produtos de magica",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
