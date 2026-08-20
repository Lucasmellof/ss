//go:build windows

package main

import (
	"encoding/binary"
	"flag"
	"fmt"
	"log"
	"os"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"

	"github.com/go-ole/go-ole"
	"github.com/moutend/go-wca/pkg/wca"
	"golang.org/x/sys/windows"
)

const (
	virtualProcessLoopbackDevice = `VAD\Process_Loopback`

	waveFormatIEEEFloat  = 0x0003
	waveFormatExtensible = 0xfffe

	audioSampleFloat32 = 1
	audioSamplePCM     = 2
	audioStreamVersion = 1

	processLoopbackInclude = 0
	processLoopbackExclude = 1

	waitObject0 = 0
	waitTimeout = 258

	vtBlob = 0x0041
)

var (
	ksDataFormatSubtypePCM       = ole.NewGUID("{00000001-0000-0010-8000-00AA00389B71}")
	ksDataFormatSubtypeFloat     = ole.NewGUID("{00000003-0000-0010-8000-00AA00389B71}")
	iidActivateCompletionHandler = ole.NewGUID("{41D82140-6DA0-4E0F-A0A4-1E0F189CEF14}")
	iidAgileObject               = ole.NewGUID("{94EA2B94-E9CC-49E0-C0FF-EE64CA8F5B90}")
)

type audioFormatInfo struct {
	sampleKind byte
	channels   byte
	sampleRate uint32
	blockAlign uint16
	bits       byte
	validBits  byte
}

func main() {
	runtime.LockOSThread()

	if err := ole.CoInitializeEx(0, ole.COINIT_MULTITHREADED); err != nil {
		log.Printf("CoInitializeEx falhou: %v", err)
		runtime.UnlockOSThread()
		os.Exit(1)
	}

	exitCode := run(os.Args[1:])
	ole.CoUninitialize()
	runtime.UnlockOSThread()
	os.Exit(exitCode)
}

func run(args []string) int {
	flags := flag.NewFlagSet("AudioLoopback", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	pid := flags.Uint("pid", 0, "PID do processo a capturar")
	hwnd := flags.Uint64("hwnd", 0, "handle da janela a capturar")
	screen := flags.Bool("screen", false, "capturar a tela e excluir o Discord")
	excludeDiscord := flags.Bool("exclude-discord", false, "excluir a árvore do Discord")
	if err := flags.Parse(args); err != nil {
		return 2
	}

	targetPID := uint32(*pid)
	if *hwnd != 0 {
		var windowPID uint32
		if _, err := windows.GetWindowThreadProcessId(windows.HWND(*hwnd), &windowPID); err != nil {
			log.Printf("GetWindowThreadProcessId falhou: %v", err)
			return 1
		}
		targetPID = windowPID
	}

	if *screen || *excludeDiscord {
		discordRootPID := findDiscordRootPID()
		log.Printf("isScreen=true discordRootPID=%d", discordRootPID)
		if discordRootPID != 0 {
			log.Printf("iniciando loopback com exclusão da árvore do PID %d", discordRootPID)
			if err := captureProcessAudio(discordRootPID, processLoopbackExclude); err == nil {
				return 0
			} else {
				log.Printf("falha no loopback de exclusão do Discord: %v", err)
			}
		}
		log.Printf("iniciando captura do dispositivo padrão")
		if err := captureDeviceAudio(); err != nil {
			log.Printf("captura do dispositivo padrão falhou: %v", err)
			return 1
		}
		return 0
	}

	if targetPID != 0 {
		if err := captureProcessAudio(targetPID, processLoopbackInclude); err == nil {
			return 0
		} else {
			log.Printf("fallback para o dispositivo padrão após falha no PID %d: %v", targetPID, err)
		}
	}

	if err := captureDeviceAudio(); err != nil {
		log.Printf("captura do dispositivo padrão falhou: %v", err)
		return 1
	}
	return 0
}

func findDiscordRootPID() uint32 {
	snapshot, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return 0
	}
	defer windows.CloseHandle(snapshot)

	entry := windows.ProcessEntry32{Size: uint32(unsafe.Sizeof(windows.ProcessEntry32{}))}
	if err := windows.Process32First(snapshot, &entry); err != nil {
		return 0
	}

	discordPIDs := make(map[uint32]bool)
	parentByPID := make(map[uint32]uint32)
	for {
		executable := strings.ToLower(windows.UTF16ToString(entry.ExeFile[:]))
		if isDiscordExecutable(executable) {
			discordPIDs[entry.ProcessID] = true
			parentByPID[entry.ProcessID] = entry.ParentProcessID
		}

		if err := windows.Process32Next(snapshot, &entry); err != nil {
			break
		}
	}

	for processID := range discordPIDs {
		parentID, hasParent := parentByPID[processID]
		if !hasParent || !discordPIDs[parentID] {
			return processID
		}
	}
	return 0
}

