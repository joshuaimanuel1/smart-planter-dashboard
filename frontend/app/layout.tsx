import "./globals.css";
export const metadata = {
  title: "Smart Indoor Planter",
  description: "Monitoring & otomasi tanaman indoor berbasis ESP32",
};
const init = `try{var t=localStorage.getItem("theme");if(t==="dark"||(!t&&matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.classList.add("dark")}catch(e){}`;
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id" suppressHydrationWarning>
      <head>
        <meta name="color-scheme" content="light dark" />
        <script dangerouslySetInnerHTML={{ __html: init }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
