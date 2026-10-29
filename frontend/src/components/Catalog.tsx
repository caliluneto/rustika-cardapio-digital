import { useEffect, useRef, useState } from 'react';
import type { Category, Product } from '../types/catalog';
import CategoryNav from './CategoryNav';
import ProductCard from './ProductCard';
import ProductModal from './ProductModal';

interface CatalogProps {
  categories: readonly Category[];
  products: readonly Product[];
  productDialogOpen: boolean;
  onOpenProduct: () => void;
  onCloseProduct: () => void;
  onViewCart: (trigger: HTMLButtonElement | null) => void;
}

export default function Catalog({ categories, products, productDialogOpen, onOpenProduct, onCloseProduct, onViewCart }: CatalogProps) {
  const [selectedCategoryId, setSelectedCategoryId] = useState<Category['id'] | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const orderedCategories = [...categories].sort((a, b) => a.displayOrder - b.displayOrder);
  const selectedCategory = categories.find((category) => category.id === selectedCategoryId);
  const visibleProducts = selectedCategoryId === null
    ? products
    : products.filter((product) => product.categoryId === selectedCategoryId);
  const currentProduct = selectedProduct && visibleProducts.find((product) => product.id === selectedProduct.id);

  useEffect(() => {
    if (selectedProduct && !currentProduct) {
      setSelectedProduct(null);
      if (productDialogOpen) onCloseProduct();
    }
  }, [selectedProduct, currentProduct, productDialogOpen, onCloseProduct]);

  return (
    <section className="catalog container" id="catalog" tabIndex={-1} aria-labelledby="catalog-title">
      <div className="catalog-heading">
        <div>
          <p className="eyebrow">Rústika Estúdio Bar</p>
          <h2 id="catalog-title">Nosso menu</h2>
          <p>Escolha uma categoria e descubra as opções do cadastro Rústika.</p>
        </div>
        <span className="catalog-tag">{products.length} itens · {categories.length} categorias</span>
      </div>

      <p className="category-nav-hint" id="category-nav-hint">Deslize as categorias para ver mais opções. No teclado, navegue com Tab e selecione com Enter ou Espaço.</p>
      <CategoryNav categories={orderedCategories} selectedCategoryId={selectedCategoryId} onSelect={setSelectedCategoryId} />

      <div className="catalog-results-heading">
        <p className="category-description">{selectedCategory?.description ?? 'Todos os itens da seleção aprovada, com valores de venda da planilha de referência.'}</p>
        <p className="product-count" role="status" aria-live="polite" aria-atomic="true">
          <span className="sr-only">{selectedCategory?.name ?? 'Todas as categorias'}: </span>
          {visibleProducts.length} {visibleProducts.length === 1 ? 'opção' : 'opções'}
        </p>
      </div>

      <ul className="product-grid" id="catalog-products" aria-label={selectedCategory?.name ?? 'Todos os produtos'}>
        {visibleProducts.map((product) => (
          <li key={product.id}>
            <ProductCard product={product} categoryName={categories.find((category) => category.id === product.categoryId)?.name ?? 'Cardápio'} onSelect={(item, trigger) => { triggerRef.current = trigger; setSelectedProduct(item); onOpenProduct(); }} />
          </li>
        ))}
      </ul>
      {visibleProducts.length === 0 && <p className="catalog-empty">Nenhum produto nesta categoria por enquanto. Explore as outras opções.</p>}
      <p className="catalog-source-note">Preços do cadastro de referência. As descrições presentes vêm do cardápio impresso; fotografias de produtos e informações não confirmadas foram omitidas. Estoque e disponibilidade não são verificados nesta demonstração.</p>
      {productDialogOpen && currentProduct && <ProductModal product={currentProduct} categoryName={categories.find((category) => category.id === currentProduct.categoryId)?.name ?? 'Cardápio'} trigger={triggerRef.current} onClose={() => { setSelectedProduct(null); onCloseProduct(); }} onViewCart={() => { setSelectedProduct(null); onViewCart(triggerRef.current); }} />}
    </section>
  );
}