func isDiscordExecutable(name string) bool {
	name = strings.TrimSuffix(name, ".exe")
	switch name {
	case "discord", "discordptb", "discordcanary", "discorddevelopment":
		return true
	default:
		return false
	}
}

func captureDeviceAudio() error {
	client, format, err := getDefaultAudioClient()
	if err != nil {
		return err
	}
	return runAudioLoop(client, format)
}

func captureProcessAudio(pid, loopbackMode uint32) error {
	client, err := activateProcessAudioClient(pid, loopbackMode)
	if err != nil {
		return err
	}

	// Process loopback requires the mix format from the default render endpoint.
	defaultClient, format, err := getDefaultAudioClient()
	if err != nil {
		client.Release()
		return err
	}
	defaultClient.Release()

	return runAudioLoop(client, format)
}

func getDefaultAudioClient() (*wca.IAudioClient, *wca.WAVEFORMATEX, error) {
	var enumerator *wca.IMMDeviceEnumerator
	if err := wca.CoCreateInstance(
		wca.CLSID_MMDeviceEnumerator,
		0,
		wca.CLSCTX_ALL,
		wca.IID_IMMDeviceEnumerator,
		&enumerator,
	); err != nil {
		return nil, nil, fmt.Errorf("CoCreateInstance(MMDeviceEnumerator): %w", err)
	}
	defer enumerator.Release()

	var device *wca.IMMDevice
	if err := enumerator.GetDefaultAudioEndpoint(wca.ERender, wca.EConsole, &device); err != nil {
		return nil, nil, fmt.Errorf("GetDefaultAudioEndpoint: %w", err)
	}
	defer device.Release()

	var client *wca.IAudioClient
	if err := device.Activate(wca.IID_IAudioClient, wca.CLSCTX_ALL, nil, &client); err != nil {
		return nil, nil, fmt.Errorf("IMMDevice.Activate(IAudioClient): %w", err)
	}

	var format *wca.WAVEFORMATEX
	if err := client.GetMixFormat(&format); err != nil {
		client.Release()
		return nil, nil, fmt.Errorf("IAudioClient.GetMixFormat: %w", err)
	}
	if format == nil {
		client.Release()
		return nil, nil, fmt.Errorf("IAudioClient.GetMixFormat retornou formato nulo")
	}

	return client, format, nil
}

func runAudioLoop(client *wca.IAudioClient, format *wca.WAVEFORMATEX) error {
	if client == nil || format == nil {
		return fmt.Errorf("cliente ou formato de áudio nulo")
	}
	defer client.Release()
	defer ole.CoTaskMemFree(uintptr(unsafe.Pointer(format)))

	info, err := describeAudioFormat(format)
	if err != nil {
		return err
	}

	sessionGUID := ole.NewGUID("{00000000-0000-0000-0000-000000000000}")
	streamFlags := uint32(wca.AUDCLNT_STREAMFLAGS_LOOPBACK | wca.AUDCLNT_STREAMFLAGS_EVENTCALLBACK)
	if err := client.Initialize(
		wca.AUDCLNT_SHAREMODE_SHARED,
		streamFlags,
		10_000_000,
		0,
		format,
		sessionGUID,
	); err != nil {
		return fmt.Errorf("IAudioClient.Initialize: %w", err)
	}

	eventHandle := wca.CreateEventExA(0, 0, 0, wca.EVENT_ALL_ACCESS)
	if eventHandle == 0 {
		return fmt.Errorf("CreateEventExA retornou handle nulo")
	}
	defer wca.CloseHandle(eventHandle)

	if err := client.SetEventHandle(eventHandle); err != nil {
		return fmt.Errorf("IAudioClient.SetEventHandle: %w", err)
	}

	var captureClient *wca.IAudioCaptureClient
	if err := client.GetService(wca.IID_IAudioCaptureClient, &captureClient); err != nil {
		return fmt.Errorf("IAudioClient.GetService(IAudioCaptureClient): %w", err)
	}
	if captureClient == nil {
		return fmt.Errorf("IAudioClient.GetService retornou cliente nulo")
	}
	defer captureClient.Release()

	if err := client.Start(); err != nil {
		return fmt.Errorf("IAudioClient.Start: %w", err)
	}
	defer client.Stop()

	if err := writeAudioHeader(os.Stdout, info); err != nil {
		return fmt.Errorf("escrever cabeçalho de áudio: %w", err)
	}
	log.Printf("formato: kind=%d %dHz %dch %dbit block=%d", info.sampleKind, info.sampleRate, info.channels, info.bits, info.blockAlign)

	return copyAudioPackets(captureClient, eventHandle, info.blockAlign)
}

