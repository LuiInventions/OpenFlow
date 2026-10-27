$ErrorActionPreference = "Stop"
Add-Type -ReferencedAssemblies UIAutomationClient, UIAutomationTypes -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Automation;

public static class OpenFlowChord {
  private const int WH_KEYBOARD_LL = 13;
  private const int WM_KEYDOWN = 0x0100;
  private const int WM_KEYUP = 0x0101;
  private const int WM_SYSKEYDOWN = 0x0104;
  private const int WM_SYSKEYUP = 0x0105;
  private const uint GA_ROOT = 2;
  private static IntPtr hook;
  private static HookProc proc;
  private static volatile string chordMode = "win";
  private static bool ctrl;
  private static bool mod2;
  private static bool active;
  private static bool ateMod2;
  private static uint ctrlTime;
  private static uint modTime;

  private delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);

  [StructLayout(LayoutKind.Sequential)]
  private struct KBDLLHOOKSTRUCT {
    public uint vkCode;
    public uint scanCode;
    public uint flags;
    public uint time;
    public IntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct MSG {
    public IntPtr hwnd;
    public uint message;
    public IntPtr wParam;
    public IntPtr lParam;
    public uint time;
    public int x;
    public int y;
  }

  [DllImport("user32.dll", SetLastError = true)]
  private static extern IntPtr SetWindowsHookEx(int idHook, HookProc lpfn, IntPtr hMod, uint dwThreadId);
  [DllImport("user32.dll")]
  private static extern bool UnhookWindowsHookEx(IntPtr hhk);
  [DllImport("user32.dll")]
  private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")]
  private static extern bool GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);
  [DllImport("user32.dll")]
  private static extern bool TranslateMessage(ref MSG lpMsg);
  [DllImport("user32.dll")]
  private static extern IntPtr DispatchMessage(ref MSG lpMsg);
  [DllImport("user32.dll")]
  private static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  private static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")]
  private static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")]
  private static extern IntPtr GetAncestor(IntPtr hwnd, uint gaFlags);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  private static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
  [DllImport("user32.dll")]
  private static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr processId);
  [DllImport("user32.dll")]
  private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")]
  private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("user32.dll")]
  private static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("kernel32.dll")]
  private static extern uint GetCurrentThreadId();
  [DllImport("user32.dll", SetLastError = true)]
  private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
  [DllImport("user32.dll")]
  private static extern bool GetGUIThreadInfo(uint idThread, ref GUITHREADINFO info);
  [DllImport("user32.dll")]
  private static extern short GetAsyncKeyState(int vKey);
  [DllImport("user32.dll")]
  private static extern bool OpenClipboard(IntPtr hWndNewOwner);
  [DllImport("user32.dll")]
  private static extern bool EmptyClipboard();
  [DllImport("user32.dll")]
  private static extern IntPtr SetClipboardData(uint uFormat, IntPtr hMem);
  [DllImport("user32.dll")]
  private static extern bool CloseClipboard();
  [DllImport("kernel32.dll")]
  private static extern IntPtr GlobalAlloc(uint uFlags, UIntPtr dwBytes);
  [DllImport("kernel32.dll")]
  private static extern IntPtr GlobalLock(IntPtr hMem);
  [DllImport("kernel32.dll")]
  private static extern bool GlobalUnlock(IntPtr hMem);
  [DllImport("kernel32.dll")]
  private static extern IntPtr GlobalFree(IntPtr hMem);

  private static bool pasting;

  private static void Log(string line) {
    try {
      string path = Environment.GetEnvironmentVariable("OPENFLOW_LOG");
      if (string.IsNullOrWhiteSpace(path)) return;
      File.AppendAllText(path, DateTime.Now.ToString("HH:mm:ss.fff ") + line + Environment.NewLine);
    } catch {
    }
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct RECT {
    public int left;
    public int top;
    public int right;
    public int bottom;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct GUITHREADINFO {
    public uint cbSize;
    public uint flags;
    public IntPtr hwndActive;
    public IntPtr hwndFocus;
    public IntPtr hwndCapture;
    public IntPtr hwndMenuOwner;
    public IntPtr hwndMoveSize;
    public IntPtr hwndCaret;
    public RECT rcCaret;
  }

  [StructLayout(LayoutKind.Explicit, Size = 40)]
  private struct INPUT {
    [FieldOffset(0)] public uint type;
    [FieldOffset(8)] public ushort wVk;
    [FieldOffset(10)] public ushort wScan;
    [FieldOffset(12)] public uint dwFlags;
    [FieldOffset(16)] public uint time;
    [FieldOffset(24)] public IntPtr dwExtraInfo;
  }

  private static bool IsCtrl(uint vk) { return vk == 0x11 || vk == 0xA2 || vk == 0xA3; }
  private static bool IsCtrlScan(KBDLLHOOKSTRUCT info) { return (info.scanCode & 0xFF) == 0x1D; }
  private static bool IsMod2(uint vk) {
    string mode = chordMode;
    if (mode == "space") return vk == 0x20;
    if (mode == "alt") return vk == 0x12 || vk == 0xA4 || vk == 0xA5;
    if (mode == "shift") return vk == 0x10 || vk == 0xA0 || vk == 0xA1;
    return vk == 0x5B || vk == 0x5C;
  }
  private static bool Held(int vk) { return (GetAsyncKeyState(vk) & 0x8000) != 0; }
  private static bool CtrlHeld() { return Held(0x11) || Held(0xA2) || Held(0xA3); }
  private static bool Mod2Held() {
    string mode = chordMode;
    if (mode == "space") return Held(0x20);
    if (mode == "alt") return Held(0x12) || Held(0xA4) || Held(0xA5);
    if (mode == "shift") return Held(0x10) || Held(0xA0) || Held(0xA1);
    return Held(0x5B) || Held(0x5C);
  }

  private static void SetChordMode(string raw) {
    string v = (raw ?? "").Trim().ToLowerInvariant();
    if (v == "ctrl+space" || v == "space") chordMode = "space";
    else if (v == "ctrl+alt" || v == "alt") chordMode = "alt";
    else if (v == "ctrl+shift" || v == "shift") chordMode = "shift";
    else chordMode = "win";
    ctrl = false;
    mod2 = false;
    active = false;
    ateMod2 = false;
    ctrlTime = 0;
    modTime = 0;
  }

  private static void Emit(string line) {
    Console.WriteLine(line);
    Console.Out.Flush();
  }

  private static IntPtr Callback(int nCode, IntPtr wParam, IntPtr lParam) {
    if (nCode >= 0) {
      KBDLLHOOKSTRUCT info = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
      if (pasting || (info.flags & 0x10) != 0) return CallNextHookEx(hook, nCode, wParam, lParam);
      long message = wParam.ToInt64();
      bool down = message == WM_KEYDOWN || message == WM_SYSKEYDOWN;
      bool up = message == WM_KEYUP || message == WM_SYSKEYUP;
      bool swallow = false;
      bool ctrlKey = IsCtrl(info.vkCode) || IsCtrlScan(info);
      bool modKey = IsMod2(info.vkCode) && !ctrlKey;
      if (down) {
        if (ctrlKey) {
          ctrl = true;
          ctrlTime = info.time;
          mod2 = Mod2Held();
        }
        if (modKey) {
          mod2 = true;
          modTime = info.time;
          ctrl = CtrlHeld();
        }
        bool both = ctrl && mod2 && ctrlTime != 0 && modTime != 0 && ctrlTime != modTime;
        if (both && !active) {
          active = true;
          ateMod2 = true;
          Emit("dictate-down " + GetForegroundWindow().ToInt64());
        }
        if (active && (ctrlKey || modKey)) swallow = true;
      } else if (up) {
        if (ctrlKey) ctrl = false;
        if (modKey) mod2 = false;
        if (modKey && ateMod2) {
          swallow = true;
          ateMod2 = false;
        }
        if (!ctrlKey) ctrl = ctrl && CtrlHeld();
        if (!modKey) mod2 = mod2 && Mod2Held();
        if (active && !(ctrl && mod2)) {
          active = false;
          Emit("dictate-up");
        }
      }
      if (swallow) return (IntPtr)1;
    }
    return CallNextHookEx(hook, nCode, wParam, lParam);
  }

  private static void Tap(ushort vk, bool up) {
    INPUT input = new INPUT();
    input.type = 1;
    input.wVk = vk;
    input.dwFlags = up ? 2u : 0u;
    SendInput(1, new INPUT[] { input }, Marshal.SizeOf(typeof(INPUT)));
  }

  private static void ReleaseModifiers() {
    ushort[] keys = new ushort[] { 0x11, 0xA2, 0xA3, 0x5B, 0x5C, 0x12, 0xA4, 0xA5, 0x10, 0xA0, 0xA1 };
    INPUT[] inputs = new INPUT[keys.Length];
    for (int i = 0; i < keys.Length; i++) {
      inputs[i].type = 1;
      inputs[i].wVk = keys[i];
      inputs[i].dwFlags = 2;
    }
    SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
  }

  private static bool ReadOnly(AutomationElement element) {
    object pattern;
    if (!element.TryGetCurrentPattern(ValuePattern.Pattern, out pattern)) return false;
    return ((ValuePattern)pattern).Current.IsReadOnly;
  }

  private static bool IsEditable(AutomationElement start) {
    AutomationElement current = start;
    for (int i = 0; i < 6 && current != null; i++) {
      ControlType type = current.Current.ControlType;
      if (type == ControlType.Edit || type == ControlType.Document || type == ControlType.ComboBox) return !ReadOnly(current);
      object customPattern;
      if (type == ControlType.Custom && current.TryGetCurrentPattern(ValuePattern.Pattern, out customPattern)) return !ReadOnly(current);
      if (type == ControlType.Window) break;
      current = TreeWalker.ControlViewWalker.GetParent(current);
    }
    return false;
  }

  private static IntPtr HandleOf(AutomationElement start) {
    AutomationElement current = start;
    for (int i = 0; i < 8 && current != null; i++) {
      int raw = current.Current.NativeWindowHandle;
      if (raw != 0) return new IntPtr(raw);
      current = TreeWalker.ControlViewWalker.GetParent(current);
    }
    return IntPtr.Zero;
  }

  private static bool IsShell(IntPtr hwnd) {
    if (hwnd == IntPtr.Zero) return true;
    StringBuilder name = new StringBuilder(256);
    GetClassName(hwnd, name, name.Capacity);
    string value = name.ToString();
    return value == "Progman" || value == "WorkerW" || value == "Shell_TrayWnd" || value == "Shell_SecondaryTrayWnd";
  }

  private static bool FocusRoot(IntPtr root) {
    IntPtr current = GetForegroundWindow();
    if (current == root) return true;
    uint me = GetCurrentThreadId();
    uint from = GetWindowThreadProcessId(current, IntPtr.Zero);
    uint to = GetWindowThreadProcessId(root, IntPtr.Zero);
    bool attachedFrom = from != 0 && AttachThreadInput(me, from, true);
    bool attachedTo = to != 0 && AttachThreadInput(me, to, true);
    Tap(0x12, false);
    Tap(0x12, true);
    SetForegroundWindow(root);
    BringWindowToTop(root);
    if (attachedTo) AttachThreadInput(me, to, false);
    if (attachedFrom) AttachThreadInput(me, from, false);
    Thread.Sleep(40);
    return GetForegroundWindow() == root;
  }

  private static bool HasCaret(IntPtr hwnd) {
    uint thread = GetWindowThreadProcessId(hwnd, IntPtr.Zero);
    if (thread == 0) return false;
    GUITHREADINFO info = new GUITHREADINFO();
    info.cbSize = (uint)Marshal.SizeOf(typeof(GUITHREADINFO));
    if (!GetGUIThreadInfo(thread, ref info)) return false;
    return info.hwndCaret != IntPtr.Zero;
  }

  private static bool CanType() {
    IntPtr foreground = GetForegroundWindow();
    if (IsShell(foreground)) return false;
    if (HasCaret(foreground)) return true;
    try {
      AutomationElement element = AutomationElement.FocusedElement;
      if (element == null || !IsEditable(element)) return false;
      IntPtr hwnd = HandleOf(element);
      IntPtr root = hwnd == IntPtr.Zero ? foreground : GetAncestor(hwnd, GA_ROOT);
      if (root == IntPtr.Zero) root = hwnd;
      return !IsShell(root);
    } catch {
      return false;
    }
  }

  private static bool SetClipboardText(string text) {
    if (!OpenClipboard(IntPtr.Zero)) return false;
    IntPtr memory = IntPtr.Zero;
    try {
      EmptyClipboard();
      int bytes = (text.Length + 1) * 2;
      memory = GlobalAlloc(0x0002, (UIntPtr)bytes);
      if (memory == IntPtr.Zero) return false;
      IntPtr locked = GlobalLock(memory);
      if (text.Length > 0) Marshal.Copy(text.ToCharArray(), 0, locked, text.Length);
      Marshal.WriteInt16(locked, text.Length * 2, 0);
      GlobalUnlock(memory);
      if (SetClipboardData(13, memory) == IntPtr.Zero) return false;
      memory = IntPtr.Zero;
      return true;
    } finally {
      CloseClipboard();
      if (memory != IntPtr.Zero) GlobalFree(memory);
    }
  }

  private static void ChordCtrlV() {
    INPUT[] inputs = new INPUT[4];
    ushort[] keys = new ushort[] { 0x11, 0x56, 0x56, 0x11 };
    uint[] flags = new uint[] { 0, 0, 2, 2 };
    for (int i = 0; i < inputs.Length; i++) {
      inputs[i].type = 1;
      inputs[i].wVk = keys[i];
      inputs[i].dwFlags = flags[i];
    }
    uint sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
    Log("ctrlv sent=" + sent);
  }

  private static bool FocusedHasText(string text) {
    string needle = text.Trim();
    if (needle.Length > 48) needle = needle.Substring(0, 48);
    try {
      AutomationElement current = AutomationElement.FocusedElement;
      for (int i = 0; i < 5 && current != null; i++) {
        object pattern;
        string value = null;
        if (current.TryGetCurrentPattern(TextPattern.Pattern, out pattern)) {
          value = ((TextPattern)pattern).DocumentRange.GetText(Math.Max(needle.Length + 20, 80));
        } else if (current.TryGetCurrentPattern(ValuePattern.Pattern, out pattern)) {
          value = ((ValuePattern)pattern).Current.Value;
        }
        if (value != null) return value.IndexOf(needle, StringComparison.Ordinal) >= 0;
        if (current.Current.ControlType == ControlType.Window) break;
        current = TreeWalker.ControlViewWalker.GetParent(current);
      }
    } catch (Exception ex) {
      Log("read " + ex.GetType().Name);
    }
    return true;
  }

  private static bool TypeText(string text) {
    List<INPUT> batch = new List<INPUT>();
    int size = Marshal.SizeOf(typeof(INPUT));
    for (int index = 0; index < text.Length; index++) {
      char ch = text[index];
      if (ch == '\r') continue;
      INPUT down = new INPUT();
      INPUT up = new INPUT();
      down.type = 1;
      up.type = 1;
      if (ch == '\n') {
        down.wVk = 0x0D;
        up.wVk = 0x0D;
        up.dwFlags = 2;
      } else {
        down.wScan = ch;
        up.wScan = ch;
        down.dwFlags = 4;
        up.dwFlags = 6;
      }
      batch.Add(down);
      batch.Add(up);
      if (batch.Count < 40 && index < text.Length - 1) continue;
      INPUT[] inputs = batch.ToArray();
      if (SendInput((uint)inputs.Length, inputs, size) != inputs.Length) return false;
      batch.Clear();
    }
    return true;
  }

  private static bool TryPaste(long raw, string text) {
    pasting = true;
    try {
      if (string.IsNullOrEmpty(text)) {
        Log("empty");
        return false;
      }
      ReleaseModifiers();
      Thread.Sleep(60);
      IntPtr wanted = raw == 0 ? IntPtr.Zero : new IntPtr(raw);
      Log("paste hwnd=" + raw + " chars=" + text.Length + " class=" + (wanted == IntPtr.Zero ? "" : ClassName(wanted)));
      if (wanted != IntPtr.Zero && !IsShell(wanted)) FocusRoot(wanted);
      IntPtr foreground = GetForegroundWindow();
      string foregroundClass = ClassName(foreground);
      Log("foreground=" + foreground.ToInt64() + " class=" + foregroundClass + " shell=" + IsShell(foreground));
      if (IsShell(foreground)) return false;
      if (!SetClipboardText(text)) {
        Log("clipboard-failed");
        return false;
      }
      ChordCtrlV();
      return true;
    } catch (Exception ex) {
      Log("error " + ex.GetType().Name + " " + ex.Message);
      return false;
    } finally {
      pasting = false;
    }
  }

  private static string ClassName(IntPtr hwnd) {
    if (hwnd == IntPtr.Zero) return "";
    StringBuilder name = new StringBuilder(256);
    GetClassName(hwnd, name, name.Capacity);
    return name.ToString();
  }

  private static void WatchPipe() {
    string name = Environment.GetEnvironmentVariable("OPENFLOW_PIPE");
    if (string.IsNullOrWhiteSpace(name)) name = "OpenFlowPaste";
    while (true) {
      NamedPipeServerStream pipe = null;
      try {
        pipe = new NamedPipeServerStream(name, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.None, 65536, 65536);
        pipe.WaitForConnection();
        StreamReader reader = new StreamReader(pipe, new UTF8Encoding(false), false, 256, true);
        StreamWriter writer = new StreamWriter(pipe, new UTF8Encoding(false), 256, true);
        writer.AutoFlush = true;
        string line = reader.ReadLine();
        bool ok = false;
        if (line != null && line.Trim().StartsWith("chord ")) {
          SetChordMode(line.Trim().Substring(6));
          ok = true;
        } else if (line != null && line.Trim().StartsWith("paste ")) {
          string rest = line.Trim().Substring(6);
          int space = rest.IndexOf(' ');
          long hwnd = 0;
          string payload = space > 0 ? rest.Substring(space + 1) : "";
          if (space > 0) long.TryParse(rest.Substring(0, space), out hwnd);
          string text = "";
          try { text = Encoding.UTF8.GetString(Convert.FromBase64String(payload)); } catch { text = ""; }
          ok = text.Length > 0 && TryPaste(hwnd, text);
        }
        writer.WriteLine(ok ? "ok" : "miss");
        writer.Flush();
        pipe.WaitForPipeDrain();
        pipe.Disconnect();
      } catch {
        Thread.Sleep(200);
      } finally {
        if (pipe != null) pipe.Dispose();
      }
    }
  }

  private static void WatchFocus() {
    long last = 0;
    int parentPid = 0;
    int.TryParse(Environment.GetEnvironmentVariable("OPENFLOW_PARENT_PID") ?? "0", out parentPid);
    while (true) {
      Thread.Sleep(150);
      if (parentPid > 0) {
        try {
          Process parent = Process.GetProcessById(parentPid);
          if (parent == null || parent.HasExited) {
            if (hook != IntPtr.Zero) UnhookWindowsHookEx(hook);
            Environment.Exit(0);
          }
        } catch {
          if (hook != IntPtr.Zero) UnhookWindowsHookEx(hook);
          Environment.Exit(0);
        }
      }
      IntPtr fg = GetForegroundWindow();
      if (fg == IntPtr.Zero || IsShell(fg)) continue;
      uint pid = 0;
      GetWindowThreadProcessId(fg, out pid);
      if (parentPid > 0 && pid == (uint)parentPid) continue;
      long hwnd = fg.ToInt64();
      if (hwnd > 0 && hwnd != last) {
        last = hwnd;
        Emit("focus " + hwnd);
      }
    }
  }

  public static int InputSize() { return Marshal.SizeOf(typeof(INPUT)); }

  public static void Run() {
    Console.OutputEncoding = Encoding.UTF8;
    SetChordMode(Environment.GetEnvironmentVariable("OPENFLOW_CHORD"));
    proc = Callback;
    Thread pipe = new Thread(WatchPipe);
    pipe.IsBackground = true;
    pipe.Start();
    Thread watch = new Thread(WatchFocus);
    watch.IsBackground = true;
    watch.Start();
    hook = SetWindowsHookEx(WH_KEYBOARD_LL, proc, IntPtr.Zero, 0);
    if (hook == IntPtr.Zero) {
      Emit("hook-failed");
      return;
    }
    Emit("hook-ready");
    MSG msg;
    while (GetMessage(out msg, IntPtr.Zero, 0, 0)) {
      TranslateMessage(ref msg);
      DispatchMessage(ref msg);
    }
    UnhookWindowsHookEx(hook);
  }
}
"@
[OpenFlowChord]::Run()
