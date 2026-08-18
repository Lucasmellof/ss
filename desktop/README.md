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

O modo **Assistir** é o caminho recomendado. O modo **Transmitir** usa `getDisplayMedia` dentro do renderer CEF; teste tela e áudio do sistema em máquinas diferentes antes de tratá-lo como estável.