func copyAudioPackets(captureClient *wca.IAudioCaptureClient, eventHandle uintptr, blockAlign uint16) error {
	var silence []byte
	for {
		waitResult := wca.WaitForSingleObject(eventHandle, 500)
		if waitResult == waitTimeout {
			continue
		}
		if waitResult != waitObject0 {
			return fmt.Errorf("WaitForSingleObject retornou 0x%08X", waitResult)
		}

		for {
			var packetFrames uint32
			if err := captureClient.GetNextPacketSize(&packetFrames); err != nil {
				return fmt.Errorf("IAudioCaptureClient.GetNextPacketSize: %w", err)
			}
			if packetFrames == 0 {
				break
			}

			var data *byte
			var framesRead uint32
			var flags uint32
			var devicePosition uint64
			var qpcPosition uint64
			if err := captureClient.GetBuffer(&data, &framesRead, &flags, &devicePosition, &qpcPosition); err != nil {
				return fmt.Errorf("IAudioCaptureClient.GetBuffer: %w", err)
			}

			byteCount := int(framesRead) * int(blockAlign)
			var writeErr error
			if byteCount > 0 {
				if flags&wca.AUDCLNT_BUFFERFLAGS_SILENT != 0 {
					if cap(silence) < byteCount {
						silence = make([]byte, byteCount)
					} else {
						silence = silence[:byteCount]
						clear(silence)
					}
					writeErr = writeAll(os.Stdout, silence)
				} else if data == nil {
					writeErr = fmt.Errorf("GetBuffer retornou dados nulos para pacote não silencioso")
				} else {
					writeErr = writeAll(os.Stdout, unsafe.Slice(data, byteCount))
				}
			}

			releaseErr := captureClient.ReleaseBuffer(framesRead)
			if writeErr != nil {
				return fmt.Errorf("escrever pacote de áudio: %w", writeErr)
			}
			if releaseErr != nil {
				return fmt.Errorf("IAudioCaptureClient.ReleaseBuffer: %w", releaseErr)
			}
		}
	}
}

func writeAll(file *os.File, data []byte) error {
	for len(data) > 0 {
		written, err := file.Write(data)
		if err != nil {
			return err
		}
		if written == 0 {
			return fmt.Errorf("write retornou zero bytes")
		}
		data = data[written:]
	}
	return nil
}

func describeAudioFormat(format *wca.WAVEFORMATEX) (audioFormatInfo, error) {
	if format.NChannels == 0 || format.NChannels > 255 || format.NSamplesPerSec == 0 || format.NBlockAlign == 0 {
		return audioFormatInfo{}, fmt.Errorf("formato de áudio inválido: %dHz %dch block=%d", format.NSamplesPerSec, format.NChannels, format.NBlockAlign)
	}

	validBits := format.WBitsPerSample
	var subFormat *ole.GUID
	if format.WFormatTag == waveFormatExtensible && format.CbSize >= 22 {
		base := unsafe.Pointer(format)
		validBits = *(*uint16)(unsafe.Add(base, 18))
		subFormat = (*ole.GUID)(unsafe.Add(base, 24))
	}

	isFloat := format.WFormatTag == waveFormatIEEEFloat || (subFormat != nil && ole.IsEqualGUID(subFormat, ksDataFormatSubtypeFloat))
	if isFloat && format.WBitsPerSample == 32 {
		return audioFormatInfo{
			sampleKind: audioSampleFloat32,
			channels:   byte(format.NChannels),
			sampleRate: format.NSamplesPerSec,
			blockAlign: format.NBlockAlign,
			bits:       32,
			validBits:  32,
		}, nil
	}

	isPCM := format.WFormatTag == wca.WAVE_FORMAT_PCM || (subFormat != nil && ole.IsEqualGUID(subFormat, ksDataFormatSubtypePCM))
	if isPCM && (format.WBitsPerSample == 8 || format.WBitsPerSample == 16 || format.WBitsPerSample == 24 || format.WBitsPerSample == 32) {
		if validBits == 0 {
			validBits = format.WBitsPerSample
		}
		if validBits > 255 {
			validBits = 255
		}
		return audioFormatInfo{
			sampleKind: audioSamplePCM,
			channels:   byte(format.NChannels),
			sampleRate: format.NSamplesPerSec,
			blockAlign: format.NBlockAlign,
			bits:       byte(format.WBitsPerSample),
			validBits:  byte(validBits),
		}, nil
	}

	return audioFormatInfo{}, fmt.Errorf(
		"formato de áudio não suportado: tag=0x%04X bits=%d canais=%d",
		format.WFormatTag,
		format.WBitsPerSample,
		format.NChannels,
	)
}

