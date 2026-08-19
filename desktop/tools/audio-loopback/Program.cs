using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

namespace AudioLoopbackCapture
{
    class Program
    {
        private const string VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK = "VAD\\Process_Loopback";
        private static readonly Guid IID_IAudioClient = new Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2");
        private static readonly Guid IID_IAudioCaptureClient = new Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317");
        private static readonly Guid CLSID_MMDeviceEnumerator = new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E");

        [MTAThread]
        static int Main(string[] args)
        {
            uint pid = 0;
            bool isScreen = false;

            for (int i = 0; i < args.Length; i++)
            {
                if (args[i] == "--pid" && i + 1 < args.Length)
                {
                    uint.TryParse(args[i + 1], out pid);
                }
                else if (args[i] == "--hwnd" && i + 1 < args.Length)
                {
                    long hwndVal;
                    if (long.TryParse(args[i + 1], out hwndVal))
                    {
                        uint processId;
                        NativeMethods.GetWindowThreadProcessId(new IntPtr(hwndVal), out processId);
                        pid = processId;
                    }
                }
                else if (args[i] == "--screen" || args[i] == "--exclude-discord")
                {
                    isScreen = true;
                }
            }

            try
            {
                if (isScreen)
                {
                    uint discordRootPid = FindDiscordRootPid();
                    Console.Error.WriteLine("[AudioLoopback] isScreen: true | Discord Root PID encontrado: " + discordRootPid);
                    if (discordRootPid != 0)
                    {
                        try
                        {
                            Console.Error.WriteLine("[AudioLoopback] Iniciando loopback com exclusao da arvore do PID: " + discordRootPid);
                            CaptureProcessAudio(discordRootPid, 1); // EXCLUDE_TARGET_PROCESS_TREE
                            return 0;
                        }
                        catch (Exception ex)
                        {
                            Console.Error.WriteLine("[AudioLoopback] Falha no loopback de exclusao do Discord (PID " + discordRootPid + "): " + ex.Message);
                        }
                    }
                    Console.Error.WriteLine("[AudioLoopback] Iniciando captura do dispositivo padrao (CaptureDeviceAudio)");
                    CaptureDeviceAudio();
                    return 0;
                }
                else if (pid != 0)
                {
                    try
                    {
                        CaptureProcessAudio(pid, 0); // INCLUDE_TARGET_PROCESS_TREE
                        return 0;
                    }
                    catch (Exception ex)
                    {
                        Console.Error.WriteLine("[AudioLoopback] Fallback para dispositivo padrao: " + ex.Message);
                    }
                }

                CaptureDeviceAudio();
                return 0;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("Erro na captura de audio: " + ex.Message + "\n" + ex.StackTrace);
                return 1;
            }
        }

        private const uint TH32CS_SNAPPROCESS = 0x00000002;

        static uint FindDiscordRootPid()
        {
            try
            {
                var discordProcs = Process.GetProcessesByName("Discord");
                if (discordProcs.Length == 0) return 0;

                var parentMap = new System.Collections.Generic.Dictionary<uint, uint>();
                var discordPids = new System.Collections.Generic.HashSet<uint>();

                foreach (var p in discordProcs)
                {
                    discordPids.Add((uint)p.Id);
                }

                IntPtr hSnapshot = NativeMethods.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
                if (hSnapshot != IntPtr.Zero && hSnapshot != new IntPtr(-1))
                {
                    try
                    {
                        PROCESSENTRY32 pe = new PROCESSENTRY32();
                        pe.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32));

                        if (NativeMethods.Process32First(hSnapshot, ref pe))
                        {
                            do
                            {
                                if (pe.szExeFile.IndexOf("discord.exe", StringComparison.OrdinalIgnoreCase) >= 0)
                                {
                                    discordPids.Add(pe.th32ProcessID);
                                    parentMap[pe.th32ProcessID] = pe.th32ParentProcessID;
                                }
                            }
                            while (NativeMethods.Process32Next(hSnapshot, ref pe));
                        }
                    }
                    finally
                    {
                        NativeMethods.CloseHandle(hSnapshot);
                    }
                }

