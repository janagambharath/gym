using System;
using System.Collections.Concurrent;
using System.Threading;
using System.Threading.Tasks;

namespace RenewalDeskBridge.Device
{
    /// <summary>
    /// Owns a single-threaded apartment (STA) worker thread for legacy COM
    /// components (zkemkeeper). Every COM call is marshaled onto this thread so
    /// the object is always created and touched in one apartment: no
    /// cross-thread COM marshaling, no UI-thread blocking, and no reentrancy
    /// deadlocks. Invoke is reentrant — calling it from the STA thread itself
    /// runs the delegate inline.
    /// </summary>
    public sealed class StaDispatcher : IDisposable
    {
        private readonly BlockingCollection<Action> _queue = new BlockingCollection<Action>();
        private readonly Thread _thread;
        private bool _disposed;

        public StaDispatcher(string threadName = "COM-STA")
        {
            _thread = new Thread(Run)
            {
                IsBackground = true,
                Name = threadName
            };
            _thread.SetApartmentState(ApartmentState.STA);
            _thread.Start();
        }

        private void Run()
        {
            foreach (var action in _queue.GetConsumingEnumerable())
            {
                try { action(); }
                catch { /* the TaskCompletionSource already carries the error */ }
            }
        }

        public T Invoke<T>(Func<T> func)
        {
            if (_disposed) throw new ObjectDisposedException(nameof(StaDispatcher));
            // Reentrant: already on the STA thread — run inline, never queue.
            if (Thread.CurrentThread == _thread) return func();
            var tcs = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
            _queue.Add(() =>
            {
                try { tcs.SetResult(func()); }
                catch (Exception ex) { tcs.SetException(ex); }
            });
            return tcs.Task.GetAwaiter().GetResult();
        }

        public void Invoke(Action action)
        {
            Invoke<object>(() => { action(); return null; });
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            _queue.CompleteAdding();
            // Do not block shutdown forever on a hung COM call.
            _thread.Join(TimeSpan.FromSeconds(5));
            _queue.Dispose();
        }
    }
}
