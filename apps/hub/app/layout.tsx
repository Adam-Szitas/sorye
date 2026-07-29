import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { Providers } from '@/components/providers';
import { SdkInit } from '@/components/sdk-init';
import '@sorye/sdk/tokens.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sorye Hub',
  description: 'Your workspace OS — pick apps, connect tools, build your stack.',
};

export const viewport: Viewport = {
  themeColor: '#0b0f17',
  colorScheme: 'dark',
};

/**
 * Strip common extension-injected attributes before React hydrates.
 * (Dark-mode / shopping helpers often add filter:invert(0) and bis_register.)
 */
const EXT_ATTR_GUARD = `(function(){function c(n){var el=n||document;if(el.nodeType===1){if(el.style&&String(el.style.filter).indexOf("invert(0)")!==-1){el.style.removeProperty("filter");if(!(el.getAttribute("style")||"").trim())el.removeAttribute("style")}if(el===document.body||el.tagName==="BODY"){el.removeAttribute("bis_register");el.removeAttribute("cz-shortcut-listen")}}if(!n){c(document.documentElement);if(document.body)c(document.body);document.querySelectorAll("img[style]").forEach(c)}}c();try{var o=new MutationObserver(function(ms){ms.forEach(function(m){if(m.type==="attributes"&&m.target)c(m.target)})});o.observe(document.documentElement,{attributes:true,subtree:true,attributeFilter:["style","bis_register","cz-shortcut-listen"]});addEventListener("DOMContentLoaded",function(){c();setTimeout(function(){o.disconnect()},1500)})}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Script
          id="sorye-ext-attr-guard"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: EXT_ATTR_GUARD }}
        />
        <SdkInit />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
