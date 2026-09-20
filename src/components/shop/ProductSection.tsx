"use client";

import { motion } from "framer-motion";
import { ProductItem } from "./ProductItem";
import type { CatalogProduct } from "@/lib/types/catalog";

type TBrandSectionProps = {
  products: CatalogProduct[];
};

export const ProductSection = ({ products }: TBrandSectionProps) => {
  return (
    <section className="py-24 md:py-32">
      <motion.h2
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, margin: "-100px" }}
        transition={{ duration: 1.4 }}
        className="text-3xl md:text-4xl font-light tracking-widest text-white/90 text-center mb-16 md:mb-24"
      >
        {products[0]?.category?.name}
      </motion.h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-12 md:gap-20 max-w-6xl mx-auto px-6">
        {products?.map((product) => (
          <ProductItem
            id={product.id}
            discount={product.discount ?? 0}
            image_urls={product.image_urls}
            name={product.name}
            reserved_stock={product.reserved_stock}
            stock={product.stock}
            price={product.price}
            key={product.id}
          />
        ))}
      </div>
    </section>
  );
};
