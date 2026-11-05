import { useState } from 'react';
import type { Product } from '../types/catalog';

const priceFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

interface ProductCardProps {
  product: Product;
  categoryName: string;
  onSelect: (product: Product, trigger: HTMLButtonElement) => void;
}

export default function ProductCard({ product, categoryName, onSelect }: ProductCardProps) {
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  // The catalog supplies a verified photo; the product name is the fallback alt.
  // Missing or failed photos use the same compact, text-only presentation.
  const imageUrl = product.imageUrl?.trim();
  const imageAlt = product.imageAlt?.trim() || product.name;
  const showImage = Boolean(imageUrl && imageUrl !== failedImageUrl);

  return (
    <article className={`product-card ${showImage ? 'product-card--with-image' : 'product-card--text'}`} aria-labelledby={`product-${product.id}`}>
      {showImage && (
        <div className="product-image-wrap">
          <img
            className="product-image"
            src={imageUrl}
            alt={imageAlt}
            width="640"
            height="400"
            loading="lazy"
            decoding="async"
            onError={() => setFailedImageUrl(imageUrl ?? null)}
          />
        </div>
      )}
      <div className="product-content">
        <div className="product-meta">
          <p className="product-category">{categoryName}</p>
          <span className="product-code"><span className="sr-only">Código de origem: </span><span aria-hidden="true">Cód. </span>{product.sourceCode}</span>
        </div>
        <div className="product-details">
          <h3 id={`product-${product.id}`}><button className="product-card-trigger" type="button" aria-label={`Ver detalhes de ${product.name}`} aria-haspopup="dialog" onClick={(event) => onSelect(product, event.currentTarget)}>{product.name}</button></h3>
          {product.description && <p className="product-description">{product.description}</p>}
        </div>
        <div className="product-bottom">
          <span className="product-price-label" aria-hidden="true">Preço</span>
          <span className="product-price"><span className="sr-only">Preço: </span>{priceFormatter.format(product.priceInCents / 100)}</span>
          {product.isAvailable === false && <span className="product-unavailable">Indisponível</span>}
          {product.isAvailable === null && <span className="product-unavailable">Disponibilidade não confirmada</span>}
        </div>
      </div>
    </article>
  );
}
