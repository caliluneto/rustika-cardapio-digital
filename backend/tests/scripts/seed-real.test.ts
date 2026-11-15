import { describe, it, expect } from 'vitest';
import { parsePrice, classifyProduct, validateAllPrices, generateClassificationReport as generateReport } from '../../scripts/seed-real';
import { syntheticCatalogPath } from '../helpers/catalog-sources';
import { SYNTHETIC_EXPECTED } from '../fixtures/catalog/synthetic-catalog';

// Usa a fixture SINTETICA (mesma forma da planilha real). As asserções equivalentes sobre a planilha
// real ficam em private-catalog.test.ts e só rodam onde ela existe.
const generateClassificationReport = () => generateReport(syntheticCatalogPath);

describe('parsePrice', () => {
  it('numero inteiro', () => expect(parsePrice(10).toFixed(2)).toBe('10.00'));
  it('decimal', () => expect(parsePrice(12.5).toFixed(2)).toBe('12.50'));
  it('string ponto', () => expect(parsePrice('25.99').toFixed(2)).toBe('25.99'));
  it('string virgula', () => expect(parsePrice('25,99').toFixed(2)).toBe('25.99'));
  it('arredonda 28.9034', () => expect(parsePrice(28.9034).toFixed(2)).toBe('28.90'));
  it('arredonda 33.8123', () => expect(parsePrice(33.8123).toFixed(2)).toBe('33.81'));
  it('arredonda 16.8107', () => expect(parsePrice(16.8107).toFixed(2)).toBe('16.81'));
  it('zero', () => expect(parsePrice(0).toFixed(2)).toBe('0.00'));
  it('string 0.01', () => expect(parsePrice('0.01').toFixed(2)).toBe('0.01'));
  it('ieee754 0.3+', () => expect(parsePrice(0.30000000000000004).toFixed(2)).toBe('0.30'));
  it('rejeita vazio', () => expect(()=>parsePrice('')).toThrow('vazio'));
  it('rejeita null', () => expect(()=>parsePrice(null)).toThrow('nulo'));
  it('rejeita undefined', () => expect(()=>parsePrice(undefined)).toThrow('nulo'));
  it('rejeita negativo', () => expect(()=>parsePrice(-1)).toThrow('negativo'));
  it('rejeita str negativa', () => expect(()=>parsePrice('-10.50')).toThrow('invalidos'));
  it('rejeita multi pontos', () => expect(()=>parsePrice('1.234.56')).toThrow('multiplos'));
  it('rejeita chars', () => expect(()=>parsePrice('10.50 r')).toThrow('invalidos'));
  it('rejeita NaN', () => expect(()=>parsePrice(NaN)).toThrow('finito'));
  it('rejeita Inf', () => expect(()=>parsePrice(Infinity)).toThrow('finito'));
  it('rejeita obj', () => expect(()=>parsePrice({})).toThrow('invalido'));
});

describe('classifyProduct', () => {
  it('0.01->INSUMO',()=>expect(classifyProduct('212','GELO CONSUMO INSUMO','INSUMO',0.01)).toBe('INSUMO'));
  it('BALY 2L->COMERCIALIZADO',()=>expect(classifyProduct('44','BALY 2L','INSUMO',26)).toBe('COMERCIALIZADO'));
  it('PANCETA->COMERCIALIZADO',()=>expect(classifyProduct('X','PANCETA SUINA','INSUMO',50)).toBe('COMERCIALIZADO'));
  it('bebida preparo->INSUMO',()=>expect(classifyProduct('X','SAGATIBA 700ML','INSUMO',20.55)).toBe('INSUMO'));
  it('GELO BALDE->COMERCIALIZADO',()=>expect(classifyProduct('47','GELO (BALDE)','DIVERSOS',5)).toBe('COMERCIALIZADO'));
  it('CDB->INCERTO',()=>expect(classifyProduct('45','CDB','DIVERSOS',6)).toBe('INCERTO'));
  it('CHICLETE->INCERTO',()=>expect(classifyProduct('46','CHICLETE','DIVERSOS',5)).toBe('INCERTO'));
  it('HALLS->INCERTO',()=>expect(classifyProduct('52','HALLS','DIVERSOS',5)).toBe('INCERTO'));
  it('GUARDA VOLUME->INCERTO',()=>expect(classifyProduct('51','GUARDA VOLUME','DIVERSOS',5)).toBe('INCERTO'));
  it('PALHEIRO->INCERTO',()=>expect(classifyProduct('54','PALHEIRO','DIVERSOS',4)).toBe('INCERTO'));
  it('ISQUEIRO->INCERTO',()=>expect(classifyProduct('53','ISQUEIRO MACARICO','DIVERSOS',10)).toBe('INCERTO'));
});

describe('generateClassificationReport', () => {
  it('174 registros (todos os ativos)',async()=>{const r=await generateClassificationReport();expect(r).toHaveLength(174);});
  it('campos obrigatorios',async()=>{
    const r=await generateClassificationReport();
    r.forEach((x:any)=>{
      expect(x).toHaveProperty('codigo');expect(x).toHaveProperty('nome');
      expect(x).toHaveProperty('grupo');expect(x).toHaveProperty('preco');
      expect(['COMERCIALIZADO','INSUMO','INCERTO']).toContain(x.classificacao);
    });
  });
  it('grupos INSUMO e DIVERSOS',async()=>{
    const r=await generateClassificationReport();
    const gs=new Set(r.map((x:any)=>x.grupo));
    expect(gs.has('INSUMO')).toBe(true);expect(gs.has('DIVERSOS')).toBe(true);
  });
  it('preco 0.01->INSUMO',async()=>{
    const r=await generateClassificationReport();
    r.filter((x:any)=>x.preco===0.01).forEach((x:any)=>expect(x.classificacao).toBe('INSUMO'));
  });
  it('precos parseaveis',async()=>{
    const r=await generateClassificationReport();
    r.forEach((x:any)=>expect(()=>parsePrice(x.preco)).not.toThrow());
  });
  it('BALY 2L (sintetico) comercializado',async()=>{
    const r=await generateClassificationReport();
    const b=r.find((x:any)=>x.nome===SYNTHETIC_EXPECTED.balyName);
    expect(b).toBeDefined();expect(b?.classificacao).toBe('COMERCIALIZADO');
  });
  it('PANCETA (sintetico) comercializado',async()=>{
    const r=await generateClassificationReport();
    const p=r.find((x:any)=>x.nome===SYNTHETIC_EXPECTED.pancetaName);
    expect(p).toBeDefined();expect(p?.classificacao).toBe('COMERCIALIZADO');
  });
  it('incertos presentes',async()=>{
    const r=await generateClassificationReport();
    expect(r.filter((x:any)=>x.classificacao==='INCERTO').length).toBeGreaterThan(0);
  });
  it('preserva IDs ERP',async()=>{
    const r=await generateClassificationReport();
    expect(r.find((x:any)=>x.codigo==='44')).toBeDefined();
    expect(r.find((x:any)=>x.codigo==='47')).toBeDefined();
  });
});

describe('validateAllPrices', () => {
  it('sem erros nos precos ativos',async()=>{
    await expect(validateAllPrices(syntheticCatalogPath)).resolves.not.toThrow();
  });
});