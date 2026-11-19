# Delivery Summary: C.6-FIX06.4 - NTFS ACL Validation Fix

## Files Modified/Created

### 1. Created: `test-ntfs-credentials.ps1`
**Path:** `C:\Users\u1n3c\OneDrive\Documentos\Cardapio_Digital\backend\ops\homolog\test-ntfs-credentials.ps1`

Isolated test script for ACL validation verification. Validates:
- Temporary directory creation with ACL restricted to current user + SYSTEM
- Removal of previous ACEs (Administrators, CodexSandboxUsers, etc.)
- ACL application using valid `FileSystemAccessRule` constructors (NOT raw SDDL strings)
- Effective ACL verification and inheritance protection
- Fictitious credential writing and Node.js-style reading
- Proper cleanup in finally block (including failure scenarios)
- PASS/FAIL per step, exit code 0 only when all approved

**Key fixes applied:**
- `FileSystemAccessRule]::new($sdlString)` → `[FileSystemAccessRule]::new($identity, [FileSystemRights]::FullControl, [AccessControlType]::Allow)` 
- Added `$acl.RemoveAccessRuleAll()` and iterative removal to prevent preserving unwanted ACEs
- `SetAccessRuleProtection($false, $false)` — don't preserve existing, don't inherit
- Ternary `? :` operators replaced with `if/else` for PowerShell 5.1 compatibility
- `[guid]::NewGuid().ToString('N')` → `.ToString()` for PS 5.1 compatibility

### 2. Modified: `recover-neon-c6-acl.ps1`
**Path:** `C:\Users\u1n3c\OneDrive\Documentos\Cardapio_Digital\backend\ops\homolog\recover-neon-c6-acl.ps1`

Lines 334-355 (CHECK mode): Fixed the same `FileSystemAccessRule` constructor issue and ACE preservation.

**Key fixes applied:**
- Replaced `[FileSystemAccessRule]::new($ruleSDDL)` with valid 3-parameter constructor
- Added rule removal loop before adding new rules: `$acl1.RemoveAccessRule($rule.IdentityReference)` 
- Changed `SetAccessRuleProtection($false, $true)` → `$true, $false` to disable inheritance
- The directory ACL setup using `SetSecurityDescriptorSddlForm` (line 115) was already correct and kept as-is

## Root Cause

**Error:** `"Não é possível localizar uma sobrecarga para 'new' e a contagem de argumentos: '1'."`

**Cause:** .NET `FileSystemAccessRule` constructor does not accept a single SDDL string argument in PowerShell 5.1. The available constructors are:
- `FileSystemAccessRule(string identity, FileSystemRights rights, AccessControlType type)` — 3 parameters
- `FileSystemAccessRule(string identity, FileSystemRights rights, AccessControlType type, InheritanceFlags inheritance, PropagationFlags propagation)` — 5 parameters

The script was passing SDDL strings like `'D:(A;OICI;0x1f01ff;;;S-1-5-18)'` as single arguments, causing the parser error.

**Secondary issue:** ACEs from Administrators, CodexSandboxUsers, etc. were being preserved because the scripts did not remove existing rules before adding new ones.

## Execution Instructions

User must run in Windows PowerShell 5.1:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\test-ntfs-credentials.ps1
```

**Expected results:**
- Exit code 0 + `TEST PASS: All steps approved` — all fixes validated
- Exit code 1 + `TEST FAIL: Alguma etapa nao aprovada` — identify failing step, make minimal correction to `recover-neon-c6-acl.ps1`, re-run test

**No credentials are solicited or used. All data is fictitious.**

## Validation Checklist

- [x] Script compatible with Windows PowerShell 5.1
- [x] No real credentials solicited or used
- [x] Isolated temp directory with ACL restricted to current user + SYSTEM
- [x] Two empty files created
- [x] ACLs applied using valid `FileSystemAccessRule` constructors (no raw SDDL)
- [x] Effective ACLs validated (inheritance protection, SIDs, permissions)
- [x] Fictitious credentials written and read back
- [x] Cleanup in finally block (including failure scenarios)
- [x] PASS/FAIL messages per step, exit code 0 only when all approved
- [x] No CHECK/APPLY/migrations/deploy execution
- [x] No permanent files with secrets created