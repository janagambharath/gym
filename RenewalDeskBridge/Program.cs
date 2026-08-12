using System;
using System.IO;
using System.Net;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace RenewalDeskBridge
{
    internal static class Program
    {
        private static readonly object CrashLogLock = new object();

        [STAThread]
        private static void Main(string[] commandLineArgs)
        {
            // Railway requires modern HTTPS.  Some customer laptops retain legacy
            // .NET Framework defaults, so make TLS 1.2 explicit for the bridge.
            ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
            Application.ThreadException += (sender, threadExceptionArgs) =>
            {
                WriteCrashLog("Unhandled Windows Forms exception", threadExceptionArgs.Exception);
                try
                {
                    MessageBox.Show(
                        "Renewal Desk Bridge caught an unexpected error and stopped the current operation.\r\n\r\n" +
                        "Verify the terminal access manually. A diagnostic file named bridge-crash.log was saved " +
                        "beside the program; please send that file to support.",
                        "Renewal Desk Bridge", MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
                catch
                {
                    // Reporting must never turn one UI exception into another one.
                }
            };
            AppDomain.CurrentDomain.UnhandledException += (sender, unhandledExceptionArgs) =>
            {
                WriteCrashLog("Unhandled application exception", unhandledExceptionArgs.ExceptionObject as Exception);
            };
            TaskScheduler.UnobservedTaskException += (sender, unobservedTaskExceptionArgs) =>
            {
                WriteCrashLog("Unobserved background task exception", unobservedTaskExceptionArgs.Exception);
                unobservedTaskExceptionArgs.SetObserved();
            };
            bool x990AccessTestMode = false;
            if (commandLineArgs != null)
            {
                foreach (string arg in commandLineArgs)
                {
                    if (string.Equals(arg, "--x990-access-test", StringComparison.OrdinalIgnoreCase))
                    {
                        x990AccessTestMode = true;
                        break;
                    }
                }
            }

            Application.Run(new BridgeForm(x990AccessTestMode));
        }

        /// <summary>
        /// Write a local, non-secret failure record so an on-site crash can be
        /// diagnosed without asking the gym to reproduce an access-control action.
        /// Never include UI fields because they contain the Bridge API key.
        /// </summary>
        internal static void WriteCrashLog(string context, Exception exception)
        {
            try
            {
                lock (CrashLogLock)
                {
                    string path = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "bridge-crash.log");
                    string detail = exception == null ? "(no exception details available)" : exception.ToString();
                    File.AppendAllText(path,
                        "[" + DateTime.UtcNow.ToString("o") + "] " + context + Environment.NewLine +
                        detail + Environment.NewLine + Environment.NewLine);
                }
            }
            catch
            {
                // A crash logger must never create a second crash.
            }
        }
    }
}
