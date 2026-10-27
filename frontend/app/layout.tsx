import type { Metadata } from 'next'; import './globals.css';
export const metadata: Metadata = {title:'SkyMate | Airline Assistant',description:'AI-powered airline search and reservation assistant'};
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="en"><body>{children}</body></html>; }
