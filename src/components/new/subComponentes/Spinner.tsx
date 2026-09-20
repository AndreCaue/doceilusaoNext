"use client";

import { motion } from "framer-motion";

export const Spinner = () => (
  <motion.div
    className="w-4 h-4 rounded-full border-2 border-slate-300 border-t-slate-900"
    animate={{ rotate: 360 }}
    transition={{
      repeat: Infinity,
      duration: 1,
      ease: "linear",
    }}
  />
);
