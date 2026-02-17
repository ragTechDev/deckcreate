import type { Metadata } from "next";
import { ColorSchemeScript, MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { Nunito } from "next/font/google";
import { theme } from './theme';
import { AuthProvider } from './context/AuthContext';
import "./globals.css";
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/carousel/styles.css';

const nunito = Nunito({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
  variable: "--font-nunito",
});

export const metadata: Metadata = {
  title: "Deckcreate - Content Repurposing Tools for Creators",
  description: "Turn YouTube videos into carousels and transcriptions. No AI — just your authentic content, repurposed for every platform.",
  icons: {
    icon: '/favicon.png',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <ColorSchemeScript />
      </head>
      <body className={nunito.variable}>
        <MantineProvider theme={theme}>
          <AuthProvider>
            <Notifications position="top-right" />
            {children}
          </AuthProvider>
        </MantineProvider>
      </body>
    </html>
  );
}
