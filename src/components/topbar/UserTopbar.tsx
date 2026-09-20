"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { User2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type TValue = {
  value: number;
  text: string;
};

type TCustomValue = TValue & {
  disabled?: boolean;
  // When present the menu item renders as a link (Radix asChild) — nav entries
  // like "Pedidos" point at their page instead of being dead options.
  href?: string;
};

type TUserTopbar = {
  label?: string;
  options: TCustomValue[];
  userEmail?: string;
  isGuest?: boolean;
  onChangeValue?: () => void;
  onSelect?: (value: TValue) => void;
  className?: string;
};

export const UserTopbar = ({
  options,
  onSelect,
  userEmail = "",
  isGuest = true,
  className,
}: TUserTopbar) => {
  const ref = useRef<HTMLButtonElement>(null);
  const [size, setSize] = useState(0);

  useEffect(() => {
    if (!ref.current) return;

    const observer = new ResizeObserver(([entry]) => {
      setSize(entry.contentRect.width);
    });

    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  if (isGuest) {
    return (
      <div className="hidden lg:flex items-center gap-2">
        <a
          href="/login"
          className="px-4 py-1.5 text-sm font-medium border-2 border-black rounded-md
                     hover:bg-black hover:text-white transition-colors active:scale-95 cursor-pointer"
        >
          Entrar
        </a>
        <a
          href="/register"
          className="px-4 py-1.5 text-sm font-medium bg-black text-white rounded-md
                     hover:bg-gray-800 transition-colors active:scale-95 cursor-pointer"
        >
          Registrar
        </a>
      </div>
    );
  }

  /* ── Modo autenticado ── */
  return (
    <div className="hidden lg:flex  w-[200px] justify-between">
      <DropdownMenu>
        <span className="hidden lg:flex lg:flex-col lg:text-center text-sm text-gray-600">
          Seja Bem Vindo!
          <span className="truncate w-12 mx-auto">{userEmail}</span>
        </span>
        <DropdownMenuTrigger
          ref={ref}
          className={cn(
            "relative p-2 rounded-lg  cursor-pointer transition-colors active:scale-95 ",
            className,
          )}
        >
          <User2 className="w-5 h-5 text-gray-700 " />
        </DropdownMenuTrigger>

        <DropdownMenuContent
          side="right"
          style={{ minWidth: `${size}px` }}
          className={cn("bg-white my-1 border-2 border-black   gap-2 grid")}
        >
          {options.map((opt, idx) => (
            <DropdownMenuItem
              key={idx}
              className="hover:bg-black hover:text-white hover:disabled:cursor-none hover:cursor-pointer border border-black flex justify-center"
              onSelect={() => onSelect?.(opt)}
              disabled={opt?.disabled}
              asChild={Boolean(opt.href)}
            >
              {opt.href ? (
                <a href={opt.href} className="w-full text-center">
                  {opt.text}
                </a>
              ) : (
                opt.text
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};
