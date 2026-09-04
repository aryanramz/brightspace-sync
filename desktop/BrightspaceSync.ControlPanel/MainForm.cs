using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace BrightspaceSync.ControlPanel
{
    internal sealed class MainForm : Form
    {
        internal const int StatusRefreshIntervalMilliseconds = 5000;
        private readonly Label _statusValue = new Label();
        private readonly Label _lastSyncValue = new Label();
        private readonly Button _quickButton = new Button();
        private readonly Button _fullButton = new Button();
        private readonly Button _openMirrorButton = new Button();
        private readonly Button _settingsButton = new Button();
        private readonly Button _refreshLoginButton = new Button();
        private readonly Button _viewLogsButton = new Button();
        private readonly TextBox _activity = new TextBox();
        private readonly System.Windows.Forms.Timer _statusTimer = new System.Windows.Forms.Timer();
        private readonly SemaphoreSlim _statusRefreshGate = new SemaphoreSlim(1, 1);
        private IDesktopBackendClient _backend;
        private BackendStatus _backendStatus;
        private bool _operationRunning;
        private bool _operationStarting;
        private bool _closing;

        internal MainForm() : this(null, StatusRefreshIntervalMilliseconds) { }

        internal MainForm(IDesktopBackendClient backend, int statusRefreshIntervalMilliseconds)
        {
            _backend = backend;
            Text = "Brightspace Sync";
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(520, 390);
            MinimumSize = new Size(536, 429);
            Font = new Font("Segoe UI", 9F, FontStyle.Regular, GraphicsUnit.Point);
            AutoScaleMode = AutoScaleMode.Dpi;
            FormClosing += OnFormClosing;
            FormClosed += OnFormClosed;
            Activated += async delegate { await PollStatusAsync(); };
            _statusTimer.Interval = Math.Max(100, statusRefreshIntervalMilliseconds);
            _statusTimer.Tick += async delegate { await PollStatusAsync(); };

            var title = new Label
            {
                AutoSize = true,
                Text = "Brightspace Sync",
                Font = new Font("Segoe UI Semibold", 18F, FontStyle.Bold, GraphicsUnit.Point),
                ForeColor = Color.FromArgb(34, 54, 74),
                Location = new Point(24, 20)
            };

            var statusLabel = CreateCaption("Status:", 27, 72);
            _statusValue.AutoSize = true;
            _statusValue.Text = "Loading";
            _statusValue.Location = new Point(120, 72);
            _statusValue.Font = new Font(Font, FontStyle.Bold);

            var lastSyncLabel = CreateCaption("Last Sync:", 27, 98);
            _lastSyncValue.AutoSize = true;
            _lastSyncValue.Text = "Never";
            _lastSyncValue.Location = new Point(120, 98);

            ConfigureButton(_quickButton, "Quick Sync", 27, 137, 218);
            ConfigureButton(_fullButton, "Full Sync", 275, 137, 218);
            ConfigureButton(_openMirrorButton, "Open Mirror", 27, 183, 218);
            ConfigureButton(_viewLogsButton, "View Logs", 275, 183, 218);
            ConfigureButton(_settingsButton, "Settings", 27, 229, 218);
            ConfigureButton(_refreshLoginButton, "Refresh Login", 275, 229, 218);

            _quickButton.Click += async delegate { await RunSyncAsync("quick"); };
            _fullButton.Click += async delegate { await RunSyncAsync("full"); };
            _openMirrorButton.Click += delegate { OpenResolvedDirectory(true); };
            _viewLogsButton.Click += delegate { OpenResolvedDirectory(false); };
            _settingsButton.Click += delegate { ShowDeferredFeature("Settings", "Settings will be available in the setup/settings milestone."); };
            _refreshLoginButton.Click += delegate { ShowDeferredFeature("Refresh Login", "Login refresh will be available in the authentication milestone."); };

            var activityLabel = CreateCaption("Activity / Result:", 27, 282);
            activityLabel.AutoSize = true;
            _activity.Location = new Point(27, 306);
            _activity.Size = new Size(466, 56);
            _activity.Multiline = true;
            _activity.ReadOnly = true;
            _activity.BackColor = SystemColors.Window;
            _activity.BorderStyle = BorderStyle.FixedSingle;
            _activity.Text = "Loading application status...";

            Controls.AddRange(new Control[] {
                title, statusLabel, _statusValue, lastSyncLabel, _lastSyncValue,
                _quickButton, _fullButton, _openMirrorButton, _viewLogsButton,
                _settingsButton, _refreshLoginButton, activityLabel, _activity
            });

            SetSyncButtons(false);
            Shown += async delegate
            {
                await InitializeBackendAsync();
                if (!_closing) _statusTimer.Start();
            };
        }

        internal bool SyncButtonsEnabledForSelfTest { get { return _quickButton.Enabled && _fullButton.Enabled; } }
        internal string StatusTextForSelfTest { get { return _statusValue.Text; } }
        internal int StatusRefreshIntervalForSelfTest { get { return _statusTimer.Interval; } }
        internal Task InitializeForSelfTestAsync() { return InitializeBackendAsync(); }
        internal Task<bool> PollStatusForSelfTestAsync() { return RefreshStatusAsync(false, true, true); }
        internal Task RunSyncForSelfTestAsync(string mode) { return RunSyncAsync(mode); }
        internal bool OperationStartingForSelfTest { get { return _operationStarting; } }
        internal BackendStatus BackendStatusForSelfTest { get { return _backendStatus; } }
        internal string StatusUiSnapshotForSelfTest
        {
            get { return String.Join("|", _statusValue.Text, _lastSyncValue.Text, _activity.Text, _quickButton.Enabled, _fullButton.Enabled); }
        }
        internal bool BeginClosingForSelfTest()
        {
            var args = new FormClosingEventArgs(CloseReason.UserClosing, false);
            OnFormClosing(this, args);
            return !args.Cancel;
        }

        private Label CreateCaption(string text, int x, int y)
        {
            return new Label { AutoSize = true, Text = text, Location = new Point(x, y) };
        }

        private static void ConfigureButton(Button button, string text, int x, int y, int width)
        {
            button.Text = text;
            button.Location = new Point(x, y);
            button.Size = new Size(width, 34);
            button.UseVisualStyleBackColor = true;
        }

        private async Task InitializeBackendAsync()
        {
            try
            {
                if (_backend == null) _backend = new BackendClient();
                await RefreshStatusAsync(true, false, false);
            }
            catch (Exception)
            {
                if (_closing) return;
                SetStatus("Error", Color.Firebrick);
                _activity.Text = "The packaged backend could not be started. Rebuild or repair Brightspace Sync.";
                SetSyncButtons(false);
            }
        }

        private Task<bool> PollStatusAsync()
        {
            if (_operationRunning || _operationStarting || _closing) return Task.FromResult(false);
            return RefreshStatusAsync(false, true, true);
        }

        private async Task<bool> RefreshStatusAsync(bool updateActivity, bool skipIfBusy, bool suppressFailure)
        {
            if (_backend == null || _closing) return false;
            bool entered = skipIfBusy
                ? await _statusRefreshGate.WaitAsync(0)
                : await WaitForStatusRefreshAsync();
            if (!entered) return false;

            try
            {
                if (_closing) return false;
                BackendStatus status = await _backend.GetStatusAsync();
                if (_closing) return false;
                _backendStatus = status;
                _lastSyncValue.Text = FormatLastSync(_backendStatus.lastSync);

                if (!_operationRunning)
                {
                    if (!String.IsNullOrWhiteSpace(_backendStatus.activeOperation))
                    {
                        SetStatus("Running " + _backendStatus.activeOperation, Color.DarkGoldenrod);
                        if (updateActivity) _activity.Text = "Another Brightspace operation is currently active.";
                    }
                    else
                    {
                        SetStatus("Ready", Color.DarkGreen);
                        if (updateActivity)
                        {
                            _activity.Text = _backendStatus.configured
                                ? "Ready."
                                : "Setup is not complete. Settings will be available in the next milestone.";
                        }
                    }
                }
                UpdateSyncButtons();
                return true;
            }
            catch (Exception)
            {
                if (!_closing && !suppressFailure)
                {
                    SetStatus("Error", Color.Firebrick);
                    _activity.Text = "The packaged backend could not report its status. View Logs for diagnostic information.";
                    SetSyncButtons(false);
                }
                return false;
            }
            finally
            {
                _statusRefreshGate.Release();
            }
        }

        private async Task<bool> WaitForStatusRefreshAsync()
        {
            await _statusRefreshGate.WaitAsync();
            return true;
        }

        private async Task RunSyncAsync(string mode)
        {
            if (_closing || _operationRunning || _operationStarting || _backend == null) return;
            _operationStarting = true;
            SetSyncButtons(false);
            bool refreshed = await RefreshStatusAsync(false, false, false);
            if (_closing)
            {
                _operationStarting = false;
                return;
            }
            if (!refreshed)
            {
                _operationStarting = false;
                UpdateSyncButtons();
                return;
            }
            if (!String.IsNullOrWhiteSpace(_backendStatus.activeOperation))
            {
                _operationStarting = false;
                SetStatus("Running " + _backendStatus.activeOperation, Color.DarkGoldenrod);
                _activity.Text = "Another Brightspace operation is currently active.";
                UpdateSyncButtons();
                return;
            }
            if (!_backendStatus.configured)
            {
                _operationStarting = false;
                _activity.Text = "Setup is not complete. Settings will be available in the next milestone.";
                UpdateSyncButtons();
                return;
            }

            _operationStarting = false;
            _operationRunning = true;
            SetSyncButtons(false);
            string displayMode = mode == "quick" ? "Quick Sync" : "Full Sync";
            SetStatus("Running " + displayMode, Color.DarkGoldenrod);
            _activity.Text = displayMode + " is running. This window will update when it finishes.";

            BackendProcessResult result = null;
            try
            {
                result = await _backend.RunSyncAsync(mode);
                await RefreshStatusAsync(false, false, true);

                if (result.ExitCode == 0)
                {
                    SetStatus("Completed", Color.DarkGreen);
                    _activity.Text = displayMode + " completed successfully.";
                }
                else
                {
                    SetStatus("Error", Color.Firebrick);
                    _activity.Text = String.Format("{0} failed with exit code {1}. Open View Logs for diagnostic information.", displayMode, result.ExitCode);
                    AppendFailureDiagnostic(displayMode, result.ExitCode, result.StandardError);
                }
                AppendSafeActivityLog(displayMode, result.ExitCode);
            }
            catch (Exception)
            {
                SetStatus("Error", Color.Firebrick);
                _activity.Text = displayMode + " could not be started. Open View Logs for diagnostic information.";
                AppendFailureDiagnostic(displayMode, -1, String.Empty);
                AppendSafeActivityLog(displayMode, -1);
            }
            finally
            {
                _operationRunning = false;
                UpdateSyncButtons();
            }
        }

        private void OpenResolvedDirectory(bool mirror)
        {
            if (_backendStatus == null)
            {
                MessageBox.Show("Runtime paths are not available yet.", "Brightspace Sync", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            string directory = mirror ? _backendStatus.mirrorDir : _backendStatus.logsDir;
            if (!Directory.Exists(directory))
            {
                string label = mirror ? "mirror" : "logs";
                MessageBox.Show("The " + label + " directory does not exist yet.", "Brightspace Sync", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }

            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = "explorer.exe",
                    Arguments = BackendClient.QuoteWindowsArgument(directory),
                    UseShellExecute = false,
                    CreateNoWindow = true
                });
            }
            catch (Exception)
            {
                MessageBox.Show("Windows could not open that directory.", "Brightspace Sync", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void AppendSafeActivityLog(string operation, int exitCode)
        {
            if (_backendStatus == null || String.IsNullOrWhiteSpace(_backendStatus.logsDir)) return;
            if (!Directory.Exists(_backendStatus.logsDir)) return;
            try
            {
                string line = String.Format("{0:u} Control panel: {1}; exit code {2}.{3}", DateTime.UtcNow, operation, exitCode, Environment.NewLine);
                File.AppendAllText(Path.Combine(_backendStatus.logsDir, "control-panel.log"), line, Encoding.UTF8);
            }
            catch { }
        }

        private void AppendFailureDiagnostic(string operation, int exitCode, string standardError)
        {
            if (_backendStatus == null || String.IsNullOrWhiteSpace(_backendStatus.logsDir)) return;
            try { BackendFailureLog.Append(_backendStatus.logsDir, operation, exitCode, standardError); } catch { }
        }

        private void UpdateSyncButtons()
        {
            bool enabled = !_operationRunning && !_operationStarting && _backendStatus != null && _backendStatus.configured && String.IsNullOrWhiteSpace(_backendStatus.activeOperation);
            SetSyncButtons(enabled);
        }

        private void SetSyncButtons(bool enabled)
        {
            _quickButton.Enabled = enabled;
            _fullButton.Enabled = enabled;
        }

        private void SetStatus(string text, Color color)
        {
            _statusValue.Text = text;
            _statusValue.ForeColor = color;
        }

        private static string FormatLastSync(string value)
        {
            DateTimeOffset timestamp;
            if (String.IsNullOrWhiteSpace(value) || !DateTimeOffset.TryParse(value, out timestamp)) return "Never";
            return timestamp.ToLocalTime().ToString("g");
        }

        private static void ShowDeferredFeature(string title, string message)
        {
            MessageBox.Show(message, title, MessageBoxButtons.OK, MessageBoxIcon.Information);
        }

        private void OnFormClosing(object sender, FormClosingEventArgs args)
        {
            if (!_operationRunning)
            {
                _closing = true;
                _statusTimer.Stop();
                return;
            }
            args.Cancel = true;
            MessageBox.Show("A sync is still running. Keep Brightspace Sync open until it finishes.", "Brightspace Sync", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }

        private void OnFormClosed(object sender, FormClosedEventArgs args)
        {
            _closing = true;
            _statusTimer.Stop();
            _statusTimer.Dispose();
        }
    }
}
