import request from "supertest";
import { createApp } from "../src/app";

const app = createApp();

async function validateAPI() {
  console.log("Testing GET /api/categories...");
  const catRes = await request(app).get("/api/categories");
  console.log(`Categories Status: ${catRes.status}`);
  console.log(`Categories Count: ${catRes.body.data?.length}`);
  
  console.log("Testing GET /api/products...");
  const prodRes = await request(app).get("/api/products");
  console.log(`Products Status: ${prodRes.status}`);
  console.log(`Products Count: ${prodRes.body.data?.length}`);
  
  // Find specific products
  const products = prodRes.body.data || [];
  const pBaly = products.find((p: any) => p.name.includes("BALY 2L"));
  const pGelo = products.find((p: any) => p.name.includes("GELO"));
  const pPA = products.find((p: any) => p.name.includes("PA062240") || p.id === "rustika-PA062240" || (p.publicKey && p.publicKey.includes("PA062240")));
  
  console.log("BALY 2L:", pBaly ? { id: pBaly.id, name: pBaly.name, price: pBaly.price } : "Not found");
  console.log("GELO (BALDE):", pGelo ? { id: pGelo.id, name: pGelo.name, price: pGelo.price } : "Not found");
  console.log("PA062240:", pPA ? { id: pPA.id, name: pPA.name, price: pPA.price, publicKey: pPA.publicKey } : "Not found");
  
  // Test a single product endpoint
  if (pBaly) {
    console.log(`Testing GET /api/products/${pBaly.id}...`);
    const singleRes = await request(app).get(`/api/products/${pBaly.id}`);
    console.log(`Single Product Status: ${singleRes.status}`);
    console.log(`Single Product Name: ${singleRes.body.data?.name}`);
  }
}

validateAPI().catch(console.error);
