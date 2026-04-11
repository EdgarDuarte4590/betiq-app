import type { Metadata } from "next";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import ClientLayout from "@/components/ClientLayout";

export const metadata: Metadata = {
  title: "BetIQ — Análisis de Apuestas Deportivas",
  description: "Sistema personal de análisis de apuestas deportivas con value betting, gestión de bankroll y estadísticas en tiempo real.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" data-scroll-behavior="smooth">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body>
        <div style={{ display: 'flex', minHeight: '100vh' }}>
          <Sidebar />
          <ClientLayout>{children}</ClientLayout>
        </div>
      </body>
    </html>
  );
}
