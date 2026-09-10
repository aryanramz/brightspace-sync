using System;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace BrightspaceSync.ControlPanel
{
    internal interface ISettingsDialogService
    {
        Task<bool> ShowAsync(IWin32Window owner, IDesktopBackendClient backend, bool firstRun);
    }

    internal sealed class SettingsDialogService : ISettingsDialogService
    {
        public async Task<bool> ShowAsync(IWin32Window owner, IDesktopBackendClient backend, bool firstRun)
        {
            DesktopSettings settings = await backend.GetSettingsAsync();
            using (var form = new SetupSettingsForm(backend, settings, firstRun, new WindowsFolderPicker()))
                return form.ShowDialog(owner) == DialogResult.OK;
        }
    }

    internal sealed class SetupSettingsForm : Form
    {
        private readonly IDesktopBackendClient _backend;
        private readonly IFolderPicker _folderPicker;
        private readonly TextBox _baseUrl = new TextBox();
        private readonly TextBox _mirrorDir = new TextBox();
        private readonly CheckBox _driveEnabled = new CheckBox();
        private readonly TextBox _driveDestination = new TextBox();
        private readonly Button _mirrorBrowse = new Button();
        private readonly Button _driveBrowse = new Button();
        private readonly Button _save = new Button();
        private readonly Button _cancel = new Button();
        private readonly Label _validation = new Label();
        private readonly bool _mirrorOverrideActive;
        private bool _saving;

        internal SetupSettingsForm(IDesktopBackendClient backend, DesktopSettings settings, bool firstRun, IFolderPicker folderPicker)
        {
            if (backend == null) throw new ArgumentNullException("backend");
            if (settings == null) throw new ArgumentNullException("settings");
            _backend = backend;
            _folderPicker = folderPicker ?? new WindowsFolderPicker();
            _mirrorOverrideActive = settings.mirrorOverrideActive;

            Text = firstRun ? "Set up Brightspace Sync" : "Brightspace Sync Settings";
            StartPosition = FormStartPosition.CenterParent;
            ClientSize = new Size(590, 415);
            MinimumSize = new Size(606, 454);
            MaximizeBox = false;
            MinimizeBox = false;
            ShowInTaskbar = false;
            Font = new Font("Segoe UI", 9F, FontStyle.Regular, GraphicsUnit.Point);
            AutoScaleMode = AutoScaleMode.Dpi;

            var title = new Label
            {
                AutoSize = true,
                Text = firstRun ? "Set up Brightspace Sync" : "Settings",
                Font = new Font("Segoe UI Semibold", 16F, FontStyle.Bold, GraphicsUnit.Point),
                ForeColor = Color.FromArgb(34, 54, 74),
                Location = new Point(22, 18)
            };
            var intro = new Label
            {
                AutoSize = true,
                Text = firstRun
                    ? "Choose your Brightspace site and where course files should be stored."
                    : "Update the Brightspace site and file locations used by this application.",
                Location = new Point(25, 55)
            };

            var urlLabel = CreateLabel("Brightspace URL", 25, 88);
            _baseUrl.Location = new Point(25, 109);
            _baseUrl.Size = new Size(540, 24);
            _baseUrl.Text = settings.baseUrl ?? String.Empty;
            _baseUrl.TabIndex = 0;

            var mirrorLabel = CreateLabel("Mirror folder", 25, 148);
            _mirrorDir.Location = new Point(25, 169);
            _mirrorDir.Size = new Size(447, 24);
            _mirrorDir.Text = InitialMirrorPath(settings, firstRun);
            _mirrorDir.ReadOnly = _mirrorOverrideActive;
            _mirrorDir.TabIndex = 1;
            ConfigureBrowse(_mirrorBrowse, 482, 167, 2);
            _mirrorBrowse.Enabled = !_mirrorOverrideActive;
            _mirrorBrowse.Click += delegate
            {
                string selected = _folderPicker.SelectFolder(this, "Choose the Brightspace mirror folder.", _mirrorDir.Text);
                if (!String.IsNullOrWhiteSpace(selected)) _mirrorDir.Text = Path.GetFullPath(selected);
            };

            var overrideLabel = new Label
            {
                AutoSize = true,
                ForeColor = Color.DarkGoldenrod,
                Location = new Point(25, 197),
                Text = _mirrorOverrideActive
                    ? "An administrator/environment override controls the effective mirror folder."
                    : "Course files only are stored here. Private app data remains separate."
            };

            var driveGroup = new GroupBox
            {
                Text = "Google Drive publishing (optional)",
                Location = new Point(25, 229),
                Size = new Size(540, 105)
            };
            _driveEnabled.AutoSize = true;
            _driveEnabled.Location = new Point(14, 24);
            _driveEnabled.Text = "Publish mirror to Google Drive";
            _driveEnabled.Checked = settings.drive != null && settings.drive.enabled;
            _driveEnabled.TabIndex = 3;
            _driveEnabled.CheckedChanged += delegate { UpdateDriveControls(); };
            _driveDestination.Location = new Point(14, 59);
            _driveDestination.Size = new Size(425, 24);
            _driveDestination.Text = settings.drive == null ? String.Empty : (settings.drive.destination ?? String.Empty);
            _driveDestination.TabIndex = 4;
            ConfigureBrowse(_driveBrowse, 449, 57, 5);
            _driveBrowse.Click += delegate
            {
                string selected = _folderPicker.SelectFolder(this, "Choose a Google Drive for desktop destination.", _driveDestination.Text);
                if (!String.IsNullOrWhiteSpace(selected)) _driveDestination.Text = Path.GetFullPath(selected);
            };
            driveGroup.Controls.AddRange(new Control[] { _driveEnabled, _driveDestination, _driveBrowse });

            _validation.Location = new Point(25, 344);
            _validation.Size = new Size(365, 42);
            _validation.ForeColor = Color.Firebrick;

            _save.Text = "Save";
            _save.Location = new Point(400, 359);
            _save.Size = new Size(78, 32);
            _save.TabIndex = 6;
            _save.Click += async delegate { await SaveAsync(null, true); };
            _cancel.Text = "Cancel";
            _cancel.Location = new Point(487, 359);
            _cancel.Size = new Size(78, 32);
            _cancel.TabIndex = 7;
            _cancel.DialogResult = DialogResult.Cancel;

            AcceptButton = _save;
            CancelButton = _cancel;
            FormClosing += delegate(object sender, FormClosingEventArgs args)
            {
                if (!_saving) return;
                args.Cancel = true;
                _validation.Text = "Wait for the settings operation to finish.";
            };
            Controls.AddRange(new Control[] {
                title, intro, urlLabel, _baseUrl, mirrorLabel, _mirrorDir, _mirrorBrowse,
                overrideLabel, driveGroup, _validation, _save, _cancel
            });
            UpdateDriveControls();
        }

        internal static string SuggestedFirstRunMirror()
        {
            string documents = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
            return Path.GetFullPath(Path.Combine(documents, "Brightspace Sync"));
        }

        internal SettingsSaveRequest RequestForSelfTest()
        {
            return BuildRequest(null);
        }

        internal bool MirrorEditableForSelfTest { get { return !_mirrorDir.ReadOnly && _mirrorBrowse.Enabled; } }

        internal Task<bool> SaveForSelfTestAsync(string mirrorAction)
        {
            return SaveAsync(mirrorAction, false);
        }

        internal void CancelForSelfTest()
        {
            DialogResult = DialogResult.Cancel;
        }

        private static string InitialMirrorPath(DesktopSettings settings, bool firstRun)
        {
            if (firstRun && !settings.configured && !settings.mirrorOverrideActive)
                return SuggestedFirstRunMirror();
            return settings.mirrorDir ?? String.Empty;
        }

        private static Label CreateLabel(string text, int x, int y)
        {
            return new Label { AutoSize = true, Text = text, Location = new Point(x, y) };
        }

        private static void ConfigureBrowse(Button button, int x, int y, int tabIndex)
        {
            button.Text = "Browse...";
            button.Location = new Point(x, y);
            button.Size = new Size(83, 28);
            button.TabIndex = tabIndex;
            button.UseVisualStyleBackColor = true;
        }

        private void UpdateDriveControls()
        {
            _driveDestination.Enabled = _driveEnabled.Checked;
            _driveBrowse.Enabled = _driveEnabled.Checked;
        }

        private SettingsSaveRequest BuildRequest(string mirrorAction)
        {
            return new SettingsSaveRequest
            {
                schemaVersion = 1,
                baseUrl = _baseUrl.Text.Trim(),
                mirrorDir = _mirrorDir.Text.Trim(),
                drive = new DesktopDriveSettings
                {
                    enabled = _driveEnabled.Checked,
                    destination = _driveDestination.Text.Trim()
                },
                mirrorAction = mirrorAction
            };
        }

        private async Task<bool> SaveAsync(string mirrorAction, bool interactive)
        {
            if (_saving) return false;
            _saving = true;
            SetInputsEnabled(false);
            _validation.Text = "Saving...";
            try
            {
                SettingsSaveResponse response = await _backend.SaveSettingsAsync(BuildRequest(mirrorAction));
                if (response.ok)
                {
                    _validation.Text = String.Empty;
                    if (interactive)
                    {
                        _saving = false;
                        DialogResult = DialogResult.OK;
                        Close();
                    }
                    return true;
                }

                if (interactive && response.relocation != null && response.relocation.required)
                {
                    DialogResult choice = MessageBox.Show(
                        "The existing mirror contains course files.\n\n" +
                        "Yes: Move the existing mirror to the new folder.\n" +
                        "No: Use the new folder and leave old files untouched.\n" +
                        "Cancel: Make no settings change.",
                        "Change mirror folder",
                        MessageBoxButtons.YesNoCancel,
                        MessageBoxIcon.Question,
                        MessageBoxDefaultButton.Button3);
                    if (choice == DialogResult.Cancel)
                    {
                        _validation.Text = "No changes were saved.";
                        return false;
                    }
                    _saving = false;
                    SetInputsEnabled(true);
                    return await SaveAsync(choice == DialogResult.Yes ? "move" : "use-new", true);
                }

                SettingsValidationError error = response.errors == null ? null : response.errors.FirstOrDefault();
                _validation.Text = error == null ? "Settings could not be saved." : error.message;
                return false;
            }
            catch (Exception)
            {
                _validation.Text = "Settings could not be saved. Try again, or open View Logs for diagnostics.";
                return false;
            }
            finally
            {
                _saving = false;
                if (!IsDisposed) SetInputsEnabled(true);
            }
        }

        private void SetInputsEnabled(bool enabled)
        {
            _baseUrl.Enabled = enabled;
            _mirrorDir.Enabled = enabled;
            _mirrorBrowse.Enabled = enabled && !_mirrorOverrideActive;
            _driveEnabled.Enabled = enabled;
            _driveDestination.Enabled = enabled && _driveEnabled.Checked;
            _driveBrowse.Enabled = enabled && _driveEnabled.Checked;
            _save.Enabled = enabled;
            _cancel.Enabled = enabled;
        }
    }
}
