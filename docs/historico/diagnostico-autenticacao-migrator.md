# Diagnóstico da Falha de Autenticação cardapio_migrator

## Causa Raiz Provável

A falha "password authentication failed for user 'cardapio_migrator'" ocorre na linha 682 do recover-neon-c6-acl.ts:

```typescript
const ownerClient = buildClient(url, REPLAY_DB, ROLES.migrator, secrets.migratorPassword, 'rustika-c6-recovery-owner-acl-read');
await ownerClient.connect();
```

### Hipóteses Principais

1. **Falha na leitura TTY do PowerShell**: A função `readHiddenLine` lê caracteres um a um do stdin em modo raw. No Windows PowerShell, o encaminamento de keystrokes para processos Node.js pode não capturar todos os caracteres, especialmente se houver atraso ou bufferização. A senha poderia ser truncada ou ter caracteres finais perdidos.

2. **Caracteres especiais na senha**: Senhas que contenham `@`, `%`, `^`, `&`, `!`, `~`, `` ` ``, `$`, `#` etc. podem ser interpretados diferentemente entre o PowerShell e o driver PostgreSQL (pg). O `buildClient` coloca a senha diretamente na URL de conexão, e algum personagem de escape pode estar sendo aplicado (ou não aplicado) corretamente.

3. **Senha com comprimento exato 24 caracteres**: Se a senha tiver exatamente 24 caracteres e o último caractere for um espaço ou caractere de controle, ele pode ser cortado pela leitura TTY ou pelo processamento da URL.

4. **Role cardapio_migrator sem senha ou com senha diferente**: Caso o provisionamento `provision-neon-c6.ts` tenha sido executado com uma senha que desde então mudou, ou se a role foi recriada sem senha (LOGIN sem senha definida).

### Testes Locais Fictícios (Sem Conexão Real)

Como não temos acesso ao Neon nem ao TTY real, propomos os seguintes testes de validade de código:

#### Teste 1: Validação de leitura de senha TTY
```typescript
// Simula a leitura de senha e verifica se o comprimento é preservado
function simularReadHiddenLine(input: string): { success: boolean; length: number; trimmed: string } {
  // O readHiddenLine lê até Enter e descarta \r\n
  const hasCr = input.includes('\r');
  const hasLf = input.includes('\n');
  const trimmed = input.replace(/\r?\n$/, '');
  // A senha deve ter >= 24 caracteres
  const validLength = trimmed.length >= 24;
  return {
    success: validLength,
    length: trimmed.length,
    trimmed,
  };
}

// Teste: senha numérica de 24 dígitos
console.log(simularReadHiddenLine('123456789012345678901234')); 
// Teste: senha com caracteres especiais
console.log(simularReadHiddenLine('Senha@2026!Teste#123456789012')); 
// Teste: senha com exatamente 24 caracteres (borderline)
console.log(simularReadHiddenLine('Abcdefghijklmnopqrstuvwxyz')); 
// Teste: senha com 23 caracteres (falha)
console.log(simularReadHiddenLine('Abcdefghijklmnopqrstuvwxy'));
```

#### Teste 2: Validação de construção de URL de conexão
```typescript
// Simula o buildClient e verifica se a senha aparece corretamente na URL
function testBuildClientPassword(password: string): { urlString: string; passwordPreserved: boolean } {
  const target = new URL('postgresql://localhost/');
  target.hostname = 'example.neon.tech';
  target.port = '5432';
  target.username = 'cardapio_migrator';
  target.password = password;
  target.pathname = '/cardapio_digital_test';
  const connStr = target.toString();
  const passwordPreserved = connStr.includes(password);
  return { urlString: connStr, passwordPreserved };
}

// Teste: senha sem caracteres especiais
console.log(testBuildClientPassword('Minhasenha24Caracteres!'));

// Teste: senha com @ (pode ser problemático em URLs)
console.log(testBuildClientPassword('Senha@Teste24Caracteres'));

// Teste: senha com espaço (deve falhar na leitura TTY ou URL)
console.log(testBuildClientPassword('Senha Teste 24Caracteres'));
```

