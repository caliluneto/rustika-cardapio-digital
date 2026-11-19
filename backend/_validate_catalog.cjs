const { planHomologCatalogFromFile } = require('./scripts/homolog/catalogHomologImporter');

try {
  const plan = planHomologCatalogFromFile();
  console.log(JSON.stringify({
    totals: plan.totals,
    categories: plan.categories.map(c => ({ name: c.name, publicKey: c.publicKey, displayOrder: c.displayOrder })),
    productCount: plan.products.length,
    productKeys: plan.products.map(p => p.publicKey),
    priceCheck: plan.products.every(p => p.priceInCents > 0),
    categoryKeys: plan.categories.map(c => c.publicKey),
    allCategoriesMatch: plan.categories.map(c => c.publicKey).sort().join(','),
    commercializedCount: plan.products.length,
  }, null, 2));
} catch (error) {
  console.error('ERRO_VALIDACAO:', error.message);
  process.exit(1);
}
