using System;
using System.Threading;
using System.Windows.Forms;

namespace CourseMirror.ControlPanel
{
    internal static class Program
    {
        internal const string MutexName = @"Local\CourseMirror.ControlPanel";
        internal const string LegacyMutexName = @"Local\BrightspaceSync.ControlPanel";

        [STAThread]
        private static int Main(string[] args)
        {
            if (IsScheduledRun(args))
                return ScheduledRunCommand.Run();

            if (args.Length == 2 && args[0] == "--self-test")
                return ControlPanelSelfTest.Run(args[1]);

            bool ownsMutex;
            bool ownsLegacyMutex;
            using (var singleInstance = new Mutex(true, MutexName, out ownsMutex))
            using (var legacySingleInstance = new Mutex(true, LegacyMutexName, out ownsLegacyMutex))
            {
                if (!ownsMutex || !ownsLegacyMutex)
                {
                    MessageBox.Show("CourseMirror is already open.", "CourseMirror", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return 0;
                }

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new MainForm());
                GC.KeepAlive(legacySingleInstance);
                GC.KeepAlive(singleInstance);
            }
            return 0;
        }

        internal static bool IsScheduledRun(string[] args)
        {
            return args != null && args.Length == 1
                && String.Equals(args[0], "--scheduled-run", StringComparison.Ordinal);
        }
    }
}
