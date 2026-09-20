"use client";

import React from "react";
import { motion } from "framer-motion";

type TDisplayHeader = {
  title: string;
  subTitle: string;
};

export const DisplayHeader = ({ subTitle, title }: TDisplayHeader) => {
  return (
    <motion.div
      className="text-center mb-16"
      initial={{ opacity: 0, y: -50 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8 }}
    >
      <h1 className="text-6xl md:text-7xl font-bold text-white mb-4 tracking-tight">
        <span className="bg-gradient-to-br from-amber-50 via-slate-400 to-gray-900 bg-clip-text text-transparent">
          {title}
        </span>
      </h1>
      <p className="text-gray-300 text-xl">{subTitle}</p>
    </motion.div>
  );
};
