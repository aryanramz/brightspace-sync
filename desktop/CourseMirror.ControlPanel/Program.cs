using System;
using System.Threading;
using System.Windows.Forms;
using CourseMirror.Security;

namespace CourseMirror.ControlPanel
{
    internal static class Program
    {
        internal const string MutexName = CourseMirrorProcessIdentity.ControlPanelMutexName;
        internal const string LegacyMutexName = CourseMirrorProcessIdentity.LegacyControlPanelMutexName;

        [STAThread]
        private static int Main(string[] args)
        {
            int maintenanceExitCode;
            if (InstallerMaintenanceCommand.TryRun(args, out maintenanceExitCode))
                return maintenanceExitCode;

            if (args.Length == 2 && args[0] == "--installer-lifecycle-self-test")
                return InstallerMaintenanceSelfTest.Run(args[1]);

            bool installerActive;
            try { installerActive = CourseMirrorProcessIdentity.IsMutexActive(CourseMirrorProcessIdentity.InstallerLifecycleMutexName); }
            catch { return 4; }
            if (installerActive)
            {
                if (!IsScheduledRun(args))
                    MessageBox.Show("CourseMirror is being installed or repaired. Try again when setup finishes.", "CourseMirror", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return 4;
            }

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
