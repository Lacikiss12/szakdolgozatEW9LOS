import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Intelligens Online Vizsgáztató Rendszer',
  description: 'Miskolci Egyetem – online vizsgáztató prototípus',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="hu">
      <body className="bg-gray-900 text-white antialiased">{children}</body>
    </html>
  );
}
