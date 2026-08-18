# Cliente desktop

Cliente Electrobun completo para Windows. Interface, captura de tela, WebRTC e sinalização executam dentro do aplicativo; a VPS Go fica somente como relay de mídia e sinalização. Ele salva localmente a URL da VPS e a última sala, sem enviar esses dados para outro serviço.

## Desenvolvimento

```powershell
cd desktop
bun install
bun run dev
```

## Gerar para distribuir

```powershell
cd desktop
bun install
bun run dist
```

O executável portátil único fica em `desktop/artifacts/electron-builder-release/ScreenShare-0.2.0-portable.exe`. Distribua esse arquivo para amigos; para evitar alertas do SmartScreen em distribuição mais ampla, assine o executável.

## Assinar no Windows

O script `scripts/sign-windows.ps1` usa Azure Trusted Signing com `signtool.exe` e `Azure.CodeSigning.Dlib.dll`. Instale o Windows SDK e o cliente oficial do Artifact Signing:

```powershell
winget install -e --id Microsoft.Azure.ArtifactSigningClientTools
```

Preencha no `.env` da raiz `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` e `AZURE_CLIENT_SECRET`. O segredo do service principal fica somente no ambiente do processo; ele nao e gravado no metadata temporario usado pelo `signtool`.

Depois de gerar o artefato, assine todos os `.exe` encontrados no diretorio de release:

```powershell
cd desktop
bun run dist
bun run sign
```

Para assinar outro diretorio, use `bun run sign -- -FilesFolder ..\build\bin`. Se as ferramentas nao forem encontradas automaticamente, defina `SIGNTOOL_PATH` e `AZURE_CODESIGNING_DLIB_PATH` no `.env`.

O modo **Assistir** é o caminho recomendado. O modo **Transmitir** usa `getDisplayMedia` dentro do renderer CEF; teste tela e áudio do sistema em máquinas diferentes antes de tratá-lo como estável.
