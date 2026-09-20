"use client";

import React from "react";
import { AnimatePresence, easeInOut, motion } from "framer-motion";
import { ProductSection } from "./ProductSection";
import type { CatalogProduct } from "@/lib/types/catalog";

type TProductPage = {
  selectedCategory: string;
  data: CatalogProduct[];
};

const pageVariants = {
  initial: { opacity: 0, y: 30 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -30 },
};
const pageTransition = {
  duration: 0.6,
  ease: easeInOut,
};

export const ProductPage = ({ selectedCategory, data }: TProductPage) => {
  const currentProduct = data.filter(
    (prod) => prod.category.name === selectedCategory,
  );

  return (
    <AnimatePresence mode="sync">
      <motion.div
        key={selectedCategory}
        variants={pageVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={pageTransition}
      >
        <ProductSection products={currentProduct} />
      </motion.div>
    </AnimatePresence>
  );
};
