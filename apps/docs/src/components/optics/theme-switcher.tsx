"use client";

import { useControlledState } from "@/hooks/use-controlled-state";
import { Moon, Sun } from "lucide-react";
import { LazyMotion, domMax, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { useCallback } from "react";
import type { ComponentPropsWithoutRef, Ref } from "react";
import { cn } from "@/lib/utils";

const themes = [
  {
    key: "light",
    icon: Sun,
    label: "Light theme",
  },
  {
    key: "dark",
    icon: Moon,
    label: "Dark theme",
  },
] as const;

type ThemeKey = (typeof themes)[number]["key"];

type ThemeSwitcherProps = Omit<ComponentPropsWithoutRef<"div">, "onChange"> & {
  ref?: Ref<HTMLDivElement>;
  value?: ThemeKey;
  onChange?: (theme: ThemeKey) => void;
  defaultValue?: ThemeKey;
};

export function ThemeSwitcher({
  value = undefined,
  onChange = undefined,
  defaultValue = "light",
  className = "",
  ref,
  ...props
}: ThemeSwitcherProps) {
  const [theme, setTheme] = useControlledState({
    defaultValue: defaultValue,
    value: value,
    onChange,
  });
  const shouldReduceMotion = useReducedMotion();

  const handleThemeClick = useCallback(
    (themeKey: ThemeKey) => {
      setTheme(themeKey);
    },
    [setTheme],
  );

  return (
    <div
      ref={ref}
      className={cn(
        "relative isolate flex h-8 rounded-full squircle-none bg-background p-1 ring-1 ring-border",
        className,
      )}
      {...props}
    >
      <LazyMotion features={domMax} strict>
        {themes.map(({ key, icon: Icon, label }) => {
          const isActive = theme === key;

          return (
            <button
              key={key}
              aria-label={label}
              className="relative size-6 rounded-full squircle-none"
              onClick={() => handleThemeClick(key)}
              type="button"
            >
              {isActive && (
                <m.div
                  className="absolute inset-0 rounded-full squircle-none bg-secondary"
                  layoutId="activeTheme"
                  transition={
                    shouldReduceMotion
                      ? { duration: 0 }
                      : { type: "spring", duration: 0.5 }
                  }
                />
              )}
              <Icon
                className={cn(
                  "relative z-10 m-auto h-4 w-4",
                  isActive ? "text-foreground" : "text-muted-foreground",
                )}
              />
            </button>
          );
        })}
      </LazyMotion>
    </div>
  );
}
