using System;
using System.Threading;

namespace CourseMirror.Security
{
    internal static class CourseMirrorProcessIdentity
    {
        internal const string ControlPanelMutexName = @"Local\CourseMirror.ControlPanel";
        internal const string LegacyControlPanelMutexName = @"Local\BrightspaceSync.ControlPanel";
        internal const string CredentialHelperMutexName = @"Local\CourseMirror.CredentialHelper";
        internal const string InstallerLifecycleMutexName = @"Local\CourseMirror.InstallerLifecycle";

        internal static bool IsMutexActive(string name)
        {
            if (String.IsNullOrWhiteSpace(name)) throw new ArgumentException("A mutex name is required.", "name");
            try
            {
                using (Mutex.OpenExisting(name)) return true;
            }
            catch (WaitHandleCannotBeOpenedException)
            {
                return false;
            }
        }
    }
}
