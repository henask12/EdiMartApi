/** Edi's Collection catalog — matches WhatsApp listing style. */
export type CatalogSeedProduct = {
  name: string;
  category: string;
  sellingPrice: number;
  costPrice?: number;
  originCountry?: string;
  description?: string;
  initialQuantity?: number;
  restockAt?: number;
  restockQty?: number;
};

export const CATALOG_CATEGORIES = [
  "Skincare",
  "Cosmetics",
  "Bags",
  "Personal Care",
  "Health & Vitamins",
  "Snacks",
] as const;

export const CATALOG_PRODUCTS: CatalogSeedProduct[] = [
  {
    name: "Mighty Patch Invisible+",
    category: "Skincare",
    sellingPrice: 1000,
    originCountry: "USA",
    description:
      "- Absorbs gunk in 6-8 hours\n- Helps protect from picking and popping\n- Suitable for sensitive skin\n1 pack, 12 pcs",
    initialQuantity: 5,
    restockAt: 2,
    restockQty: 6,
  },
  {
    name: "Maybelline Super Stay Matte Ink — Founder",
    category: "Cosmetics",
    sellingPrice: 2800,
    originCountry: "USA",
    initialQuantity: 4,
    restockAt: 1,
    restockQty: 4,
  },
  {
    name: "Primark Mini Handbag — Chocolate",
    category: "Bags",
    sellingPrice: 4000,
    originCountry: "Italy",
    description: "Chocolate colored mini handbag",
    initialQuantity: 2,
    restockAt: 1,
    restockQty: 2,
  },
  {
    name: "Irish Spring Soap",
    category: "Personal Care",
    sellingPrice: 400,
    originCountry: "USA",
    initialQuantity: 12,
    restockAt: 4,
    restockQty: 12,
  },
  {
    name: "Dove Soap — Original",
    category: "Personal Care",
    sellingPrice: 400,
    originCountry: "USA",
    initialQuantity: 12,
    restockAt: 4,
    restockQty: 12,
  },
  {
    name: "Dove Soap — Sensitive",
    category: "Personal Care",
    sellingPrice: 450,
    originCountry: "USA",
    initialQuantity: 10,
    restockAt: 4,
    restockQty: 12,
  },
  {
    name: "Swisspers Premium Cotton Rounds 100",
    category: "Personal Care",
    sellingPrice: 600,
    originCountry: "USA",
    description:
      "- 100% Cotton\n- Hypoallergenic\n- Dual-sided\n- Lint free\n100 pads",
    initialQuantity: 8,
    restockAt: 3,
    restockQty: 10,
  },
  {
    name: "Vitamin D3 + K2 (5000 IU)",
    category: "Health & Vitamins",
    sellingPrice: 8000,
    originCountry: "USA",
    description:
      "- 125 mcg Vitamin D3 (5000 IU) + 100 mcg K2 (MK-7)\n- 2-in-1 support, one softgel per day\n- Bone and immune health, plant based",
    initialQuantity: 3,
    restockAt: 1,
    restockQty: 3,
  },
  {
    name: "Baby Vitamin D Drops — 120",
    category: "Health & Vitamins",
    sellingPrice: 4500,
    originCountry: "Canada",
    description: "- Starting from newborn\n120 drops",
    initialQuantity: 4,
    restockAt: 1,
    restockQty: 4,
  },
  {
    name: "Baby Vitamin D Drops — 90",
    category: "Health & Vitamins",
    sellingPrice: 4000,
    originCountry: "USA",
    description: "- Starting from newborn\n90 drops",
    initialQuantity: 4,
    restockAt: 1,
    restockQty: 4,
  },
  {
    name: "Magnesium Glycinate 180 caps",
    category: "Health & Vitamins",
    sellingPrice: 6500,
    originCountry: "USA",
    description:
      "- Muscle relaxation, bone, heart and nerve support\n- 240 mg per 2 capsules\n- Non-GMO, vegetarian, no soy, gluten, lactose, fish",
    initialQuantity: 3,
    restockAt: 1,
    restockQty: 3,
  },
  {
    name: "Solubilized Ibuprofen 200 mg (120 caps)",
    category: "Health & Vitamins",
    sellingPrice: 2500,
    originCountry: "USA",
    description:
      "- Liquid-filled capsules\n- Pain reliever / fever reducer (NSAID)\n120 capsules per bottle",
    initialQuantity: 6,
    restockAt: 2,
    restockQty: 4,
  },
  {
    name: "Wonderful Pistachios Salt & Pepper 1.3 kg",
    category: "Snacks",
    sellingPrice: 5000,
    originCountry: "USA",
    description:
      "- Salt, black pepper and garlic seasoned\n- Roasted and salted, in-shell\nSold out at shop - restock when available",
    initialQuantity: 0,
    restockAt: 1,
    restockQty: 2,
  },
];
