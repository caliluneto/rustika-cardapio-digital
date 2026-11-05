const http = require('http');

async function testHttp(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, data: JSON.parse(data) });
        } catch(e) {
          resolve({ statusCode: res.statusCode, data: data });
        }
      });
    }).on('error', err => reject(err));
  });
}

async function run() {
  try {
    const categories = await testHttp('http://localhost:4001/api/categories');
    console.log('--- CATEGORIES ---');
    console.log(JSON.stringify(categories, null, 2));

    const products = await testHttp('http://localhost:4001/api/products?limit=5');
    console.log('\n--- PRODUCTS (limit 5) ---');
    console.log(JSON.stringify(products, null, 2));

    const product1 = await testHttp('http://localhost:4001/api/products/rustika-PA062240');
    console.log('\n--- PRODUCT (PA062240) ---');
    console.log(JSON.stringify(product1, null, 2));

    const product2 = await testHttp('http://localhost:4001/api/products/rustika-BALY2L');
    console.log('\n--- PRODUCT (BALY2L) ---');
    console.log(JSON.stringify(product2, null, 2));

  } catch (error) {
    console.error(error);
  }
}

run();