#### Teste 3: Verificação de compatibilidade PowerShell → Node.js
```typescript
// Verifica se caracteres de controle são filtrados corretamente
function verificarFiltrado(potentialPassword: string): boolean {
  // O readHiddenLine filtra: \r, \n, \u0003 (Ctrl+C), \u007f (Backspace), \b
  // Permite: chars >= 32 (exceto \r \n)
  for (const char of potentialPassword) {
    const code = char.charCodeAt(0);
    if (code === 13 || code === 10 || code === 3 || code === 127 || code === 8) {
      return false; // caractere de controle encontrado
    }
    if (code < 32) {
      return false; // caractere de controle baixo
    }
  }
  return true;
}

// Teste: senha válida
console.log(verificarFiltrado('SenhaComplexa2026!'));
// Teste: senha com Ctrl+C simulado
console.log(verificarFiltrado('Senha\x03Teste')); 
// Teste: senha com backspace simulado (não deve aparecer no resultado final)
console.log(verificarFiltrado('Senha\x08Teste')); 
```

## Solução Proposta

### Se a causa for falha de leitura TTY (mais provável no Windows):

1. **Não use caracteres ambíguos** no password: evite `@`, `%`, `^`, `&` no início ou em posições críticas.

2. **Use senha com letras e números apenas** para garantir compatibilidade TTY no PowerShell.

3. **Digite a senha devagar** - o PowerShell pode perder caracteres se a entrada for muito rápida.

### Se a causa for caracteres especiais na senha:

1. **Evite `@` em senhas usadas em URLs de conexão PostgreSQL** - o `@` tem significado especial em URLs (separa usuário e senha).

2. **Use `encodeURIComponent` antes de inserir senha em URL** - embora o `buildClient` não faça encoding explicitamente, o driver pg pode interpretar a URL segundo o padrão PostgreSQL.

### Procedimento de Redefinição Supervisionada (se necessário)

Se a senha não corresponder à senha original da role `cardapio_migrator`, proceder com:

1. **Não executar ALTER ROLE automaticamente** - conforme as restrições.

2. **Solicitar ao proprietário do Neon que defina a senha da role cardapio_migrator** de forma supervisada, usando o comando PostgreSQL:
   ```sql
   ALTER ROLE cardapio_migrator WITH PASSWORD 'nova_senha_segura';
   ```
   - A nova senha deve ter ≥ 24 caracteres
   - Não deve conter `@` nem outros caracteres de URL problemáticos
   - De ser digitada em cofre seguro, não em chat

3. **Retomar o CHECK com a nova senha**:
   ```
   powershell -ExecutionPolicy Bypass -File .\ops\homolog\recover-neon-c6-acl.ps1 --check
   ```

### Testes Recomendados Antes do Deploy Real

1. **Teste A**: Senha numérica de 24 dígitos apenas - `123456789012345678901234`
2. **Teste B**: Senha mista sem `@` - `RustikaAuth2026!End` (24 chars, contém `!` que pode ser problemático)
3. **Teste C**: Senha segura sem caracteres de URL problemáticos - `RustikaSecurePass2026` (24 chars, apenas letras e números)

### Comando para Retomar o CHECK (após correção):

```powershell
# No diretório do backend do Rustika
powershell -ExecutionPolicy Bypass -File .\ops\homolog\recover-neon-c6-acl.ps1 --check
```

Se solicitar senha, digitar a senha confirmada (sem caracteres `@` em posições que a URL possa interpretar errado).

## Riscos Pendentes

- Se a senha tiver `@`, a conexão pode falhar silenciosamente ou conectar como usuário errado
- Se a senha for truncada (TTY issue), a autenticação falhará sempre
- Se a role não tiver LOGIN concedido, a conexão falhará independentemente da senha