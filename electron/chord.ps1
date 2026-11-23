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
  // The dictation shortcut is two keys, A and B. Modifier families use one code:
  // 17 Ctrl, 16 Shift, 18 Alt, 91 Win; any other value is an exact virtual key.
  private static volatile int keyA = 17;
  private static volatile int keyB = 91;
  private static bool downA;
  private static bool downB;
  private static bool active;
  private static bool ateA;
  private static bool ateB;
  private static bool maskA;
  private static bool maskB;
  private static uint timeA;
  private static uint timeB;
  // Recording a new shortcut in Settings: every key is swallowed (so Windows
  // shortcuts such as Win+K do not fire) and reported as "rec-key <vk> <char>".
  // Ends with the next chord line or by itself after 12 s, so input never stays blocked.
  private static volatile bool recording;
  private static int recordUntil;
  private static readonly HashSet<uint> recordDown = new HashSet<uint>();
  // Test support: when set, replaces the physical key state and records output.
  public static HashSet<int> FakeHeld;
  public static List<string> Trace;

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
  [DllImport("user32.dll")]
  private static extern uint MapVirtualKey(uint uCode, uint uMapType);
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

  private static int[] Family(int key) {
    if (key == 17) return new int[] { 0x11, 0xA2, 0xA3 };
    if (key == 16) return new int[] { 0x10, 0xA0, 0xA1 };
    if (key == 18) return new int[] { 0x12, 0xA4, 0xA5 };
    if (key == 91) return new int[] { 0x5B, 0x5C };
    return new int[] { key };
  }
  private static bool Matches(int key, uint vk, uint scan) {
    if (key <= 0) return false;
    if (key == 17 && (scan & 0xFF) == 0x1D) return true;
    foreach (int code in Family(key)) if (code == (int)vk) return true;
    return false;
  }
  private static bool Held(int vk) {
    HashSet<int> fake = FakeHeld;
    if (fake != null) return fake.Contains(vk);
    return (GetAsyncKeyState(vk) & 0x8000) != 0;
  }
  private static bool KeyHeld(int key) {
    if (key <= 0) return false;
    foreach (int code in Family(key)) if (Held(code)) return true;
    return false;
  }
  // Releasing Win or Alt on its own opens the Start menu or a menu bar. When such a
  // key passed through and then became part of the shortcut, tap an unassigned key
  // before its release reaches Windows.
  private static bool NeedsMask(int key) { return key == 91 || key == 18; }
  private static void Mask() {
    if (Trace != null) { Trace.Add("mask"); return; }
    Tap(0xE8, false);
    Tap(0xE8, true);
  }

  // Accepts "keys:A+B" (virtual keys) and the former preset names; "off" pauses.
  public static void SetChordMode(string raw) {
    string v = (raw ?? "").Trim().ToLowerInvariant();
    recordDown.Clear();
    if (v == "record") {
      recordUntil = Environment.TickCount + 12000;
      recording = true;
      return;
    }
    recording = false;
    int a = 17, b = 91;
    if (v == "off") { a = 0; b = 0; }
    else if (v == "ctrl+space" || v == "space") b = 0x20;
    else if (v == "ctrl+alt" || v == "alt") b = 18;
    else if (v == "ctrl+shift" || v == "shift") b = 16;
    else if (v.StartsWith("keys:")) {
      string[] parts = v.Substring(5).Split('+');
      int pa, pb;
      if (parts.Length == 2 && int.TryParse(parts[0], out pa) && int.TryParse(parts[1], out pb) && pa > 0 && pb > 0 && pa < 255 && pb < 255 && pa != pb) { a = pa; b = pb; }
    }
    keyA = a;
    keyB = b;
    downA = false;
    downB = false;
    active = false;
    ateA = false;
    ateB = false;
    maskA = false;
    maskB = false;
    timeA = 0;
    timeB = 0;
  }

  private static void Emit(string line) {
    if (Trace != null) { Trace.Add(line); return; }
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
      if (Feed(info.vkCode, info.scanCode, down, up, info.time)) return (IntPtr)1;
    }
    return CallNextHookEx(hook, nCode, wParam, lParam);
  }

  // Shortcut state machine; returns true when the key event must be swallowed.
  // The key that completes the shortcut is swallowed together with its release, so
  // the focused app never sees it; the key pressed first passes through normally.
  public static bool Feed(uint vk, uint scan, bool down, bool up, uint time) {
    if (recording) {
      if (unchecked(Environment.TickCount - recordUntil) < 0) {
        if (down && recordDown.Add(vk)) Emit("rec-key " + vk + " " + (MapVirtualKey(vk, 2) & 0xFFFF));
        if (up) recordDown.Remove(vk);
        return true;
      }
      recording = false;
      recordDown.Clear();
    }
    int a = keyA, b = keyB;
    bool isA = Matches(a, vk, scan);
    bool isB = !isA && Matches(b, vk, scan);
    if (!isA && !isB) return false;
    bool swallow = false;
    if (down) {
      if (isA) { downA = true; timeA = time; downB = downB && KeyHeld(b); }
      if (isB) { downB = true; timeB = time; downA = downA && KeyHeld(a); }
      bool both = downA && downB && timeA != 0 && timeB != 0 && timeA != timeB;
      if (both && !active) {
        active = true;
        ateA = isA;
        ateB = isB;
        maskA = !isA && NeedsMask(a);
        maskB = !isB && NeedsMask(b);
        Emit("dictate-down " + GetForegroundWindow().ToInt64());
      }
      if (active) swallow = true;
    } else if (up) {
      if (isA) {
        downA = false;
        if (ateA) { swallow = true; ateA = false; }
        else if (maskA) { Mask(); maskA = false; }
      }
      if (isB) {
        downB = false;
        if (ateB) { swallow = true; ateB = false; }
        else if (maskB) { Mask(); maskB = false; }
      }
      if (active && !(downA && downB)) {
        active = false;
        Emit("dictate-up");
      }
    }
    return swallow;
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
