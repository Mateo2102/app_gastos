import "./globals.css";

export const metadata = {
  title: "Tablero de Control de Gastos",
  description: "Tablero de control de gastos personal",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
