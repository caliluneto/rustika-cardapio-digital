@echo off
cd C:\Users\u1n3c\OneDrive\Documentos\Cardapio_Digital\backend\ops\homolog
powershell -noprofile -ExecutionPolicy Bypass -File test-ntfs-credentials.ps1
echo Exit code: %errorlevel%