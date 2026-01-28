import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import * as React from "react";
import { RootProvider } from "fumadocs-ui/provider/tanstack";
import appCss from "@/styles/app.css?url";
import { ThemeInitScript } from "@/components/theme-init-script";
import { ThemeProvider } from "@/components/theme-provider";
import { getTheme, type Theme } from "@/lib/theme";

export const Route = createRootRoute({
  loader: () => getTheme(),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Agentrig Docs" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  const initial = Route.useLoaderData() as Theme;
  return (
    <html
      lang="en"
      className={initial === "system" ? "" : initial}
      suppressHydrationWarning
    >
      <head>
        <ThemeInitScript />
        <HeadContent />
      </head>
      <body className="flex min-h-screen flex-col">
        <ThemeProvider initial={initial}>
          <RootProvider theme={{ enabled: false }}>{children}</RootProvider>
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  );
}
