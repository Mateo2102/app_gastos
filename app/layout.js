import { Fira_Sans, Fira_Code } from "next/font/google";
import "./globals.css";

const sans = Fira_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-sans", display: "swap" });
const mono = Fira_Code({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata = {
  title: "Tablero de Control de Gastos",
  description: "Tablero de control de gastos personal",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
