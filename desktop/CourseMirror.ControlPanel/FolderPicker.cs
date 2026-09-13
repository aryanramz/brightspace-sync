using System;
using System.IO;
using System.Windows.Forms;

namespace CourseMirror.ControlPanel
{
    internal interface IFolderPicker
    {
        string SelectFolder(IWin32Window owner, string description, string initialPath);
    }

    internal sealed class WindowsFolderPicker : IFolderPicker
    {
        public string SelectFolder(IWin32Window owner, string description, string initialPath)
        {
            using (var dialog = new FolderBrowserDialog())
            {
                dialog.Description = description;
                dialog.ShowNewFolderButton = true;
                if (!String.IsNullOrWhiteSpace(initialPath) && Directory.Exists(initialPath))
                    dialog.SelectedPath = initialPath;
                return dialog.ShowDialog(owner) == DialogResult.OK ? dialog.SelectedPath : null;
            }
        }
    }
}
