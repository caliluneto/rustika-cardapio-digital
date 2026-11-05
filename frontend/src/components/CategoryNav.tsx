import type { Category } from '../types/catalog';

interface CategoryNavProps {
  categories: readonly Category[];
  selectedCategoryId: Category['id'] | null;
  onSelect: (categoryId: Category['id'] | null) => void;
}

export default function CategoryNav({ categories, selectedCategoryId, onSelect }: CategoryNavProps) {
  return (
    <nav className="category-nav" aria-label="Filtrar cardápio por categoria" aria-describedby="category-nav-hint">
      <button type="button" className="category-button" aria-pressed={selectedCategoryId === null} aria-controls="catalog-products" onClick={() => onSelect(null)}>
        <span aria-hidden="true">≡</span> Todos
      </button>
      {categories.map((category) => (
        <button key={category.id} type="button" className="category-button" aria-pressed={selectedCategoryId === category.id} aria-controls="catalog-products" onClick={() => onSelect(category.id)}>
          {category.name}
        </button>
      ))}
    </nav>
  );
}
