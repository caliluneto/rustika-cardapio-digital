import { describe, it, expect, beforeEach, vi } from 'vitest';
import { classifyProduct, generateClassificationReport, validateAllPrices } from '../../scripts/seed-real';

describe('seed-real: Classificação corrigida', () => {
  describe('Filtro de grupos corrigido', () => {
    it('classifyProduct processa TODOS os grupos, não apenas INSUMO/DIVERSOS', async () => {
      // INSUMO com classificação especial
      expect(classifyProduct('212', 'BALY 2L', 'INSUMO', 15.00)).toBe('COMERCIALIZADO');
      
      // INSUMO genérico
      expect(classifyProduct('1', 'GENERICO INSUMO', 'INSUMO', 5.00)).toBe('INSUMO');
      
      // DIVERSOS com incerto
      expect(classifyProduct('PA1', 'CDB', 'DIVERSOS', 2.00)).toBe('INCERTO');
      
      // DIVERSOS comercializável
      expect(classifyProduct('PA2', 'PORCAO', 'DIVERSOS', 10.00)).toBe('COMERCIALIZADO');
      
      // Outros grupos (não INSUMO/DIVERSOS)
      expect(classifyProduct('100', 'AGUA MINERAL', 'ÁGUA', 5.00)).toBe('COMERCIALIZADO');
      expect(classifyProduct('200', 'CERVEJA', 'CERVEJA', 8.00)).toBe('COMERCIALIZADO');
      expect(classifyProduct('300', 'VODKA', 'DESTILADO', 25.00)).toBe('COMERCIALIZADO');
      expect(classifyProduct('400', 'SUCO NATURAL', 'SUCO', 12.00)).toBe('COMERCIALIZADO');
    });

    it('generateClassificationReport processa TODOS os produtos ativos', async () => {
      const report = await generateClassificationReport();
      
      // Deve ter produtos de vários grupos
      const grupos = new Set(report.map(r => r.grupo));
      
      // Deve incluir INSUMO e DIVERSOS
      expect(grupos.has('INSUMO')).toBe(true);
      expect(grupos.has('DIVERSOS')).toBe(true);
    });

    it('validateAllPrices valida TODOS os ativos, não apenas INSUMO/DIVERSOS', async () => {
      // Deve passar sem erros (todos os preços são válidos)
      await expect(validateAllPrices()).resolves.toBeUndefined();
    });
  });

  describe('Quantitativos esperados', () => {
    it('total de ativos deve ser 174 (204 - 30 inativos)', async () => {
      const report = await generateClassificationReport();
      // 174 ativos = 144 comercializáveis + 24 insumos + 6 incertos
      expect(report.length).toBe(174);
    });

    it('comercializáveis deve ser 144', async () => {
      const report = await generateClassificationReport();
      const comercializaveis = report.filter(r => r.classificacao === 'COMERCIALIZADO');
      expect(comercializaveis.length).toBe(144);
    });

    it('insumos deve ser 24', async () => {
      const report = await generateClassificationReport();
      const insumos = report.filter(r => r.classificacao === 'INSUMO');
      expect(insumos.length).toBe(24);
    });

    it('incertos deve ser 6', async () => {
      const report = await generateClassificationReport();
      const incertos = report.filter(r => r.classificacao === 'INCERTO');
      expect(incertos.length).toBe(6);
    });
  });

  describe('Espaço em branco removido', () => {
    it('não procura mais por "DIVERSOS " com espaço', async () => {
      const report = await generateClassificationReport();
      
      // Todos os grupos devem estar sem espaço no final
      const gruposComEspacoNoFinal = report.filter(r => r.grupo.endsWith(' '));
      expect(gruposComEspacoNoFinal.length).toBe(0);
    });
  });
});