func writeAudioHeader(file *os.File, info audioFormatInfo) error {
	header := make([]byte, 16)
	copy(header[:4], "SSAF")
	header[4] = audioStreamVersion
	header[5] = info.sampleKind
	header[6] = info.channels
	binary.LittleEndian.PutUint32(header[8:12], info.sampleRate)
	binary.LittleEndian.PutUint16(header[12:14], info.blockAlign)
	header[14] = info.bits
	header[15] = info.validBits
	return writeAll(file, header)
}

type audioClientActivationParams struct {
	activationType      uint32
	targetProcessID     uint32
	processLoopbackMode uint32
}

type propVariantBlob struct {
	vt        uint16
	reserved1 uint16
	reserved2 uint16
	reserved3 uint16
	blobSize  uint32
	padding   uint32
	blobData  uintptr
}

type activationResult struct {
	hresult uint32
	client  uintptr
}

type activationHandler struct {
	vtable uintptr
	refs   uint32
}

type activationState struct {
	handler      *activationHandler
	result       chan activationResult
	callbackDone chan struct{}
	timedOut     atomic.Bool
}

type activationHandlerVtbl struct {
	queryInterface    uintptr
	addRef            uintptr
	release           uintptr
	activateCompleted uintptr
}

var (
	activationStates sync.Map
	activationVTable = activationHandlerVtbl{
		queryInterface:    windows.NewCallback(activationQueryInterface),
		addRef:            windows.NewCallback(activationAddRef),
		release:           windows.NewCallback(activationRelease),
		activateCompleted: windows.NewCallback(activationCompleted),
	}
)

func activateProcessAudioClient(pid, loopbackMode uint32) (*wca.IAudioClient, error) {
	params := audioClientActivationParams{
		activationType:      1,
		targetProcessID:     pid,
		processLoopbackMode: loopbackMode,
	}
	propVariant := propVariantBlob{
		vt:       vtBlob,
		blobSize: uint32(unsafe.Sizeof(params)),
		blobData: uintptr(unsafe.Pointer(&params)),
	}

	handler, state, handlerKey := newActivationHandler()
	var operation uintptr
	proc := windows.NewLazySystemDLL("Mmdevapi.dll").NewProc("ActivateAudioInterfaceAsync")
	devicePath, err := windows.UTF16PtrFromString(virtualProcessLoopbackDevice)
	if err != nil {
		cleanupActivationHandler(handlerKey, handler)
		return nil, fmt.Errorf("UTF16 do caminho de loopback: %w", err)
	}

	callResult, _, _ := proc.Call(
		uintptr(unsafe.Pointer(devicePath)),
		uintptr(unsafe.Pointer(wca.IID_IAudioClient)),
		uintptr(unsafe.Pointer(&propVariant)),
		uintptr(unsafe.Pointer(handler)),
		uintptr(unsafe.Pointer(&operation)),
	)
	runtime.KeepAlive(devicePath)
	runtime.KeepAlive(&propVariant)
	runtime.KeepAlive(&params)
	runtime.KeepAlive(handler)

	if callResult != ole.S_OK {
		cleanupActivationHandler(handlerKey, handler)
		return nil, hresultError("ActivateAudioInterfaceAsync", uint32(callResult))
	}
	if operation == 0 {
		cleanupActivationHandler(handlerKey, handler)
		return nil, fmt.Errorf("ActivateAudioInterfaceAsync retornou operação nula")
	}
	defer releaseCOMObject(operation)

	select {
	case result := <-state.result:
		<-state.callbackDone
		cleanupActivationHandler(handlerKey, handler)
		if result.hresult != ole.S_OK {
			return nil, hresultError("IActivateAudioInterfaceAsyncOperation.GetActivateResult", result.hresult)
		}
		if result.client == 0 {
			return nil, fmt.Errorf("GetActivateResult retornou cliente nulo")
		}
		return (*wca.IAudioClient)(unsafe.Pointer(result.client)), nil
	case <-time.After(5 * time.Second):
		state.timedOut.Store(true)
		return nil, fmt.Errorf("timeout aguardando ativação do loopback de processo")
	}
}

