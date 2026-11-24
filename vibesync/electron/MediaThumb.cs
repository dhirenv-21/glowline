// Small cover-art reader used by media-helper.ps1. Built with Windows' own .NET Framework
// compiler (see build-media-thumb.ps1); needs no SDK or NuGet packages.
// PowerShell 5.1 can't pass WinRT stream objects between APIs, compiled C# can.
using System;
using System.Threading;
using Windows.Foundation;
using Windows.Media.Control;
using Windows.Storage.Streams;

public static class VibeSyncMediaThumb
{
    static T Wait<T>(IAsyncOperation<T> op, int timeoutMs)
    {
        var start = Environment.TickCount;
        while (op.Status == AsyncStatus.Started)
        {
            if (Environment.TickCount - start > timeoutMs) { op.Cancel(); throw new TimeoutException(); }
            Thread.Sleep(10);
        }
        return op.GetResults(); // throws if the operation failed
    }

    /// <summary>Returns the session's cover art as a data: URL, or null when there is none.</summary>
    public static string Read(object mediaProperties, int timeoutMs)
    {
        // PowerShell's thread is single-threaded (STA); WinRT completions can't arrive while we
        // block it, so do the work on a multi-threaded (MTA) worker thread.
        string result = null;
        Exception error = null;
        var worker = new Thread(() =>
        {
            try { result = ReadOnWorker(mediaProperties, timeoutMs); }
            catch (Exception e) { error = e; }
        });
        worker.SetApartmentState(ApartmentState.MTA);
        worker.IsBackground = true;
        worker.Start();
        if (!worker.Join(timeoutMs * 2 + 500)) throw new TimeoutException("Cover art read timed out.");
        if (error != null) throw error;
        return result;
    }

    static string ReadOnWorker(object mediaProperties, int timeoutMs)
    {
        var props = mediaProperties as GlobalSystemMediaTransportControlsSessionMediaProperties;
        if (props == null || props.Thumbnail == null) return null;
        var stream = Wait(props.Thumbnail.OpenReadAsync(), timeoutMs);
        try
        {
            var size = stream.Size;
            if (size == 0 || size > 4 * 1024 * 1024) return null;
            var reader = new DataReader(stream);
            var loaded = Wait(reader.LoadAsync((uint)size), timeoutMs);
            var bytes = new byte[loaded];
            reader.ReadBytes(bytes);
            var type = string.IsNullOrEmpty(stream.ContentType) ? "image/jpeg" : stream.ContentType;
            return "data:" + type + ";base64," + Convert.ToBase64String(bytes);
        }
        finally
        {
            stream.Dispose();
        }
    }
}
