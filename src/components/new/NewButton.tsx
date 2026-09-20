"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

type TNewButton = {
  onClick?: () => void;
  label: string;
  className?: string;
  isSkeletonLoading?: boolean;
  disabled?: boolean;
  typeB?: "button" | "submit" | "reset" | undefined;
  variant?: "default" | "proceed" | "reject" | "ghost";
  icon?: ReactNode;
};

const variantStyles = {
  default: "bg-white hover:bg-slate-100 text-black border border-slate-200",
  proceed:
    "bg-gradient-to-r from-emerald-500 to-green-500 hover:from-emerald-600 hover:to-green-600 text-white border border-green-700",
  reject:
    "bg-gradient-to-r from-red-500 to-rose-500 hover:from-red-600 hover:to-rose-600 text-white border border-red-700",
  ghost: "bg-transparent text-white border hover:bg-black hover:font-bold",
};

export const NewButton = ({
  onClick,
  label,
  className,
  isSkeletonLoading,
  icon,
  typeB,
  disabled,
  variant = "default",
  ...props
}: TNewButton) => {
  return (
    <>
      {isSkeletonLoading ? (
        <>
          <Skeleton className="w-full h-full" />
        </>
      ) : (
        <Button
          onClick={onClick}
          className={cn(
            "w-full h-full lg:hover:scale-105 font-medium text-base rounded-xl shadow-md transition-all cursor-pointer",
            variantStyles[variant],
            className,
          )}
          {...props}
          disabled={disabled}
          type={typeB}
        >
          {icon}
          {label}
        </Button>
      )}
    </>
  );
};
