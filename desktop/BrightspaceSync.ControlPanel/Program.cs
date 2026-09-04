using System;
using System.Threading;
using System.Windows.Forms;

namespace BrightspaceSync.ControlPanel
{
    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            if (args.Length == 2 && args[0] == "--self-test")
                return ControlPanelSelfTest.Run(args[1]);

            bool ownsMutex;
            using (var singleInstance = new Mutex(true, @"Local\BrightspaceSync.ControlPanel", out ownsMutex))
            {
                if (!ownsMutex)
                {
                    MessageBox.Show("Brightspace Sync is already open.", "Brightspace Sync", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return 0;
                }

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new MainForm());
                GC.KeepAlive(singleInstance);
            }
            return 0;
        }
    }
}
