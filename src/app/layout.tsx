import "./globals.css";
import Providers from "./providers";

export const metadata = {
  title: "DraftKings Recommendations",
  description: "NBA DraftKings Top 5 efficiency generator",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#1b1c1f] text-white">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