                foreach (uint dPid in discordPids)
                {
                    uint parentId;
                    if (parentMap.TryGetValue(dPid, out parentId))
                    {
                        if (!discordPids.Contains(parentId))
                        {
                            return dPid;
                        }
                    }
                }

                return (uint)discordProcs[0].Id;
            }
            catch
            {
                return 0;
            }
        }

        static void CaptureDeviceAudio()
        {
            Type enumeratorType = Type.GetTypeFromCLSID(CLSID_MMDeviceEnumerator);
            IMMDeviceEnumerator enumerator = (IMMDeviceEnumerator)Activator.CreateInstance(enumeratorType);

            IMMDevice device;
            int hr = enumerator.GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eConsole, out device);
            if (hr != 0 || device == null)
            {
                throw new InvalidOperationException(string.Format("GetDefaultAudioEndpoint falhou com HR 0x{0:X8}", hr));
            }

            Guid audioClientGuid = IID_IAudioClient;
            object clientObj;
            hr = device.Activate(ref audioClientGuid, CLSCTX.CLSCTX_ALL, IntPtr.Zero, out clientObj);
            if (hr != 0 || clientObj == null)
            {
                throw new InvalidOperationException(string.Format("device.Activate falhou com HR 0x{0:X8}", hr));
            }

            IAudioClient client = (IAudioClient)clientObj;
            RunAudioLoop(client);
        }

        static void CaptureProcessAudio(uint pid, int loopbackMode = 0)
        {
            // Run from a dedicated MTA thread to ensure COM apartment is correct
            Exception threadEx = null;
            var capturedPcm = new System.Collections.Concurrent.BlockingCollection<byte[]>(16);
            bool done = false;

            var captureThread = new Thread(() =>
            {
                try
                {
                    // Explicitly init COM as MTA
                    int coHr = NativeMethods.CoInitializeEx(IntPtr.Zero, 0); // COINIT_MULTITHREADED
                    Console.Error.WriteLine("[AudioLoopback] CoInitializeEx HR: 0x" + coHr.ToString("X8"));
                    Console.Error.WriteLine("[AudioLoopback] Thread ApartmentState: " + Thread.CurrentThread.GetApartmentState());

                    AUDIOCLIENT_ACTIVATION_PARAMS activationParams = new AUDIOCLIENT_ACTIVATION_PARAMS();
                    activationParams.ActivationType = 1; // AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK
                    activationParams.TargetProcessId = pid;
                    activationParams.ProcessLoopbackMode = loopbackMode; // 0 = INCLUDE, 1 = EXCLUDE

                    int structSize = Marshal.SizeOf(typeof(AUDIOCLIENT_ACTIVATION_PARAMS));
                    Console.Error.WriteLine("[AudioLoopback] PID=" + pid + " | sizeof(AUDIOCLIENT_ACTIVATION_PARAMS)=" + structSize);

                    IntPtr pStruct = Marshal.AllocCoTaskMem(structSize);
                    Marshal.StructureToPtr(activationParams, pStruct, false);

                    // Log struct bytes
                    byte[] structBytes = new byte[structSize];
                    Marshal.Copy(pStruct, structBytes, 0, structSize);
                    Console.Error.WriteLine("[AudioLoopback] Struct bytes: " + BitConverter.ToString(structBytes));

                    // Build PROPVARIANT (24 bytes on x64)
                    byte[] propBlob = new byte[24];
                    // vt = VT_BLOB = 0x0041 at offset 0
                    propBlob[0] = 0x41;
                    propBlob[1] = 0x00;
                    // cbSize = structSize at offset 8
                    byte[] sizeBytes = BitConverter.GetBytes((uint)structSize);
                    Array.Copy(sizeBytes, 0, propBlob, 8, 4);
                    // pBlobData = pStruct at offset 16
                    byte[] ptrBytes = BitConverter.GetBytes(pStruct.ToInt64());
                    Array.Copy(ptrBytes, 0, propBlob, 16, 8);

                    Console.Error.WriteLine("[AudioLoopback] PROPVARIANT bytes: " + BitConverter.ToString(propBlob));
                    Console.Error.WriteLine("[AudioLoopback] pBlobData = 0x" + pStruct.ToInt64().ToString("X16"));

                    IntPtr pPropVar = Marshal.AllocCoTaskMem(24);
                    Marshal.Copy(propBlob, 0, pPropVar, 24);

                    CompletionHandler completionHandler = new CompletionHandler();
                    IActivateAudioInterfaceAsyncOperation asyncOp = null;
                    Guid audioClientGuid = IID_IAudioClient;

                    try
                    {
                        int hr = NativeMethods.ActivateAudioInterfaceAsync(
                            VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
                            ref audioClientGuid,
                            pPropVar,
                            completionHandler,
                            out asyncOp);

                        Console.Error.WriteLine("[AudioLoopback] ActivateAudioInterfaceAsync HR: 0x" + hr.ToString("X8"));

                        if (hr != 0)
                            throw new InvalidOperationException("ActivateAudioInterfaceAsync falhou com HR 0x" + hr.ToString("X8"));

                        bool signaled = completionHandler.Wait(5000);
                        Console.Error.WriteLine("[AudioLoopback] Wait signaled=" + signaled + " | ActivateResultHr=0x" + completionHandler.ActivateResultHr.ToString("X8") + " | Client=" + (completionHandler.ActivatedClient != null ? "OK" : "NULL"));

                        if (!signaled || completionHandler.ActivateResultHr != 0 || completionHandler.ActivatedClient == null)
                            throw new InvalidOperationException("CompletionHandler falhou com HR 0x" + completionHandler.ActivateResultHr.ToString("X8"));
                    }
                    finally
                    {
                        Marshal.FreeCoTaskMem(pStruct);
                        Marshal.FreeCoTaskMem(pPropVar);
                        if (asyncOp != null) Marshal.ReleaseComObject(asyncOp);
                    }

                    IAudioClient client = (IAudioClient)completionHandler.ActivatedClient;

                    // Para Process Loopback (VAD\Process_Loopback), o MixFormat deve ser obtido do endpoint de áudio padrão
                    Type enumeratorType = Type.GetTypeFromCLSID(CLSID_MMDeviceEnumerator);
                    IMMDeviceEnumerator enumerator = (IMMDeviceEnumerator)Activator.CreateInstance(enumeratorType);
                    IMMDevice defaultDev;
                    enumerator.GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eConsole, out defaultDev);
                    Guid clientGuid = IID_IAudioClient;
                    object defaultClientObj;
                    defaultDev.Activate(ref clientGuid, CLSCTX.CLSCTX_ALL, IntPtr.Zero, out defaultClientObj);
                    IAudioClient defaultClient = (IAudioClient)defaultClientObj;

                    IntPtr pMixFormat;
                    int mixHr = defaultClient.GetMixFormat(out pMixFormat);
                    if (mixHr != 0 || pMixFormat == IntPtr.Zero)
                        throw new InvalidOperationException("GetMixFormat do dispositivo padrao falhou com HR 0x" + mixHr.ToString("X8"));

                    WAVEFORMATEX format = (WAVEFORMATEX)Marshal.PtrToStructure(pMixFormat, typeof(WAVEFORMATEX));
                    Console.Error.WriteLine("[AudioLoopback] MixFormat: " + format.nSamplesPerSec + "Hz " + format.nChannels + "ch " + format.wBitsPerSample + "bit");

                    long hnsRequestedDuration = 10000000;
                    Guid sessionGuid = Guid.Empty;
                    uint AUDCLNT_STREAMFLAGS_LOOPBACK = 0x00020000u;
                    uint AUDCLNT_STREAMFLAGS_EVENTCALLBACK = 0x00040000u;

                    AutoResetEvent audioEvent = new AutoResetEvent(false);

                    int initHr = client.Initialize(
                        AUDCLNT_SHAREMODE.AUDCLNT_SHAREMODE_SHARED,
                        AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
                        hnsRequestedDuration, 0, pMixFormat, ref sessionGuid);

                    if (initHr != 0)
                        throw new InvalidOperationException("client.Initialize falhou com HR 0x" + initHr.ToString("X8"));

                    client.SetEventHandle(audioEvent.SafeWaitHandle.DangerousGetHandle());

                    Guid captureGuid = IID_IAudioCaptureClient;
                    object captureObj = null;
                    client.GetService(ref captureGuid, out captureObj);
                    IAudioCaptureClient captureClient = (IAudioCaptureClient)captureObj;

                    client.Start();
                    Console.Error.WriteLine("[AudioLoopback] Captura de processo iniciada com sucesso! PID=" + pid);

                    Stream stdout = Console.OpenStandardOutput();
                    byte[] copyBuffer = new byte[65536];

                    IntPtr pData;
                    uint numFramesToRead;
                    uint flags;
                    ulong devPos, qpcPos;

                    while (!done)
                    {
                        if (!audioEvent.WaitOne(500)) continue;
                        while (true)
                        {
                            int gbHr = captureClient.GetBuffer(out pData, out numFramesToRead, out flags, out devPos, out qpcPos);
                            if (gbHr != 0 || numFramesToRead == 0) break;
                            int bytesToRead = (int)(numFramesToRead * format.nBlockAlign);
                            if (bytesToRead > copyBuffer.Length) copyBuffer = new byte[bytesToRead * 2];
                            if ((flags & 0x1) != 0) Array.Clear(copyBuffer, 0, bytesToRead);
                            else Marshal.Copy(pData, copyBuffer, 0, bytesToRead);
                            captureClient.ReleaseBuffer(numFramesToRead);
                            try { stdout.Write(copyBuffer, 0, bytesToRead); stdout.Flush(); }
                            catch { client.Stop(); return; }
                        }
                    }
                    client.Stop();
                }
                catch (Exception ex)
                {
                    threadEx = ex;
                }
                finally
                {
                    NativeMethods.CoUninitialize();
                }
            });
            captureThread.SetApartmentState(ApartmentState.MTA);
            captureThread.IsBackground = true;
            captureThread.Start();
            captureThread.Join();
            done = true;

            if (threadEx != null) throw threadEx;
        }


        static void RunAudioLoop(IAudioClient client)
        {
            IntPtr pMixFormat;
            int hr = client.GetMixFormat(out pMixFormat);
            if (hr != 0 || pMixFormat == IntPtr.Zero)
            {
                throw new InvalidOperationException(string.Format("GetMixFormat falhou com HR 0x{0:X8}", hr));
            }

            WAVEFORMATEX format = (WAVEFORMATEX)Marshal.PtrToStructure(pMixFormat, typeof(WAVEFORMATEX));

            long hnsRequestedDuration = 10000000; // 1 segundo
            Guid sessionGuid = Guid.Empty;
            uint AUDCLNT_STREAMFLAGS_LOOPBACK = 0x00020000u;
            uint AUDCLNT_STREAMFLAGS_EVENTCALLBACK = 0x00040000u;

            AutoResetEvent audioEvent = new AutoResetEvent(false);

            hr = client.Initialize(
                AUDCLNT_SHAREMODE.AUDCLNT_SHAREMODE_SHARED,
                AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
                hnsRequestedDuration,
                0,
                pMixFormat,
                ref sessionGuid);

            if (hr != 0)
            {
                throw new InvalidOperationException(string.Format("client.Initialize falhou com HR 0x{0:X8}", hr));
            }

            client.SetEventHandle(audioEvent.SafeWaitHandle.DangerousGetHandle());

            Guid captureGuid = IID_IAudioCaptureClient;
            object captureObj = null;
            client.GetService(ref captureGuid, out captureObj);
            IAudioCaptureClient captureClient = (IAudioCaptureClient)captureObj;

            client.Start();

            Stream stdout = Console.OpenStandardOutput();
            byte[] copyBuffer = new byte[65536];

            IntPtr pData;
            uint numFramesToRead;
            uint flags;
            ulong devPos;
            ulong qpcPos;

            while (true)
            {
                if (!audioEvent.WaitOne(500))
                {
                    continue;
                }

                while (true)
                {
                    hr = captureClient.GetBuffer(out pData, out numFramesToRead, out flags, out devPos, out qpcPos);
                    if (hr != 0 || numFramesToRead == 0)
                    {
                        break;
                    }

                    int bytesToRead = (int)(numFramesToRead * format.nBlockAlign);
                    if (bytesToRead > copyBuffer.Length)
                    {
                        copyBuffer = new byte[bytesToRead * 2];
                    }

                    if ((flags & 0x1) != 0) // AUDCLNT_BUFFERFLAGS_SILENT
                    {
                        Array.Clear(copyBuffer, 0, bytesToRead);
                    }
                    else
                    {
                        Marshal.Copy(pData, copyBuffer, 0, bytesToRead);
                    }

                    captureClient.ReleaseBuffer(numFramesToRead);

                    try
                    {
                        stdout.Write(copyBuffer, 0, bytesToRead);
                        stdout.Flush();
                    }
                    catch
                    {
                        client.Stop();
                        return;
                    }
                }
            }
        }
    }

    #region COM Interfaces & Structs

    enum EDataFlow
    {
        eRender,
        eCapture,
        eAll
    }

    enum ERole
    {
        eConsole,
        eMultimedia,
        eCommunications
    }

    enum CLSCTX
    {
        CLSCTX_INPROC_SERVER = 0x1,
        CLSCTX_INPROC_HANDLER = 0x2,
        CLSCTX_LOCAL_SERVER = 0x4,
        CLSCTX_ALL = 0x1 | 0x2 | 0x4
    }

    [ComImport]
    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator
    {
        [PreserveSig]
        int EnumAudioEndpoints(EDataFlow dataFlow, uint dwStateMask, out IntPtr ppDevices);
        [PreserveSig]
        int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice ppEndpoint);
        [PreserveSig]
        int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string pwstrId, out IMMDevice ppDevice);
        [PreserveSig]
        int RegisterEndpointNotificationCallback(IntPtr pClient);
        [PreserveSig]
        int UnregisterEndpointNotificationCallback(IntPtr pClient);
    }

    [ComImport]
    [Guid("D666063F-1587-4E43-81F1-B948E807363F")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice
    {
        [PreserveSig]
        int Activate([In] ref Guid iid, CLSCTX dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
        [PreserveSig]
        int OpenPropertyStore(uint stgmAccess, out IntPtr ppProperties);
        [PreserveSig]
        int GetId([MarshalAs(UnmanagedType.LPWStr)] out string ppstrId);
        [PreserveSig]
        int GetState(out uint pdwState);
    }

    [ComImport]
    [Guid("94ea2b94-e9cc-49e0-c0ff-ee64ca8f5b90")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAgileObject
    {
    }

    [ComImport]
    [Guid("41D82140-6DA0-4E0F-A0A4-1E0F189CEF14")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IActivateAudioInterfaceCompletionHandler
    {
        void ActivateCompleted(IActivateAudioInterfaceAsyncOperation activateOperation);
    }

    [ComImport]
    [Guid("72A22D78-CDE4-431D-B8CC-843A71199B6D")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IActivateAudioInterfaceAsyncOperation
    {
        void GetActivateResult(out int hr, [MarshalAs(UnmanagedType.IUnknown)] out object unk);
    }

    class CompletionHandler : IActivateAudioInterfaceCompletionHandler, IAgileObject
    {
        private readonly ManualResetEvent _event = new ManualResetEvent(false);
        private int _activateResultHr;
        private object _activatedClient;

        public int ActivateResultHr { get { return _activateResultHr; } }
        public object ActivatedClient { get { return _activatedClient; } }

        public void ActivateCompleted(IActivateAudioInterfaceAsyncOperation activateOperation)
        {
            try
            {
                int hr;
                object client;
                activateOperation.GetActivateResult(out hr, out client);
                _activateResultHr = hr;
                _activatedClient = client;
            }
            catch (Exception ex)
            {
                _activateResultHr = ex.HResult;
            }
            finally
            {
                _event.Set();
            }
        }

        public bool Wait(int timeoutMs)
        {
            return _event.WaitOne(timeoutMs);
        }
    }

    [ComImport]
    [Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioClient
    {
        [PreserveSig]
        int Initialize(AUDCLNT_SHAREMODE ShareMode, uint StreamFlags, long hnsBufferDuration, long hnsPeriodicity, IntPtr pFormat, [In] ref Guid AudioSessionGuid);
        [PreserveSig]
        int GetBufferSize(out uint pNumBufferFrames);
        [PreserveSig]
        int GetStreamLatency(out long phnsLatency);
        [PreserveSig]
        int GetCurrentPadding(out uint pNumPaddingFrames);
        [PreserveSig]
        int IsFormatSupported(AUDCLNT_SHAREMODE ShareMode, IntPtr pFormat, out IntPtr ppClosestMatch);
        [PreserveSig]
        int GetMixFormat(out IntPtr ppDeviceFormat);
        [PreserveSig]
        int GetDevicePeriod(out long phnsDefaultDevicePeriod, out long phnsMinimumDevicePeriod);
        [PreserveSig]
        int Start();
        [PreserveSig]
        int Stop();
        [PreserveSig]
        int Reset();
        [PreserveSig]
        int SetEventHandle(IntPtr eventHandle);
        [PreserveSig]
        int GetService([In] ref Guid riid, [MarshalAs(UnmanagedType.IUnknown)] out object ppv);
    }

    [ComImport]
    [Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioCaptureClient
    {
        [PreserveSig]
        int GetBuffer(out IntPtr ppData, out uint pNumFramesToRead, out uint pdwFlags, out ulong pu64DevicePosition, out ulong pu64QPCPosition);
        [PreserveSig]
        int ReleaseBuffer(uint NumFramesRead);
        [PreserveSig]
        int GetNextPacketSize(out uint pNumFramesInNextPacket);
    }

    enum AUDCLNT_SHAREMODE
    {
        AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_SHAREMODE_EXCLUSIVE
    }

    [StructLayout(LayoutKind.Sequential)]
    struct AUDIOCLIENT_ACTIVATION_PARAMS
    {
        public int ActivationType; // 1 = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK
        public uint TargetProcessId;
        public int ProcessLoopbackMode; // 0 = INCLUDE, 1 = EXCLUDE
    }

    [StructLayout(LayoutKind.Sequential)]
    class WAVEFORMATEX
    {
        public ushort wFormatTag;
        public ushort nChannels;
        public uint nSamplesPerSec;
        public uint nAvgBytesPerSec;
        public ushort nBlockAlign;
        public ushort wBitsPerSample;
        public ushort cbSize;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    struct PROCESSENTRY32
    {
        public uint dwSize;
        public uint cntUsage;
        public uint th32ProcessID;
        public IntPtr th32DefaultHeapID;
        public uint th32ModuleID;
        public uint cntThreads;
        public uint th32ParentProcessID;
        public int pcPriClassBase;
        public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string szExeFile;
    }

    #endregion

    static class NativeMethods
    {
        [DllImport("Mmdevapi.dll", ExactSpelling = true, PreserveSig = true)]
        public static extern int ActivateAudioInterfaceAsync(
            [MarshalAs(UnmanagedType.LPWStr)] string deviceInterfacePath,
            [In] ref Guid riid,
            IntPtr currentActivationParams,
            [In] IActivateAudioInterfaceCompletionHandler completionHandler,
            out IActivateAudioInterfaceAsyncOperation activationOperation);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

        [DllImport("ole32.dll", ExactSpelling = true)]
        public static extern int CoInitializeEx(IntPtr pvReserved, uint dwCoInit);

        [DllImport("ole32.dll", ExactSpelling = true)]
        public static extern void CoUninitialize();

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern IntPtr CreateToolhelp32Snapshot(uint dwFlags, uint th32ProcessID);

        [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        public static extern bool Process32First(IntPtr hSnapshot, ref PROCESSENTRY32 lppe);

        [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        public static extern bool Process32Next(IntPtr hSnapshot, ref PROCESSENTRY32 lppe);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool CloseHandle(IntPtr hObject);
    }
}
