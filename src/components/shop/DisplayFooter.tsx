"use client";

import React from "react";
import { Award } from "lucide-react";
import { motion } from "framer-motion";

export const DisplayFooter = () => {
  return (
    <motion.div
      className="text-center mt-16"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 1 }}
    >
      <p className="text-gray-400 flex items-center justify-center gap-2">
        <Award className="w-5 h-5" />
        Todos os produtos são originais e com garantia
        <Award className="w-5 h-5" />
      </p>
      <a
        href="/politica-de-privacidade"
        className="text-muted-foreground hover:text-primary text-xs transition-colors mt-4 inline-block"
      >
        Política de Privacidade
      </a>
    </motion.div>
  );
};
