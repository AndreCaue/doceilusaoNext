"use client";
import React from "react";
import { motion } from "framer-motion";

const symbols = ["♠", "♥", "♦", "♣"];

export const SymbolLoading = () => {
  return (
    <div className="flex flex-col items-center justify-center">
      <motion.div
        className="flex gap-3 text-3xl"
        initial="hidden"
        animate="visible"
        variants={{
          visible: {
            transition: {
              staggerChildren: 0.25,
              repeat: Infinity,
            },
          },
        }}
      >
        {symbols.map((symbol) => (
          <motion.span
            key={symbol}
            className="text-white/80"
            variants={{
              hidden: { opacity: 0, y: 10 },
              visible: {
                opacity: 1,
                y: 0,
                transition: {
                  repeat: Infinity,
                  repeatType: "reverse",
                  duration: 0.6,
                },
              },
            }}
          >
            {symbol}
          </motion.span>
        ))}
      </motion.div>
    </div>
  );
};
