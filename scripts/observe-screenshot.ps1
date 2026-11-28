$ErrorActionPreference = "Stop"
# Test harness: observe capture windows and close only a test-owned window/PID.
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class ScreenshotObserver {
  private delegate bool Callback(IntPtr hwnd, IntPtr unused);
  [DllImport("user32.dll")] private static extern bool EnumWindows(Callback callback, IntPtr unused);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int size);
  [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
  [StructLayout(LayoutKind.Sequential)] private struct Rect { public int left,top,right,bottom; }
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr hwnd,uint message,IntPtr wParam,IntPtr lParam);
  public static uint Owner(long window) { uint pid; GetWindowThreadProcessId(new IntPtr(window),out pid); return pid; }
  public static bool Close(long window,uint expectedPid,bool escape) {
    if (Owner(window)!=expectedPid || Find()!=window) return false;
    if (escape) {
      bool sent=PostMessage(new IntPtr(window),0x0100,new IntPtr(27),new IntPtr(1));
      PostMessage(new IntPtr(window),0x0101,new IntPtr(27),new IntPtr(1));
      return sent;
    }
    return PostMessage(new IntPtr(window),0x0010,IntPtr.Zero,IntPtr.Zero);
  }
  public static bool Visible(long window) { return IsWindowVisible(new IntPtr(window)); }
  public static long Find() {
    long found=0;
    EnumWindows(delegate(IntPtr hwnd, IntPtr unused) {
      if (!IsWindowVisible(hwnd)) return true;
      var text=new StringBuilder(256); GetWindowText(hwnd,text,text.Capacity);
      Rect rect;
      if (text.ToString().Equals("flameshot",StringComparison.OrdinalIgnoreCase) && GetWindowRect(hwnd,out rect) && rect.right-rect.left>300 && rect.bottom-rect.top>300) {
        found=hwnd.ToInt64(); return false;
      }
      return true;
    },IntPtr.Zero);
    return found;
  }
}
"@
[Console]::WriteLine("ready")
while ($null -ne ($line = [Console]::ReadLine())) {
  if ($line.StartsWith('close ') -or $line.StartsWith('escape ')) {
    $parts = $line.Split(' ')
    if (-not [ScreenshotObserver]::Close([long]$parts[1],[uint32]$parts[2],($parts[0] -eq "escape"))) { [Console]::WriteLine('refused'); continue }
    $closing = [Diagnostics.Stopwatch]::StartNew()
    while ([ScreenshotObserver]::Visible([long]$parts[1]) -and $closing.ElapsedMilliseconds -lt 3000) { [Threading.Thread]::Sleep(2) }
    if ([ScreenshotObserver]::Visible([long]$parts[1])) { [Console]::WriteLine('close-timeout') } else { [Console]::WriteLine('closed') }; continue
  }
  $start = [Diagnostics.Stopwatch]::StartNew()
  while ($start.ElapsedMilliseconds -lt 15000) {
    $window = [ScreenshotObserver]::Find()
    if ($window -ne 0) { [Console]::WriteLine("visible $window $([ScreenshotObserver]::Owner($window))"); break }
    [Threading.Thread]::Sleep(2)
  }
}
