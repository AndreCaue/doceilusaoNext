"use client";

import { cn } from "@/lib/utils";
import { motion, useAnimation, type Variants } from "framer-motion";

const smokeVariants: Variants = {
  initial: {
    opacity: 1,
    filter: "blur(0px)",
    scale: 1,
    y: 0,
  },
  hover: {
    opacity: 0,
    filter: "blur(12px)",
    scale: 1.6,
    y: 0,
    transition: {
      duration: 2,
      ease: [0.16, 1, 0.3, 1],
    },
  },
};

type TSmokeLink = {
  textLabel: string;
  goTo: string;
  isMobile?: boolean;
  onClick?: () => void;
  className?: string;
  textClass?: string;
  background?: "dark" | "light";
};

export const SmokeLink = ({
  goTo,
  textLabel,
  isMobile,
  background = "dark",
  textClass,
  className,
  onClick,
}: TSmokeLink) => {
  const controls = useAnimation();

  if (isMobile)
    return (
      <motion.div
        whileTap={{
          scale: 0.96,
          opacity: 0.7,
          filter: "blur(1.5px)",
        }}
        className={className}
        transition={{
          duration: 0.15,
          ease: [0.4, 0, 0.2, 1],
        }}
      >
        <a
          href={goTo}
          className={cn(
            "text-center block",
            background === "dark" ? "text-white" : "text-black",
            textClass,
          )}
        >
          {textLabel}
        </a>
      </motion.div>
    );

  // Desktop
  return (
    <div
      className={cn("relative flex self-center", className)}
      onMouseEnter={() => controls.start("hover")}
      onMouseLeave={() => controls.start("initial")}
    >
      <motion.div
        variants={smokeVariants}
        initial="initial"
        animate={controls}
        onClick={onClick}
      >
        <a
          href={goTo}
          className={cn(
            "text-center flex",
            background === "dark" ? "text-white" : "text-black",
            textClass,
          )}
        >
          {textLabel}
        </a>
      </motion.div>
    </div>
  );
};
