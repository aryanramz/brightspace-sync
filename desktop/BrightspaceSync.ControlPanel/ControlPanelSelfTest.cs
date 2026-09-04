using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace BrightspaceSync.ControlPanel
{
    internal static class ControlPanelSelfTest
    {
        internal static int Run(string outputFile)
        {
            WindowsFormsSynchronizationContext.AutoInstall = false;
            SynchronizationContext.SetSynchronizationContext(null);
            return RunAsync(outputFile).GetAwaiter().GetResult();
        }

        private static async Task<int> RunAsync(string outputFile)
        {
            try
            {
                var backend = new BackendClient();
                ProcessStartInfo startInfo = backend.CreateStartInfo("status", "--json");
                ProcessStartInfo quickStartInfo = backend.CreateStartInfo("quick");
                ProcessStartInfo fullStartInfo = backend.CreateStartInfo("full");
                BackendStatus status = await backend.GetStatusAsync();

                bool initialButtonsEnabled;
                bool externalLockStartedDisablesButtons;
                bool externalLockFinishedReturnsReady;
                string lockFile = Path.Combine(status.dataDir, "state", ".brightspace-sync.lock");
                using (var form = new MainForm(backend, MainForm.StatusRefreshIntervalMilliseconds))
                {
                    SynchronizationContext.SetSynchronizationContext(null);
                    await form.InitializeForSelfTestAsync();
                    initialButtonsEnabled = form.SyncButtonsEnabledForSelfTest;
                    File.WriteAllText(lockFile, new JavaScriptSerializer().Serialize(new
                    {
                        schemaVersion = 1,
                        pid = Process.GetCurrentProcess().Id,
                        mode = "scheduled",
                        hostname = Dns.GetHostName(),
                        startedAt = DateTime.UtcNow.ToString("o")
                    }));
                    await form.PollStatusForSelfTestAsync();
                    externalLockStartedDisablesButtons = !form.SyncButtonsEnabledForSelfTest
                        && form.StatusTextForSelfTest == "Running Scheduled Sync";
                    File.Delete(lockFile);
                    await form.PollStatusForSelfTestAsync();
                    externalLockFinishedReturnsReady = form.SyncButtonsEnabledForSelfTest
                        && form.StatusTextForSelfTest == "Ready";
                }

                var delayedBackend = new DelayedStatusBackendClient(status);
                bool overlappingPollSkipped;
                using (var pollingForm = new MainForm(delayedBackend, MainForm.StatusRefreshIntervalMilliseconds))
                {
                    SynchronizationContext.SetSynchronizationContext(null);
                    Task<bool> firstPoll = pollingForm.PollStatusForSelfTestAsync();
                    await delayedBackend.Started;
                    overlappingPollSkipped = !await pollingForm.PollStatusForSelfTestAsync();
                    delayedBackend.AllowCompletion();
                    await firstPoll;
                }

                await VerifyClosingLifecycleAsync(CloneStatus(status));

                string[] knownKeyValues = new[]
                {
                    "AKIA" + new String('A', 16),
                    "ghp_" + new String('b', 24),
                    "sk-" + new String('c', 24),
                    "AIza" + new String('d', 32),
                    "eyJ" + new String('e', 10) + "." + new String('f', 10) + "." + new String('g', 10)
                };
                string[,] sensitiveFieldCases = new string[,]
                {
                    { "{\"password\":\"ExampleSecret123\"}", "ExampleSecret123" },
                    { "{\"token\":\"fake-token\"}", "fake-token" },
                    { "{\"Authorization\":\"Bearer fake-value\"}", "fake-value" },
                    { "{\"cookie\":\"fake-cookie\"}", "fake-cookie" },
                    { "{\"client_secret\":\"fake-secret\"}", "fake-secret" },
                    { "{ \"password\" : \"SpacedJsonSecret\" }", "SpacedJsonSecret" },
                    { "{'password':'SingleQuotedSecret'}", "SingleQuotedSecret" },
                    { "password=AssignmentSecret", "AssignmentSecret" },
                    { "password: ColonSecret", "ColonSecret" },
                    { "Authorization: Bearer HeaderSecret", "HeaderSecret" }
                };
                string sensitiveFieldStderr = String.Empty;
                for (int index = 0; index < sensitiveFieldCases.GetLength(0); index++)
                {
                    string fieldInput = sensitiveFieldCases[index, 0];
                    string fieldValue = sensitiveFieldCases[index, 1];
                    string fieldSanitized = BackendDiagnosticSanitizer.Sanitize(fieldInput);
                    AssertAbsent(fieldSanitized, fieldValue, "sensitive field value survived sanitization");
                    if (!fieldSanitized.Contains("[REDACTED]"))
                        throw new InvalidDataException("Sensitive field was not explicitly redacted.");
                    sensitiveFieldStderr += fieldInput + "\n";
                }

                string syntheticStderr = sensitiveFieldStderr +
                    "password=ExampleSecret123\n" +
                    "passwd=FakePasswdValue\n" +
                    "token=fake-token-value\n" +
                    "secret=FakeSecretValue\n" +
                    "Cookie: session=FakeCookieValue\n" +
                    "Authorization: Bearer fake-value\n" +
                    "credential=FakeCredentialValue\n" +
                    "api_key=FakeApiKeyValue\n" +
                    "[https://example.test/path?ticket=fake-secret](https://example.test/path?ticket=fake-secret)\n" +
                    String.Join("\n", knownKeyValues);
                string sanitized = BackendDiagnosticSanitizer.Sanitize(syntheticStderr + new String('x', 10000));
                string[] forbiddenSyntheticValues = new[]
                {
                    "ExampleSecret123", "FakePasswdValue", "fake-token-value", "FakeSecretValue",
                    "FakeCookieValue", "fake-value", "FakeCredentialValue", "FakeApiKeyValue", "ticket=fake-secret"
                };
                foreach (string forbidden in forbiddenSyntheticValues)
                    AssertAbsent(sanitized, forbidden, "sanitized diagnostic retained a synthetic secret or URL value");
                foreach (string forbidden in knownKeyValues)
                    AssertAbsent(sanitized, forbidden, "sanitized diagnostic retained a recognized key pattern");
                if (sanitized.Length > BackendDiagnosticSanitizer.MaximumCharacters)
                    throw new InvalidDataException("Sanitized diagnostics exceeded the strict size limit.");

                string failureLog = Path.Combine(status.logsDir, BackendFailureLog.FileName);
                if (File.Exists(failureLog)) File.Delete(failureLog);
                const string stdoutSentinel = "RAW_STDOUT_MUST_NOT_BE_WRITTEN";
                var failureBackend = new ScriptedBackendClient(CloneStatus(status), new BackendProcessResult
                {
                    ExitCode = 17,
                    StandardOutput = stdoutSentinel,
                    StandardError = syntheticStderr
                });
                using (var failureForm = new MainForm(failureBackend, MainForm.StatusRefreshIntervalMilliseconds))
                {
                    SynchronizationContext.SetSynchronizationContext(null);
                    await failureForm.InitializeForSelfTestAsync();
                    await failureForm.RunSyncForSelfTestAsync("quick");
                }
                string failureLogText = File.ReadAllText(failureLog);
                for (int index = 0; index < sensitiveFieldCases.GetLength(0); index++)
                    AssertAbsent(failureLogText, sensitiveFieldCases[index, 1], "sensitive field value survived in backend-failures.log");
                foreach (string forbidden in forbiddenSyntheticValues)
                    AssertAbsent(failureLogText, forbidden, "failure log retained a synthetic secret or URL value");
                foreach (string forbidden in knownKeyValues)
                    AssertAbsent(failureLogText, forbidden, "failure log retained a recognized key pattern");
                AssertAbsent(failureLogText, stdoutSentinel, "failure log wrote raw stdout");

                BackendStatus activeStatus = CloneStatus(status);
                activeStatus.status = "running";
                activeStatus.activeOperation = "Scheduled Sync";
                var activeBackend = new ScriptedBackendClient(activeStatus, new BackendProcessResult { ExitCode = 0 });
                using (var activeForm = new MainForm(activeBackend, MainForm.StatusRefreshIntervalMilliseconds))
                {
                    SynchronizationContext.SetSynchronizationContext(null);
                    await activeForm.InitializeForSelfTestAsync();
                    await activeForm.RunSyncForSelfTestAsync("quick");
                }
                bool preflightActiveOperationBlockedLaunch = activeBackend.SyncCalls == 0;
                var result = new
                {
                    schemaVersion = 1,
                    applicationRoot = backend.Paths.ApplicationRoot,
                    applicationRootContainsSpaces = backend.Paths.ApplicationRoot.IndexOf(' ') >= 0,
                    nodeExecutable = backend.Paths.NodeExecutable,
                    launcherScript = backend.Paths.LauncherScript,
                    workingDirectory = startInfo.WorkingDirectory,
                    processFileName = startInfo.FileName,
                    processArguments = startInfo.Arguments,
                    quickProcessFileName = quickStartInfo.FileName,
                    quickProcessArguments = quickStartInfo.Arguments,
                    fullProcessFileName = fullStartInfo.FileName,
                    fullProcessArguments = fullStartInfo.Arguments,
                    useShellExecute = startInfo.UseShellExecute,
                    createNoWindow = startInfo.CreateNoWindow,
                    redirectStandardOutput = startInfo.RedirectStandardOutput,
                    redirectStandardError = startInfo.RedirectStandardError,
                    statusSchemaVersion = status.schemaVersion,
                    statusDataDir = status.dataDir,
                    statusMirrorDir = status.mirrorDir,
                    statusLogsDir = status.logsDir,
                    statusRefreshIntervalMilliseconds = MainForm.StatusRefreshIntervalMilliseconds,
                    initialButtonsEnabled = initialButtonsEnabled,
                    externalLockStartedDisablesButtons = externalLockStartedDisablesButtons,
                    externalLockFinishedReturnsReady = externalLockFinishedReturnsReady,
                    overlappingPollSkipped = overlappingPollSkipped,
                    maximumConcurrentStatusPolls = delayedBackend.MaximumConcurrentCalls,
                    sanitizedDiagnosticMaximumCharacters = BackendDiagnosticSanitizer.MaximumCharacters,
                    syntheticSecretsRemoved = true,
                    failureLogCreated = File.Exists(failureLog),
                    failedGuiOperationLogged = failureBackend.SyncCalls == 1,
                    failureLogOmitsRawStdout = !failureLogText.Contains(stdoutSentinel),
                    preflightActiveOperationBlockedLaunch = preflightActiveOperationBlockedLaunch
                };
                File.WriteAllText(outputFile, new JavaScriptSerializer().Serialize(result));
                return 0;
            }
            catch (Exception error)
            {
                try
                {
                    var failure = new { schemaVersion = 1, error = error.GetType().Name };
                    File.WriteAllText(outputFile, new JavaScriptSerializer().Serialize(failure));
                }
                catch { }
                return 1;
            }
        }

        private static async Task VerifyClosingLifecycleAsync(BackendStatus status)
        {
            foreach (string mode in new[] { "quick", "full" })
            {
                foreach (bool failStatus in new[] { false, true })
                {
                    var delayed = new DelayedStatusBackendClient(status);
                    using (var form = new MainForm(delayed, MainForm.StatusRefreshIntervalMilliseconds))
                    {
                        SynchronizationContext.SetSynchronizationContext(null);
                        Task preflight = form.RunSyncForSelfTestAsync(mode);
                        await delayed.Started;
                        if (!form.OperationStartingForSelfTest || !form.BeginClosingForSelfTest())
                            throw new InvalidDataException("Closing during delayed preflight was not allowed.");
                        form.Dispose();
                        string closedUi = form.StatusUiSnapshotForSelfTest;
                        if (failStatus) delayed.FailCompletion();
                        else delayed.AllowCompletion();
                        await preflight;
                        if (delayed.SyncCalls != 0 || form.OperationStartingForSelfTest)
                            throw new InvalidDataException("Delayed preflight launched a sync or retained its starting flag after close.");
                        if (form.BackendStatusForSelfTest != null || form.StatusUiSnapshotForSelfTest != closedUi)
                            throw new InvalidDataException("Delayed preflight changed status or controls after close.");
                    }
                }
            }

            var delayedPoll = new DelayedStatusBackendClient(status);
            using (var form = new MainForm(delayedPoll, MainForm.StatusRefreshIntervalMilliseconds))
            {
                SynchronizationContext.SetSynchronizationContext(null);
                Task<bool> poll = form.PollStatusForSelfTestAsync();
                await delayedPoll.Started;
                if (!form.BeginClosingForSelfTest())
                    throw new InvalidDataException("Closing during a delayed status poll was not allowed.");
                form.Dispose();
                string closedUi = form.StatusUiSnapshotForSelfTest;
                delayedPoll.AllowCompletion();
                if (await poll || form.BackendStatusForSelfTest != null || form.StatusUiSnapshotForSelfTest != closedUi)
                    throw new InvalidDataException("Delayed status poll changed status or controls after close.");
            }
        }

        private static void AssertAbsent(string value, string forbidden, string message)
        {
            if ((value ?? String.Empty).IndexOf(forbidden, StringComparison.OrdinalIgnoreCase) >= 0)
                throw new InvalidDataException(message);
        }

        private static BackendStatus CloneStatus(BackendStatus value)
        {
            return new BackendStatus
            {
                schemaVersion = value.schemaVersion,
                appVersion = value.appVersion,
                status = "ready",
                configExists = value.configExists,
                configured = true,
                baseUrlConfigured = true,
                mirrorDir = value.mirrorDir,
                logsDir = value.logsDir,
                dataDir = value.dataDir,
                profileExists = value.profileExists,
                lastSync = value.lastSync,
                activeOperation = null
            };
        }
    }

    internal sealed class DelayedStatusBackendClient : IDesktopBackendClient
    {
        private readonly BackendStatus _status;
        private readonly TaskCompletionSource<bool> _started = new TaskCompletionSource<bool>();
        private readonly TaskCompletionSource<bool> _completion = new TaskCompletionSource<bool>();
        private int _concurrentCalls;
        private int _maximumConcurrentCalls;

        internal DelayedStatusBackendClient(BackendStatus status)
        {
            _status = status;
        }

        internal Task Started { get { return _started.Task; } }
        internal int MaximumConcurrentCalls { get { return _maximumConcurrentCalls; } }
        internal int SyncCalls { get; private set; }

        internal void AllowCompletion()
        {
            _completion.TrySetResult(true);
        }

        internal void FailCompletion()
        {
            _completion.TrySetException(new InvalidOperationException("Synthetic delayed status failure."));
        }

        public async Task<BackendStatus> GetStatusAsync()
        {
            int concurrent = Interlocked.Increment(ref _concurrentCalls);
            int observed;
            do
            {
                observed = _maximumConcurrentCalls;
                if (observed >= concurrent) break;
            } while (Interlocked.CompareExchange(ref _maximumConcurrentCalls, concurrent, observed) != observed);

            _started.TrySetResult(true);
            await _completion.Task;
            Interlocked.Decrement(ref _concurrentCalls);
            return _status;
        }

        public Task<BackendProcessResult> RunSyncAsync(string mode)
        {
            SyncCalls++;
            return Task.FromResult(new BackendProcessResult { ExitCode = 0 });
        }
    }

    internal sealed class ScriptedBackendClient : IDesktopBackendClient
    {
        private readonly BackendStatus _status;
        private readonly BackendProcessResult _result;

        internal ScriptedBackendClient(BackendStatus status, BackendProcessResult result)
        {
            _status = status;
            _result = result;
        }

        internal int SyncCalls { get; private set; }

        public Task<BackendStatus> GetStatusAsync()
        {
            return Task.FromResult(_status);
        }

        public Task<BackendProcessResult> RunSyncAsync(string mode)
        {
            SyncCalls++;
            return Task.FromResult(_result);
        }
    }
}
