using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace BrightspaceSync.ControlPanel
{
    internal sealed class BackendPaths
    {
        internal string ApplicationRoot { get; private set; }
        internal string NodeExecutable { get; private set; }
        internal string LauncherScript { get; private set; }
        internal string WorkingDirectory { get; private set; }

        private BackendPaths() { }

        internal static BackendPaths Resolve()
        {
            string root = Environment.GetEnvironmentVariable("BRIGHTSPACE_SYNC_DEV_BUNDLE_ROOT");
            if (String.IsNullOrWhiteSpace(root))
                root = AppDomain.CurrentDomain.BaseDirectory;

            root = Path.GetFullPath(root);
            string node = Path.Combine(root, "runtime", "node.exe");
            string app = Path.Combine(root, "app");
            string launcher = Path.Combine(app, "src", "launcher.mjs");

            if (!File.Exists(node))
                throw new FileNotFoundException("The private Brightspace Sync runtime is missing. Rebuild or repair the application.", node);
            if (!File.Exists(launcher))
                throw new FileNotFoundException("The Brightspace Sync backend is missing. Rebuild or repair the application.", launcher);

            return new BackendPaths
            {
                ApplicationRoot = root.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar),
                NodeExecutable = node,
                LauncherScript = launcher,
                WorkingDirectory = app
            };
        }
    }

    internal sealed class BackendStatus
    {
        public int schemaVersion { get; set; }
        public string appVersion { get; set; }
        public string status { get; set; }
        public bool configExists { get; set; }
        public bool configured { get; set; }
        public bool baseUrlConfigured { get; set; }
        public string mirrorDir { get; set; }
        public string logsDir { get; set; }
        public string dataDir { get; set; }
        public bool profileExists { get; set; }
        public string lastSync { get; set; }
        public string activeOperation { get; set; }
    }

    internal sealed class BackendProcessResult
    {
        internal int ExitCode { get; set; }
        internal string StandardOutput { get; set; }
        internal string StandardError { get; set; }
    }

    internal sealed class BackendCommandException : Exception
    {
        internal int ExitCode { get; private set; }

        internal BackendCommandException(string message, int exitCode)
            : base(message)
        {
            ExitCode = exitCode;
        }
    }

    internal sealed class BoundedOutputBuffer
    {
        private readonly int _maximumCharacters;
        private readonly StringBuilder _value = new StringBuilder();
        private readonly object _gate = new object();

        internal BoundedOutputBuffer(int maximumCharacters)
        {
            _maximumCharacters = maximumCharacters;
        }

        internal void AppendLine(string line)
        {
            if (line == null) return;
            lock (_gate)
            {
                _value.AppendLine(line);
                if (_value.Length > _maximumCharacters)
                    _value.Remove(0, _value.Length - _maximumCharacters);
            }
        }

        public override string ToString()
        {
            lock (_gate) return _value.ToString();
        }
    }

    internal interface IDesktopBackendClient
    {
        Task<BackendStatus> GetStatusAsync();
        Task<BackendProcessResult> RunSyncAsync(string mode);
    }

    internal sealed class BackendClient : IDesktopBackendClient
    {
        internal const int SupportedStatusSchemaVersion = 1;
        private readonly BackendPaths _paths;
        private readonly JavaScriptSerializer _json = new JavaScriptSerializer();

        internal BackendClient()
        {
            _paths = BackendPaths.Resolve();
        }

        internal BackendPaths Paths { get { return _paths; } }

        internal ProcessStartInfo CreateStartInfo(string command, params string[] arguments)
        {
            if (String.IsNullOrWhiteSpace(command)) throw new ArgumentException("A backend command is required.", "command");

            var allArguments = new List<string>();
            allArguments.Add(_paths.LauncherScript);
            allArguments.Add(command);
            if (arguments != null) allArguments.AddRange(arguments);

            var quoted = new List<string>();
            foreach (string argument in allArguments) quoted.Add(QuoteWindowsArgument(argument));

            var startInfo = new ProcessStartInfo
            {
                FileName = _paths.NodeExecutable,
                Arguments = String.Join(" ", quoted.ToArray()),
                WorkingDirectory = _paths.WorkingDirectory,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            startInfo.EnvironmentVariables["BRIGHTSPACE_SYNC_GUI"] = "1";
            return startInfo;
        }

        internal async Task<BackendProcessResult> RunAsync(string command, params string[] arguments)
        {
            var stdout = new BoundedOutputBuffer(32768);
            var stderr = new BoundedOutputBuffer(32768);

            using (var process = new Process())
            {
                process.StartInfo = CreateStartInfo(command, arguments);
                process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) { stdout.AppendLine(e.Data); };
                process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { stderr.AppendLine(e.Data); };

                if (!process.Start()) throw new InvalidOperationException("The Brightspace Sync backend did not start.");
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();
                await Task.Run(new Action(process.WaitForExit));

                return new BackendProcessResult
                {
                    ExitCode = process.ExitCode,
                    StandardOutput = stdout.ToString(),
                    StandardError = stderr.ToString()
                };
            }
        }

        public async Task<BackendStatus> GetStatusAsync()
        {
            BackendProcessResult result = await RunAsync("status", "--json");
            if (result.ExitCode != 0)
                throw new BackendCommandException("The Brightspace Sync backend could not report its status.", result.ExitCode);

            string jsonLine = LastNonEmptyLine(result.StandardOutput);
            BackendStatus status;
            try
            {
                status = _json.Deserialize<BackendStatus>(jsonLine);
            }
            catch (Exception error)
            {
                throw new InvalidDataException("The Brightspace Sync backend returned an invalid status response.", error);
            }

            if (status == null || status.schemaVersion != SupportedStatusSchemaVersion)
                throw new InvalidDataException("The Brightspace Sync backend status schema is not supported.");
            if (String.IsNullOrWhiteSpace(status.mirrorDir) || String.IsNullOrWhiteSpace(status.logsDir) || String.IsNullOrWhiteSpace(status.dataDir))
                throw new InvalidDataException("The Brightspace Sync backend status response is incomplete.");
            return status;
        }

        public Task<BackendProcessResult> RunSyncAsync(string mode)
        {
            if (mode != "quick" && mode != "full") throw new ArgumentOutOfRangeException("mode");
            return RunAsync(mode);
        }

        internal static string LastNonEmptyLine(string value)
        {
            string[] lines = (value ?? String.Empty).Split(new[] { "\r\n", "\n" }, StringSplitOptions.RemoveEmptyEntries);
            return lines.Length == 0 ? String.Empty : lines[lines.Length - 1].Trim();
        }

        internal static string QuoteWindowsArgument(string argument)
        {
            argument = argument ?? String.Empty;
            if (argument.Length > 0 && argument.IndexOfAny(new[] { ' ', '\t', '\n', '\v', '"' }) < 0)
                return argument;

            var result = new StringBuilder();
            result.Append('"');
            int backslashes = 0;
            foreach (char character in argument)
            {
                if (character == '\\')
                {
                    backslashes++;
                    continue;
                }
                if (character == '"')
                {
                    result.Append('\\', backslashes * 2 + 1);
                    result.Append('"');
                    backslashes = 0;
                    continue;
                }
                result.Append('\\', backslashes);
                backslashes = 0;
                result.Append(character);
            }
            result.Append('\\', backslashes * 2);
            result.Append('"');
            return result.ToString();
        }
    }
}
