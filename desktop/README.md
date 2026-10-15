# Cliente desktop

Cliente Electron para Windows e Linux. A interface, a captura de tela, o WebRTC e a sinalização executam dentro do aplicativo; a VPS Go fica somente como relay de mídia e sinalização. A URL da VPS e a última sala são salvas localmente.

## Desenvolvimento

```bash
cd desktop
bun install
bun run dev
```

## Gerar para distribuir no Windows

```powershell
cd desktop
bun install
bun run dist:win
```

No Windows são gerados dois arquivos em `desktop/artifacts/electron-builder-release/`: o executável portátil (`ScreenShare-<versão>-portable.exe`) e o instalador (`ScreenShare-Setup-<versão>.exe`).

## Gerar para distribuir no Linux

Execute o build em uma máquina Linux:

```bash
cd desktop
bun install
bun run dist:linux
```

O build gera um `AppImage` e um pacote `.deb` em `desktop/artifacts/electron-builder-release/`. O comando `bun run dist` escolhe automaticamente o alvo da plataforma atual.

Para captura no Wayland, a sessão precisa ter PipeWire e um portal de desktop instalados e em execução. Em distribuições baseadas em Debian/Ubuntu, normalmente isso significa `pipewire`, `xdg-desktop-portal` e o backend do ambiente (por exemplo, `xdg-desktop-portal-gnome` ou `xdg-desktop-portal-kde`). O seletor de tela do sistema pode aparecer ao iniciar a transmissão.

## Assinar no Windows

O script `scripts/sign-windows.ps1` usa Azure Trusted Signing com `signtool.exe` e `Azure.CodeSigning.Dlib.dll`. Instale o Windows SDK e o cliente oficial do Artifact Signing:

```powershell
winget install -e --id Microsoft.Azure.ArtifactSigningClientTools
```

Preencha no `.env` da raiz `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` e `AZURE_CLIENT_SECRET`. O segredo do service principal fica somente no ambiente do processo; ele nao e gravado no metadata temporario usado pelo `signtool`.

Depois de gerar o artefato Windows, assine todos os `.exe` encontrados no diretorio de release:

```powershell
cd desktop
bun run dist
bun run sign
```

Para assinar outro diretorio, use `bun run sign -- -FilesFolder ..\build\bin`. Se as ferramentas nao forem encontradas automaticamente, defina `SIGNTOOL_PATH` e `AZURE_CODESIGNING_DLIB_PATH` no `.env`.

O modo **Assistir** é o caminho recomendado. No Linux, o modo **Transmitir** usa a captura de desktop do Chromium e o PipeWire quando a captura legada não estiver disponível; teste a tela e o áudio do sistema na distribuição escolhida.
