/**
 * Catalogo SINTETICO para os testes de importacao/seed.
 *
 * Substitui, nos testes, a planilha real `backend/data/Exportacao-produtos.xlsx` (dado comercial privado,
 * fora do Git). Todos os dados sao ficticios e deterministicos:
 *  - nomes comecam com "SINT" e nao correspondem a nenhum produto do cardapio real;
 *  - precos saem de uma formula (`priceCents`), nao de tabela de precos real;
 *  - codigos 1001.. sao sequenciais; 44 e 47 sao numeros baixos ja presentes nos testes (nao sao codigos reais
 *    de produto aqui); `SX000001` e o unico codigo alfanumerico.
 *
 * Os tokens "BALY 2L", "PANCETA", "CDB", "CHICLETE", "HALLS", "GUARDA VOLUME", "PALHEIRO" e "ISQUEIRO" aparecem
 * nos nomes sinteticos porque `classifyProduct` decide por esses trechos de nome; sem eles as regras de
 * classificacao nao seriam exercitadas. Sao palavras-chave do codigo, nao dados do catalogo real.
 *
 * A forma espelha a planilha real (mesmas colunas, 204 linhas, 174 ativos = 144 comercializados + 24 insumos +
 * 6 incertos, 30 inativos, 168 candidatos), para que as MESMAS asserções dos testes valham para os dois. Isso NAO
 * prova que o conteudo real esteja coberto: o conteudo real so e verificado em `private-catalog.test.ts`, que
 * roda apenas na maquina que possui a planilha.
 *
 * Formato: CSV UTF-8 COM BOM (o BOM e necessario para o leitor `xlsx` decodificar "Código"/"Preço venda").
 * O arquivo versionado e conferido contra este gerador por `synthetic-catalog.test.ts`.
 */
export const CATALOG_HEADERS = ['Imagem', 'Código', 'Nome curto', 'Estado', 'Grupo', 'Preço venda', 'Preço custo', 'Estoque'] as const;

export const SYNTHETIC_EXPECTED = {
  total: 204,
  ativos: 174,
  publicos: 144,
  internos: 24,
  incertosSuspensos: 6,
  inativosExcluidos: 30,
  candidatos: 168,
  /** Nomes/codigos que os testes procuram. */
  balyName: 'SINT BALY 2L',
  pancetaName: 'SINT PANCETA SUINA',
  idsPreservados: ['44', '47'],
  alphaCode: 'SX000001',
} as const;

interface Row {
  codigo: string;
  nome: string;
  estado: 'Ativo' | 'Inativo';
  grupo: string;
  cents: number;
}

const priceCents = (i: number) => 150 + ((i * 7919) % 9000);

export function syntheticRows(): Row[] {
  const rows: Row[] = [];
  let seq = 0;
  const nextCode = () => String(1001 + seq++);
  const push = (nome: string, grupo: string, cents: number, codigo = nextCode(), estado: Row['estado'] = 'Ativo') =>
    rows.push({ codigo, nome, estado, grupo, cents });
  const pad = (n: number) => String(n).padStart(3, '0');

  // 24 insumos (grupo INSUMO); os tres primeiros com preco 0.01.
  for (let i = 1; i <= 24; i++) push(`SINT INSUMO ${pad(i)}`, 'INSUMO', i <= 3 ? 1 : priceCents(i));
  // Dois itens do grupo INSUMO que a regra classifica como comercializados.
  push(SYNTHETIC_EXPECTED.balyName, 'INSUMO', 2600, '44');
  push(SYNTHETIC_EXPECTED.pancetaName, 'INSUMO', 5000);
  // Seis incertos (grupo DIVERSOS).
  for (const nome of ['SINT CDB', 'SINT CHICLETE', 'SINT HALLS', 'SINT GUARDA VOLUME', 'SINT PALHEIRO', 'SINT ISQUEIRO MACARICO']) {
    push(nome, 'DIVERSOS', 500);
  }
  // Dez comercializados de DIVERSOS; um com espaco no fim do nome do grupo (o relatorio deve aparar).
  push('SINT GELO BALDE', 'DIVERSOS', 500, '47');
  for (let i = 1; i <= 8; i++) push(`SINT DIVERSO ${pad(i)}`, 'DIVERSOS', priceCents(100 + i));
  push('SINT DIVERSO 009', 'DIVERSOS ', priceCents(109));
  // 132 comercializados em dez grupos sinteticos; um com codigo alfanumerico.
  for (let i = 1; i <= 132; i++) {
    const grupo = `SINT GRUPO ${String(((i - 1) % 10) + 1).padStart(2, '0')}`;
    if (i === 1) push(`SINT ITEM ${pad(i)}`, grupo, priceCents(i), SYNTHETIC_EXPECTED.alphaCode);
    else push(`SINT ITEM ${pad(i)}`, grupo, priceCents(i));
  }
  // 30 inativos.
  for (let i = 1; i <= 30; i++) {
    push(`SINT INATIVO ${pad(i)}`, `SINT GRUPO ${String(((i - 1) % 10) + 1).padStart(2, '0')}`, priceCents(300 + i), nextCode(), 'Inativo');
  }
  return rows;
}

const money = (cents: number) => (cents / 100).toFixed(2).replace(/\.?0+$/, (m) => (m === '.00' || m === '.0' ? '' : m));

export function buildSyntheticCatalogCsv(): string {
  const lines = [CATALOG_HEADERS.join(',')];
  for (const r of syntheticRows()) {
    const custo = Math.round(r.cents * 0.4);
    lines.push(['', r.codigo, r.nome, r.estado, r.grupo, money(r.cents), money(custo), ''].join(','));
  }
  return '﻿' + lines.join('\n') + '\n';
}

/** Catalogo pequeno com precos invalidos para exercitar `validateAllPrices` (caminho de falha). */
export const INVALID_PRICE_CODES = ['9002', '9003', '9004', '9005'] as const;
export function buildInvalidPricesCsv(): string {
  const lines = [
    CATALOG_HEADERS.join(','),
    ',9001,SINT PRECO OK,Ativo,SINT GRUPO 01,10.5,4,',
    ',9002,SINT PRECO TEXTO,Ativo,SINT GRUPO 01,abc,4,',
    ',9003,SINT PRECO NEGATIVO,Ativo,SINT GRUPO 01,-5,4,',
    ',9004,SINT PRECO MULTIPLOS,Ativo,SINT GRUPO 01,1.2.3,4,',
    ',9005,SINT PRECO VAZIO,Ativo,SINT GRUPO 01,,4,',
    ',9006,SINT INATIVO COM PRECO RUIM,Inativo,SINT GRUPO 01,xyz,4,',
  ];
  return '﻿' + lines.join('\n') + '\n';
}
