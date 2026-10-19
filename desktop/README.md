# Cliente desktop

Cliente Electron para Windows, Linux e macOS. A interface, a captura de tela, o WebRTC e a sinalização executam dentro do aplicativo; a VPS Go fica somente como relay de mídia e sinalização. A URL da VPS e a última sala são salvas localmente.

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

## Build for macOS

Run the build on a Mac (Apple Silicon or Intel):

```bash
cd desktop
bun install
bun run dist:mac
```

This produces a universal `.dmg` and `.zip` (`ScreenShare-<version>-universal.*`) plus `latest-mac.yml` in `desktop/artifacts/electron-builder-release/`. `bun run dist` also picks this target automatically on macOS.

### Signing and notarization

Signing is optional. Without a certificate, set `CSC_IDENTITY_AUTO_DISCOVERY=false` and the app is built unsigned. To sign and notarize, export:

- `CSC_LINK` and `CSC_KEY_PASSWORD`: the Developer ID Application certificate (`.p12`, path or base64) and its password.
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`: when present, electron-builder notarizes the app automatically.

The release workflow reads the same values from repository secrets and falls back to an unsigned build when they are missing. The app runs with the hardened runtime and the entitlements in `resources/entitlements.mac.plist`.

### Gatekeeper on unsigned builds

macOS blocks unsigned apps downloaded from the internet. After copying `Screen Share.app` to `/Applications`, either right-click it and choose **Open**, or remove the quarantine flag:

```bash
xattr -dr com.apple.quarantine "/Applications/Screen Share.app"
```

### Screen Recording permission

Sharing a screen or window needs the **Screen Recording** permission (System Settings > Privacy & Security > Screen Recording). macOS asks for it the first time the app lists capture sources. If it was denied, the source picker shows a button that opens the right settings pane; enable **Screen Share** there and reopen the app.

### System audio

On macOS the app captures through `getDisplayMedia`, and the Electron main process serves the selected source with system audio loopback (ScreenCaptureKit). System audio needs macOS 13 or newer; macOS 14.2+ may also ask for the system audio recording permission. The Windows WASAPI helper is not used on macOS.

### Updates

Automatic in-place updates are Windows only. On macOS the app detects new releases and downloads the `.dmg` to the Downloads folder for a manual install.

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
