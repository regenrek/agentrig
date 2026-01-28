import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { ThemeToggle } from "@/components/ThemeToggle";

export function baseOptions(): BaseLayoutProps {
  return {
    themeSwitch: {
      enabled: true,
      mode: "light-dark-system",
      component: <ThemeToggle />,
    },
    nav: {
      title: "Agentrig",
      url: "/",
    },
    githubUrl: "https://github.com/agentrig/agentrig",
    links: [],
  };
}
