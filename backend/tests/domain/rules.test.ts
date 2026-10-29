import { describe, expect, it } from 'vitest';
import {
  canTransitionComanda, canTransitionOrder, isValidComandaNumber,
  ORDER_LIMITS, priceOrderItems,
} from '../../src/domain/rules';

const first = { productKey: 'rustika-131', quantity: 2, currentUnitPriceInCents: 5999, expectedUnitPriceInCents: 5999 };

describe('regras puras RF004', () => {
  it('mantém zeros iniciais e restringe o formato público de comanda', () => {
    expect(isValidComandaNumber('000123')).toBe(true);
    for (const value of ['', '1234567', ' 123', '123 ', '-1', '١٢٣']) {
      expect(isValidComandaNumber(value)).toBe(false);
    }
  });

  it('rejeita regressões, saltos e alterações de estados terminais', () => {
    expect(canTransitionComanda('OPEN', 'CLOSED')).toBe(true);
    expect(canTransitionComanda('OPEN', 'CANCELLED')).toBe(true);
    expect(canTransitionComanda('CLOSED', 'OPEN')).toBe(false);
    expect(canTransitionOrder('RECEIVED', 'IN_PREPARATION')).toBe(true);
    expect(canTransitionOrder('IN_PREPARATION', 'CANCELLED')).toBe(true);
    expect(canTransitionOrder('RECEIVED', 'READY')).toBe(false);
    expect(canTransitionOrder('READY', 'CANCELLED')).toBe(false);
    expect(canTransitionOrder('DELIVERED', 'RECEIVED')).toBe(false);
  });

  it('calcula snapshots exatos em centavos, inclusive preços terminados em 99', () => {
    expect(priceOrderItems([first, {
      productKey: 'rustika-3', quantity: 3, currentUnitPriceInCents: 1499, expectedUnitPriceInCents: 1499,
    }])).toEqual({
      items: [
        { productKey: 'rustika-131', quantity: 2, unitPriceInCentsSnapshot: 5999, subtotalInCents: 11998 },
        { productKey: 'rustika-3', quantity: 3, unitPriceInCentsSnapshot: 1499, subtotalInCents: 4497 },
      ],
      totalInCents: 16495,
    });
  });

  it('não aceita preço esperado antigo nem usa o valor enviado para compor total', () => {
    expect(() => priceOrderItems([{ ...first, expectedUnitPriceInCents: 5000 }]))
      .toThrowError(expect.objectContaining({ code: 'PRICE_CHANGED' }));
  });

  it('bloqueia itens duplicados, preço fracionário e quantidades inválidas', () => {
    expect(() => priceOrderItems([first, first])).toThrowError(expect.objectContaining({ code: 'INVALID_ITEMS' }));
    expect(() => priceOrderItems([{ ...first, currentUnitPriceInCents: 1.1 }]))
      .toThrowError(expect.objectContaining({ code: 'INVALID_PRICE' }));
    expect(() => priceOrderItems([{ ...first, quantity: 0 }]))
      .toThrowError(expect.objectContaining({ code: 'INVALID_ITEMS' }));
  });

  it('impõe limite de 99 por item, 200 unidades totais e teto monetário', () => {
    expect(priceOrderItems([{ ...first, quantity: 99, currentUnitPriceInCents: 1, expectedUnitPriceInCents: 1 }]).totalInCents).toBe(99);
    expect(() => priceOrderItems([{ ...first, quantity: 100 }]))
      .toThrowError(expect.objectContaining({ code: 'LIMIT_EXCEEDED' }));
    expect(() => priceOrderItems([1, 2, 3].map((id) => ({
      productKey: `rustika-${id}`, quantity: 99, currentUnitPriceInCents: 1, expectedUnitPriceInCents: 1,
    })))).toThrowError(expect.objectContaining({ code: 'LIMIT_EXCEEDED' }));
    expect(() => priceOrderItems([{ ...first, quantity: 2, currentUnitPriceInCents: 600_000, expectedUnitPriceInCents: 600_000 }]))
      .toThrowError(expect.objectContaining({ code: 'LIMIT_EXCEEDED' }));
    expect(() => priceOrderItems(Array.from({ length: ORDER_LIMITS.maxDistinctItems + 1 }, (_, index) => ({
      productKey: `rustika-${index + 1}`, quantity: 1, currentUnitPriceInCents: 1, expectedUnitPriceInCents: 1,
    })))).toThrowError(expect.objectContaining({ code: 'LIMIT_EXCEEDED' }));
  });
});
