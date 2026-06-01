using System.Runtime.InteropServices;

namespace RemoteWork.Desktop.Services;

public sealed class ActivityMonitor
{
    public TimeSpan GetIdleDuration()
    {
        var info = new LastInputInfo();
        info.CbSize = (uint)Marshal.SizeOf<LastInputInfo>();
        if (!GetLastInputInfo(ref info))
        {
            return TimeSpan.Zero;
        }

        var idleTicks = Environment.TickCount64 - info.DwTime;
        return TimeSpan.FromMilliseconds(Math.Max(0, idleTicks));
    }

    [DllImport("user32.dll")]
    private static extern bool GetLastInputInfo(ref LastInputInfo plii);

    [StructLayout(LayoutKind.Sequential)]
    private struct LastInputInfo
    {
        public uint CbSize;
        public uint DwTime;
    }
}

