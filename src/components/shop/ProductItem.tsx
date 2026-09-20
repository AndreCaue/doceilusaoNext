"use client";

import { motion } from "framer-motion";
import { cardMotion, glowMotion } from "./helper";
import type { CatalogProduct } from "@/lib/types/catalog";

type TProductItem = Pick<
  CatalogProduct,
  | "id"
  | "name"
  | "price"
  | "reserved_stock"
  | "stock"
  | "discount"
  | "image_urls"
>;

export const ProductItem = ({
  id,
  image_urls,
  name,
  price,
  reserved_stock,
  stock,
  discount,
}: TProductItem) => {
  const image = image_urls?.[0] ?? "";
  const hasValidStock = stock > reserved_stock;

  return (
    <motion.div
      key={id}
      className="group relative perspective-[1400px]"
      initial="rest"
      whileHover="hover"
      animate="rest"
    >
      <motion.div
        variants={glowMotion}
        className="pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-br from-purple-600/20 via-transparent to-fuchsia-600/10"
      />

      <motion.a
        variants={cardMotion}
        href={`/loja/produto/${id}`}
        className="bg-neutral-900/60 backdrop-blur-md border border-white/5 rounded-xl overflow-hidden shadow-2xl cursor-pointer block"
      >
        <div className="aspect-[3/4] relative overflow-hidden bg-black/40">
          <motion.img
            src={image}
            alt={name}
            className="h-full w-full object-cover opacity-90 group-hover:opacity-100 transition-opacity duration-700"
            whileHover={{ scale: 1.08 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          />
          {!hasValidStock && (
            <div className="absolute z-10 bg-red-500 text-white h-fit w-full right-0 bottom-0 top-50 text-center">
              Estoque indisponível no momento.
            </div>
          )}
        </div>
        {Number(discount) > 99 ? (
          <span className="absolute top-6 -right-3 rotate-45 w-24 h-6 text-center bg-green-500 text-white rouded-t-2xl">
            FRETE
            <p className="bg-white text-green-500 rounded-b-2xl">GRÁTIS</p>
          </span>
        ) : (
          <span className="absolute top-6 -right-3 rotate-45 w-24 h-6 text-center bg-green-500 text-white rouded-t-2xl">
            Ganhe R${discount}{" "}
            <p className="bg-white text-green-500 rounded-b-2xl">NO FRETE</p>
          </span>
        )}

        <div className="p-6 text-center space-y-4">
          <h3 className="text-lg font-light text-white/90 tracking-wide min-h-[2.8em]">
            {name}
          </h3>

          <div className="text-2xl font-light text-white">
            R$ {price.toFixed(2)}
          </div>
        </div>
      </motion.a>
    </motion.div>
  );
};
