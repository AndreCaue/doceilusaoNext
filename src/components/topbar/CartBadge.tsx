"use client";

import { motion } from "framer-motion";

export const CartBadge = ({ count }: { count: number }) => {
  if (count === 0) return null;

  return (
    <motion.span
      initial={{ scale: 0 }}
      animate={{ scale: 1 }}
      className="absolute -top-1 -right-1 flex items-center justify-center bg-red-500 min-w-[18px] h-[18px] px-1 rounded-full text-[11px] font-medium text-white"
    >
      {count > 99 ? "99+" : count}
    </motion.span>
  );
};
