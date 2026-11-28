$ErrorActionPreference = "Stop"
# Read-only native-window observer. No keyboard/mouse input or UI Automation.
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
  $start = [Diagnostics.Stopwatch]::StartNew()
  while ($start.ElapsedMilliseconds -lt 15000) {
    $window = [ScreenshotObserver]::Find()
    if ($window -ne 0) { [Console]::WriteLine("visible $window"); break }
    [Threading.Thread]::Sleep(2)
  }
}
