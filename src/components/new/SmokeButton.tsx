"use client";

import { cn } from "@/lib/utils";
import { motion, type Variants } from "framer-motion";

const smokeVariants: Variants = {
  initial: {
    opacity: 1,
    filter: "blur(0px)",
    scale: 1,
    y: 0,
  },
  active: {
    opacity: 0,
    filter: "blur(12px)",
    scale: 1.6,
    y: 0,
    transition: {
      duration: 0.8,
      ease: [0.16, 1, 0.3, 1],
    },
  },
};

type TSmokeButton = {
  textLabel: string;
  onClick?: () => void;
  isMobile?: boolean;
  className?: string;
  isActive?: boolean;
  spanStyle?: string;
  disabled?: boolean;
};

export const SmokeButton = ({
  textLabel,
  onClick,
  isMobile,
  className,
  spanStyle,
  isActive = false,
  disabled,
}: TSmokeButton) => {
  if (isMobile) {
    return (
      <motion.button
        type="button"
        onClick={onClick}
        disabled={disabled}
        whileTap={{
          scale: 0.96,
          opacity: 0.7,
        }}
        transition={{
          duration: 0.15,
          ease: [0.4, 0, 0.2, 1],
        }}
        className={cn(
          "text-white text-center px-4 py-2 rounded-lg transition-colors relative overflow-hidden hover:cursor-pointer",
          isActive && "bg-white/20",
          className,
        )}
      >
        {isActive && (
          <motion.div
            layoutId="mobile-active-tab"
            className="absolute inset-0 bg-white/10 rounded-lg"
            transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
          />
        )}
        <span className="relative z-10">{textLabel}</span>
      </motion.button>
    );
  }

  return (
    <button
      onClick={onClick}
      type="button"
      disabled={disabled}
      className={cn(
        "relative flex self-center px-4 py-1 rounded-lg min-w-[80px] justify-center hover:cursor-pointer",
        disabled && "opacity-50 cursor-not-allowed",
        className,
      )}
    >
      <motion.span
        variants={smokeVariants}
        initial="initial"
        animate={isActive ? "active" : "initial"}
        className={cn("text-black text-center font-medium", spanStyle)}
      >
        {textLabel}
      </motion.span>

      {isActive && (
        <motion.div
          className="absolute inset-0 flex flex-col items-center justify-center gap-1"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{
            delay: 0.5,
            duration: 0.4,
            ease: "easeOut",
          }}
        >
          <motion.span
            className="text-sm"
            initial={{ y: -10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{
              delay: 0.6,
              duration: 0.3,
              ease: "easeOut",
            }}
          >
            ♦️
          </motion.span>

          <motion.div
            layoutId="desktop-active-tab"
            className="h-0.5 bg-black rounded-full"
            initial={{ width: 0 }}
            animate={{ width: "60%" }}
            transition={{
              delay: 0.5,
              duration: 0.3,
              ease: "easeOut",
            }}
          />
        </motion.div>
      )}
    </button>
  );
};
