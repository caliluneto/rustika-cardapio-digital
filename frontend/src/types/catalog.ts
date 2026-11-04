// Presentation models: categoryId preserves the catalog relationship, without
// exposing persistence fields or depending on the generated database client.
export interface Category {
  id: string;
  name: string;
  description: string;
  displayOrder: number;
}

export interface CatalogData {
  readonly categories: readonly Category[];
  readonly products: readonly Product[];
}

export interface Product {
  id: string;
  sourceCode: string;
  sourceName: string;
  sourceGroup: string;
  categoryId: Category['id'];
  name: string;
  description?: string;
  descriptionSource?: string;
  ingredients?: string;
  // Integer cents represent the database's decimal price without float math.
  priceInCents: number;
  imageUrl?: string;
  imageAlt?: string;
  // Undefined or null means unconfirmed. An active source record is not stock evidence.
  isAvailable?: boolean | null;
}