func hresultError(operation string, hresult uint32) error {
	return fmt.Errorf("%s falhou com HRESULT 0x%08X", operation, hresult)
}

func newActivationHandler() (*activationHandler, *activationState, uintptr) {
	handler := &activationHandler{
		vtable: uintptr(unsafe.Pointer(&activationVTable)),
		refs:   1,
	}
	state := &activationState{
		handler:      handler,
		result:       make(chan activationResult, 1),
		callbackDone: make(chan struct{}),
	}
	key := uintptr(unsafe.Pointer(handler))
	activationStates.Store(key, state)
	return handler, state, key
}

func cleanupActivationHandler(key uintptr, handler *activationHandler) {
	activationRelease(key)
	runtime.KeepAlive(handler)
}

func activationQueryInterface(this, riid, output uintptr) uintptr {
	if this == 0 || riid == 0 || output == 0 {
		return ole.E_POINTER
	}
	iid := (*ole.GUID)(unsafe.Pointer(riid))
	if ole.IsEqualGUID(iid, ole.IID_IUnknown) ||
		ole.IsEqualGUID(iid, iidActivateCompletionHandler) ||
		ole.IsEqualGUID(iid, iidAgileObject) {
		*(*uintptr)(unsafe.Pointer(output)) = this
		activationAddRef(this)
		return ole.S_OK
	}
	*(*uintptr)(unsafe.Pointer(output)) = 0
	return ole.E_NOINTERFACE
}

func activationAddRef(this uintptr) uintptr {
	if this == 0 {
		return 0
	}
	handler := (*activationHandler)(unsafe.Pointer(this))
	return uintptr(atomic.AddUint32(&handler.refs, 1))
}

func activationRelease(this uintptr) uintptr {
	if this == 0 {
		return 0
	}
	handler := (*activationHandler)(unsafe.Pointer(this))
	for {
		current := atomic.LoadUint32(&handler.refs)
		if current == 0 {
			return 0
		}
		if atomic.CompareAndSwapUint32(&handler.refs, current, current-1) {
			if current == 1 {
				activationStates.Delete(this)
			}
			return uintptr(current - 1)
		}
	}
}

func activationCompleted(this, operation uintptr) uintptr {
	value, ok := activationStates.Load(this)
	if !ok {
		return ole.S_OK
	}
	state := value.(*activationState)
	defer close(state.callbackDone)

	result := activationResult{hresult: ole.E_FAIL}
	if operation != 0 {
		var activationHResult uint32
		var activatedClient uintptr
		method := comMethod(operation, 3) // GetActivateResult
		if method != 0 {
			callResult, _, _ := syscall.Syscall6(
				method,
				3,
				operation,
				uintptr(unsafe.Pointer(&activationHResult)),
				uintptr(unsafe.Pointer(&activatedClient)),
				0,
				0,
				0,
			)
			result.hresult = uint32(callResult)
			if callResult == ole.S_OK {
				result.hresult = activationHResult
				result.client = activatedClient
			}
		}
	}

	state.result <- result
	if state.timedOut.Load() {
		activationRelease(this)
	}
	return ole.S_OK
}

func comMethod(instance uintptr, index uintptr) uintptr {
	if instance == 0 {
		return 0
	}
	vtable := *(*uintptr)(unsafe.Pointer(instance))
	if vtable == 0 {
		return 0
	}
	methodPointer := unsafe.Add(unsafe.Pointer(vtable), int(index)*int(unsafe.Sizeof(uintptr(0))))
	return *(*uintptr)(methodPointer)
}

func releaseCOMObject(instance uintptr) {
	method := comMethod(instance, 2) // IUnknown::Release
	if method == 0 {
		return
	}
	syscall.Syscall(method, 1, instance, 0, 0)
}
