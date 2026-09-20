"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

type TAnimatedSymbols = {
  hide?: boolean;
};

const CARD_SYMBOLS = ["♠", "♥", "♣", "♦"] as const;

export const AnimatedSymbols = ({ hide }: TAnimatedSymbols) => (
  <motion.div
    className={cn("gap-2 text-lg", hide ? "hidden" : "flex")}
    initial="hidden"
    animate="visible"
    variants={{
      visible: {
        transition: {
          staggerChildren: 0.2,
          repeat: Infinity,
        },
      },
    }}
  >
    {CARD_SYMBOLS.map((symbol) => (
      <motion.span
        key={symbol}
        className={cn(
          symbol === "♦" || symbol === "♥"
            ? "text-red-500/60"
            : "text-black/60",
        )}
        variants={{
          hidden: { opacity: 0, y: 8 },
          visible: {
            opacity: 1,
            y: 0,
            transition: {
              repeat: Infinity,
              repeatType: "reverse",
              duration: 0.5,
            },
          },
        }}
        aria-hidden="true"
      >
        {symbol}
      </motion.span>
    ))}
  </motion.div>
);
