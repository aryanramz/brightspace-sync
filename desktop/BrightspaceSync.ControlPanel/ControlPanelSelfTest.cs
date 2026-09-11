using BrightspaceSync.Security;
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
            string stage = "initialize";
            try
            {
                stage = "resolve backend";
                var backend = new BackendClient();
                ProcessStartInfo startInfo = backend.CreateStartInfo("status", "--json");
                ProcessStartInfo quickStartInfo = backend.CreateStartInfo("quick");
                ProcessStartInfo fullStartInfo = backend.CreateStartInfo("full");
                ProcessStartInfo refreshLoginStartInfo = backend.CreateStartInfo("refresh-login");
                ProcessStartInfo settingsSaveStartInfo = backend.CreateSettingsSaveStartInfo();
                stage = "load initial settings";
                DesktopSettings initialSettings = await backend.GetSettingsAsync();
                if (initialSettings.configured)
                    throw new InvalidDataException("Packaged settings self-test requires an initially unconfigured data directory.");
                var settingsRequest = new SettingsSaveRequest
                {
                    schemaVersion = 1,
                    baseUrl = "https://example.test",
                    mirrorDir = initialSettings.mirrorDir,
                    drive = new DesktopDriveSettings { enabled = false, destination = String.Empty },
                    authentication = new DesktopAuthenticationSettings { automaticLoginEnabled = false }
                };
                if (settingsSaveStartInfo.Arguments.Contains(settingsRequest.baseUrl) || settingsSaveStartInfo.Arguments.Contains(settingsRequest.mirrorDir))
                    throw new InvalidDataException("Settings payload appeared in backend process arguments.");
                stage = "save settings through private backend";
                SettingsSaveResponse savedSettingsResponse = await backend.SaveSettingsAsync(settingsRequest);
                if (!savedSettingsResponse.ok || !savedSettingsResponse.settings.configured)
                    throw new InvalidDataException("Packaged settings could not be saved through the private Node backend.");
                stage = "reload settings and status";
                DesktopSettings currentSettings = await backend.GetSettingsAsync();
                BackendStatus status = await backend.GetStatusAsync();

                stage = "first-run and cancel behavior";
                BackendStatus firstRunStatus = CloneStatus(status);
                firstRunStatus.configured = false;
                firstRunStatus.baseUrlConfigured = false;
                var firstRunBackend = new ScriptedBackendClient(firstRunStatus, new BackendProcessResult { ExitCode = 0 });
                var firstRunDialog = new ScriptedSettingsDialogService(false);
                bool firstRunSetupTriggered;
                bool firstRunCancelDisabledSync;
                using (var firstRunForm = new MainForm(firstRunBackend, MainForm.StatusRefreshIntervalMilliseconds, firstRunDialog))
                {
                    SynchronizationContext.SetSynchronizationContext(null);
                    await firstRunForm.InitializeForSelfTestAsync();
                    firstRunSetupTriggered = firstRunForm.FirstRunSetupOfferedForSelfTest
                        && firstRunDialog.ShowCalls == 1
                        && firstRunDialog.LastFirstRun;
                    firstRunCancelDisabledSync = !firstRunForm.SyncButtonsEnabledForSelfTest;
                }

                var cancelBackend = new ScriptedBackendClient(status, new BackendProcessResult { ExitCode = 0 });
                using (var settingsForm = new SetupSettingsForm(cancelBackend, currentSettings, false, new NullFolderPicker()))
                {
                    settingsForm.CancelForSelfTest();
                }
                bool settingsCancelSavesNothing = cancelBackend.SaveCalls == 0;
                var formSaveBackend = new ScriptedBackendClient(status, new BackendProcessResult { ExitCode = 0 });
                bool sharedSettingsFormSavesThroughBackend;
                using (var settingsForm = new SetupSettingsForm(formSaveBackend, currentSettings, false, new NullFolderPicker()))
                    sharedSettingsFormSavesThroughBackend = await settingsForm.SaveForSelfTestAsync(null) && formSaveBackend.SaveCalls == 1;
                bool environmentOverrideIsReadOnly;
                using (var settingsForm = new SetupSettingsForm(cancelBackend, currentSettings, false, new NullFolderPicker()))
                    environmentOverrideIsReadOnly = currentSettings.mirrorOverrideActive && !settingsForm.MirrorEditableForSelfTest;

                DesktopSettings freshFormSettings = new DesktopSettings
                {
                    schemaVersion = 1,
                    configured = false,
                    baseUrl = String.Empty,
                    mirrorDir = initialSettings.mirrorDir,
                    mirrorOverrideActive = false,
                    maySuggestFirstRunMirror = true,
                    drive = new DesktopDriveSettings { enabled = false, destination = String.Empty }
                };
                string firstRunMirror;
                using (var settingsForm = new SetupSettingsForm(cancelBackend, freshFormSettings, true, new NullFolderPicker()))
                    firstRunMirror = settingsForm.RequestForSelfTest().mirrorDir;
                bool firstRunUsesKnownDocuments = String.Equals(firstRunMirror, SetupSettingsForm.SuggestedFirstRunMirror(), StringComparison.OrdinalIgnoreCase);

                DesktopSettings customMissingUrlSettings = new DesktopSettings
                {
                    schemaVersion = 1,
                    configured = false,
                    baseUrl = String.Empty,
                    mirrorDir = Path.Combine(status.mirrorDir, "Existing Custom Mirror"),
                    mirrorOverrideActive = false,
                    maySuggestFirstRunMirror = false,
                    drive = new DesktopDriveSettings { enabled = false, destination = String.Empty }
                };
                string customFirstRunMirror;
                using (var settingsForm = new SetupSettingsForm(cancelBackend, customMissingUrlSettings, true, new NullFolderPicker()))
                    customFirstRunMirror = settingsForm.RequestForSelfTest().mirrorDir;
                bool firstRunPreservesCustomMirror = String.Equals(customFirstRunMirror, customMissingUrlSettings.mirrorDir, StringComparison.OrdinalIgnoreCase);

                DesktopSettings meaningfulDefaultSettings = new DesktopSettings
                {
                    schemaVersion = 1,
                    configured = false,
                    baseUrl = String.Empty,
                    mirrorDir = initialSettings.mirrorDir,
                    mirrorOverrideActive = false,
                    maySuggestFirstRunMirror = false,
                    drive = new DesktopDriveSettings { enabled = false, destination = String.Empty }
                };
                string meaningfulFirstRunMirror;
                using (var settingsForm = new SetupSettingsForm(cancelBackend, meaningfulDefaultSettings, true, new NullFolderPicker()))
                    meaningfulFirstRunMirror = settingsForm.RequestForSelfTest().mirrorDir;
                bool firstRunPreservesMeaningfulDefault = String.Equals(meaningfulFirstRunMirror, meaningfulDefaultSettings.mirrorDir, StringComparison.OrdinalIgnoreCase);

                DesktopSettings overrideFirstRunSettings = new DesktopSettings
                {
                    schemaVersion = 1,
                    configured = false,
                    baseUrl = String.Empty,
                    mirrorDir = currentSettings.mirrorDir,
                    mirrorOverrideActive = true,
                    maySuggestFirstRunMirror = false,
                    drive = new DesktopDriveSettings { enabled = false, destination = String.Empty }
                };
                bool firstRunPreservesEnvironmentOverride;
                using (var settingsForm = new SetupSettingsForm(cancelBackend, overrideFirstRunSettings, true, new NullFolderPicker()))
                {
                    firstRunPreservesEnvironmentOverride =
                        String.Equals(settingsForm.RequestForSelfTest().mirrorDir, overrideFirstRunSettings.mirrorDir, StringComparison.OrdinalIgnoreCase)
                        && !settingsForm.MirrorEditableForSelfTest;
                }

                stage = "credential settings behavior";
                const string syntheticUsername = "SyntheticStudent";
                const string syntheticPassword = "SyntheticPasswordValue123";
                const string replacementPassword = "ReplacementPasswordValue456";
                DesktopSettings stonyBrookSettings = new DesktopSettings
                {
                    schemaVersion = 1,
                    configured = true,
                    baseUrl = "https://mycourses.stonybrook.edu",
                    mirrorDir = currentSettings.mirrorDir,
                    mirrorOverrideActive = false,
                    maySuggestFirstRunMirror = false,
                    drive = new DesktopDriveSettings { enabled = false, destination = String.Empty },
                    authentication = new DesktopAuthenticationSettings
                    {
                        supported = true,
                        institution = "stony-brook",
                        automaticLoginEnabled = true
                    }
                };
                var keepStore = new FakeCredentialStore(syntheticUsername, syntheticPassword);
                var keepBackend = new ScriptedBackendClient(status, new BackendProcessResult { ExitCode = 0 });
                bool existingPasswordNotRedisplayed;
                bool blankPasswordKeepsCredential;
                bool credentialPayloadExcludedFromBackend;
                using (var settingsForm = new SetupSettingsForm(keepBackend, stonyBrookSettings, false, new NullFolderPicker(), keepStore))
                {
                    existingPasswordNotRedisplayed = settingsForm.AuthenticationVisibleForSelfTest
                        && settingsForm.CredentialExistsForSelfTest
                        && settingsForm.PasswordForSelfTest.Length == 0;
                    blankPasswordKeepsCredential = await settingsForm.SaveForSelfTestAsync(null)
                        && keepStore.WriteCalls == 0
                        && keepStore.DeleteCalls == 0;
                    string backendPayload = new JavaScriptSerializer().Serialize(keepBackend.LastSettingsRequest);
                    credentialPayloadExcludedFromBackend = backendPayload.IndexOf(syntheticUsername, StringComparison.OrdinalIgnoreCase) < 0
                        && backendPayload.IndexOf(syntheticPassword, StringComparison.OrdinalIgnoreCase) < 0
                        && backendPayload.IndexOf("username", StringComparison.OrdinalIgnoreCase) < 0
                        && backendPayload.IndexOf("password", StringComparison.OrdinalIgnoreCase) < 0;
                }

                var replaceStore = new FakeCredentialStore(syntheticUsername, syntheticPassword);
                var replaceBackend = new ScriptedBackendClient(status, new BackendProcessResult { ExitCode = 0 });
                bool credentialReplacementWorks;
                bool passwordClearedAfterSave;
                using (var settingsForm = new SetupSettingsForm(replaceBackend, stonyBrookSettings, false, new NullFolderPicker(), replaceStore))
                {
                    settingsForm.SetAuthenticationForSelfTest(true, syntheticUsername, replacementPassword);
                    credentialReplacementWorks = await settingsForm.SaveForSelfTestAsync(null)
                        && replaceStore.WriteCalls == 1
                        && replaceStore.CurrentPassword == replacementPassword;
                    passwordClearedAfterSave = settingsForm.PasswordForSelfTest.Length == 0;
                }

                var rejectedResponse = new SettingsSaveResponse
                {
                    schemaVersion = 1,
                    ok = false,
                    errors = new[] { new SettingsValidationError { field = "baseUrl", code = "invalid-url", message = "Enter a valid HTTPS Brightspace URL." } }
                };
                var rollbackStore = new FakeCredentialStore(syntheticUsername, syntheticPassword);
                var rejectedBackend = new ScriptedBackendClient(status, new BackendProcessResult { ExitCode = 0 }, rejectedResponse);
                bool rejectedSettingsRestoreCredential;
                using (var settingsForm = new SetupSettingsForm(rejectedBackend, stonyBrookSettings, false, new NullFolderPicker(), rollbackStore))
                {
                    settingsForm.SetAuthenticationForSelfTest(true, syntheticUsername, replacementPassword);
                    rejectedSettingsRestoreCredential = !await settingsForm.SaveForSelfTestAsync(null)
                        && rollbackStore.WriteCalls == 2
                        && rollbackStore.CurrentPassword == syntheticPassword;
                }

                var deleteStore = new FakeCredentialStore(syntheticUsername, syntheticPassword);
                var deleteBackend = new ScriptedBackendClient(status, new BackendProcessResult { ExitCode = 0 });
                bool credentialDeletionWorks;
                using (var settingsForm = new SetupSettingsForm(deleteBackend, stonyBrookSettings, false, new NullFolderPicker(), deleteStore))
                {
                    settingsForm.RemoveCredentialForSelfTest();
                    credentialDeletionWorks = await settingsForm.SaveForSelfTestAsync(null)
                        && deleteStore.DeleteCalls == 1
                        && !deleteStore.Exists
                        && !deleteBackend.LastSettingsRequest.authentication.automaticLoginEnabled;
                }

                var failingStore = new FakeCredentialStore(syntheticUsername, syntheticPassword) { FailWrites = true };
                var failingCredentialBackend = new ScriptedBackendClient(status, new BackendProcessResult { ExitCode = 0 });
                bool credentialFailureIsSafe;
                using (var settingsForm = new SetupSettingsForm(failingCredentialBackend, stonyBrookSettings, false, new NullFolderPicker(), failingStore))
                {
                    settingsForm.SetAuthenticationForSelfTest(true, syntheticUsername, replacementPassword);
                    bool saved = await settingsForm.SaveForSelfTestAsync(null);
                    string failureText = settingsForm.ValidationTextForSelfTest;
                    credentialFailureIsSafe = !saved
                        && failingCredentialBackend.SaveCalls == 0
                        && failureText.IndexOf(replacementPassword, StringComparison.OrdinalIgnoreCase) < 0
                        && settingsForm.PasswordForSelfTest.Length == 0;
                }

                DesktopSettings genericSettings = new DesktopSettings
                {
                    schemaVersion = 1,
                    configured = true,
                    baseUrl = "https://example.test",
                    mirrorDir = currentSettings.mirrorDir,
                    drive = new DesktopDriveSettings { enabled = false, destination = String.Empty },
                    authentication = new DesktopAuthenticationSettings { supported = false, institution = String.Empty, automaticLoginEnabled = false }
                };
                bool genericCredentialFieldsHidden;
                using (var settingsForm = new SetupSettingsForm(cancelBackend, genericSettings, false, new NullFolderPicker(), new FakeCredentialStore()))
                    genericCredentialFieldsHidden = !settingsForm.AuthenticationVisibleForSelfTest;

                string recoveryOld = Path.Combine(status.mirrorDir, "Recovery Old");
                string recoveryNew = Path.Combine(status.mirrorDir, "Recovery New");
                string recoveryJson = new JavaScriptSerializer().Serialize(new
                {
                    schemaVersion = 1,
                    ok = false,
                    errors = new[] { new { field = "mirrorDir", code = "mirror-rollback-failed", message = "Automatic rollback did not complete." } },
                    recovery = new
                    {
                        required = true,
                        oldMirrorDir = recoveryOld,
                        newMirrorDir = recoveryNew,
                        configRetainedOldLocation = true
                    }
                });
                SettingsSaveResponse recoveryResponse = backend.ParseSettingsSaveResponseForSelfTest(recoveryJson);
                bool recoverySurvivesBackendBridge = recoveryResponse.recovery != null
                    && recoveryResponse.recovery.required
                    && recoveryResponse.recovery.configRetainedOldLocation
                    && recoveryResponse.recovery.oldMirrorDir == recoveryOld
                    && recoveryResponse.recovery.newMirrorDir == recoveryNew;
                var recoveryBackend = new ScriptedBackendClient(status, new BackendProcessResult { ExitCode = 0 }, recoveryResponse);
                bool recoveryPresentedToUi;
                using (var settingsForm = new SetupSettingsForm(recoveryBackend, currentSettings, false, new NullFolderPicker()))
                {
                    bool recoverySaveResult = await settingsForm.SaveForSelfTestAsync(null);
                    string recoveryText = settingsForm.ValidationTextForSelfTest;
                    recoveryPresentedToUi = !recoverySaveResult
                        && recoveryText.IndexOf("Manual recovery may be required", StringComparison.OrdinalIgnoreCase) >= 0
                        && recoveryText.Contains(recoveryOld)
                        && recoveryText.Contains(recoveryNew)
                        && recoveryText.IndexOf("still point", StringComparison.OrdinalIgnoreCase) >= 0;
                }

                stage = "status polling behavior";
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

                stage = "closing lifecycle";
                await VerifyClosingLifecycleAsync(CloneStatus(status));

                stage = "diagnostic sanitization";
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

                stage = "sync preflight";
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
                var refreshBackend = new ScriptedBackendClient(CloneStatus(status), new BackendProcessResult { ExitCode = 0 });
                using (var refreshForm = new MainForm(refreshBackend, MainForm.StatusRefreshIntervalMilliseconds))
                {
                    SynchronizationContext.SetSynchronizationContext(null);
                    await refreshForm.InitializeForSelfTestAsync();
                    await refreshForm.RunRefreshLoginForSelfTestAsync();
                }
                bool refreshLoginWired = refreshBackend.RefreshLoginCalls == 1;
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
                    refreshLoginProcessFileName = refreshLoginStartInfo.FileName,
                    refreshLoginProcessArguments = refreshLoginStartInfo.Arguments,
                    settingsSaveProcessFileName = settingsSaveStartInfo.FileName,
                    settingsSaveProcessArguments = settingsSaveStartInfo.Arguments,
                    settingsSaveRedirectStandardInput = settingsSaveStartInfo.RedirectStandardInput,
                    useShellExecute = startInfo.UseShellExecute,
                    createNoWindow = startInfo.CreateNoWindow,
                    redirectStandardOutput = startInfo.RedirectStandardOutput,
                    redirectStandardError = startInfo.RedirectStandardError,
                    statusSchemaVersion = status.schemaVersion,
                    statusDataDir = status.dataDir,
                    statusMirrorDir = status.mirrorDir,
                    statusLogsDir = status.logsDir,
                    settingsSchemaVersion = currentSettings.schemaVersion,
                    settingsConfigured = currentSettings.configured,
                    settingsBaseUrl = currentSettings.baseUrl,
                    settingsMirrorDir = currentSettings.mirrorDir,
                    settingsDriveEnabled = currentSettings.drive.enabled,
                    settingsDriveDestination = currentSettings.drive.destination,
                    settingsAuthenticationSupported = currentSettings.authentication.supported,
                    settingsAutomaticLoginEnabled = currentSettings.authentication.automaticLoginEnabled,
                    settingsMirrorOverrideActive = currentSettings.mirrorOverrideActive,
                    settingsPayloadAbsentFromArguments = !settingsSaveStartInfo.Arguments.Contains(settingsRequest.baseUrl)
                        && !settingsSaveStartInfo.Arguments.Contains(settingsRequest.mirrorDir),
                    firstRunSetupTriggered = firstRunSetupTriggered,
                    firstRunCancelDisabledSync = firstRunCancelDisabledSync,
                    firstRunUsesKnownDocuments = firstRunUsesKnownDocuments,
                    firstRunPreservesCustomMirror = firstRunPreservesCustomMirror,
                    firstRunPreservesMeaningfulDefault = firstRunPreservesMeaningfulDefault,
                    firstRunPreservesEnvironmentOverride = firstRunPreservesEnvironmentOverride,
                    settingsCancelSavesNothing = settingsCancelSavesNothing,
                    sharedSettingsFormSavesThroughBackend = sharedSettingsFormSavesThroughBackend,
                    environmentOverrideIsReadOnly = environmentOverrideIsReadOnly,
                    recoverySurvivesBackendBridge = recoverySurvivesBackendBridge,
                    recoveryPresentedToUi = recoveryPresentedToUi,
                    existingPasswordNotRedisplayed = existingPasswordNotRedisplayed,
                    blankPasswordKeepsCredential = blankPasswordKeepsCredential,
                    credentialPayloadExcludedFromBackend = credentialPayloadExcludedFromBackend,
                    credentialReplacementWorks = credentialReplacementWorks,
                    rejectedSettingsRestoreCredential = rejectedSettingsRestoreCredential,
                    credentialDeletionWorks = credentialDeletionWorks,
                    credentialFailureIsSafe = credentialFailureIsSafe,
                    passwordClearedAfterSave = passwordClearedAfterSave,
                    genericCredentialFieldsHidden = genericCredentialFieldsHidden,
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
                    preflightActiveOperationBlockedLaunch = preflightActiveOperationBlockedLaunch,
                    refreshLoginWired = refreshLoginWired
                };
                File.WriteAllText(outputFile, new JavaScriptSerializer().Serialize(result));
                return 0;
            }
            catch (Exception error)
            {
                try
                {
                    var failure = new { schemaVersion = 1, error = error.GetType().Name, stage = stage };
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
        internal int RefreshLoginCalls { get; private set; }

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

        public Task<BackendProcessResult> RunRefreshLoginAsync()
        {
            RefreshLoginCalls++;
            return Task.FromResult(new BackendProcessResult { ExitCode = 0 });
        }

        public Task<DesktopSettings> GetSettingsAsync()
        {
            return Task.FromResult(SettingsFromStatus(_status));
        }

        public Task<SettingsSaveResponse> SaveSettingsAsync(SettingsSaveRequest request)
        {
            throw new InvalidOperationException("Delayed status test does not save settings.");
        }

        private static DesktopSettings SettingsFromStatus(BackendStatus status)
        {
            return new DesktopSettings
            {
                schemaVersion = 1,
                configured = status.configured,
                baseUrl = status.configured ? "https://example.test" : String.Empty,
                mirrorDir = status.mirrorDir,
                mirrorOverrideActive = false,
                drive = new DesktopDriveSettings { enabled = false, destination = String.Empty },
                authentication = new DesktopAuthenticationSettings { supported = false, institution = String.Empty, automaticLoginEnabled = false }
            };
        }
    }

    internal sealed class ScriptedBackendClient : IDesktopBackendClient
    {
        private readonly BackendStatus _status;
        private readonly BackendProcessResult _result;
        private readonly SettingsSaveResponse _settingsSaveResponse;

        internal ScriptedBackendClient(BackendStatus status, BackendProcessResult result)
            : this(status, result, null)
        {
        }

        internal ScriptedBackendClient(BackendStatus status, BackendProcessResult result, SettingsSaveResponse settingsSaveResponse)
        {
            _status = status;
            _result = result;
            _settingsSaveResponse = settingsSaveResponse;
        }

        internal int SyncCalls { get; private set; }
        internal int RefreshLoginCalls { get; private set; }
        internal int SaveCalls { get; private set; }
        internal SettingsSaveRequest LastSettingsRequest { get; private set; }

        public Task<BackendStatus> GetStatusAsync()
        {
            return Task.FromResult(_status);
        }

        public Task<BackendProcessResult> RunSyncAsync(string mode)
        {
            SyncCalls++;
            return Task.FromResult(_result);
        }

        public Task<BackendProcessResult> RunRefreshLoginAsync()
        {
            RefreshLoginCalls++;
            return Task.FromResult(_result);
        }

        public Task<DesktopSettings> GetSettingsAsync()
        {
            return Task.FromResult(new DesktopSettings
            {
                schemaVersion = 1,
                configured = _status.configured,
                baseUrl = _status.configured ? "https://example.test" : String.Empty,
                mirrorDir = _status.mirrorDir,
                mirrorOverrideActive = false,
                drive = new DesktopDriveSettings { enabled = false, destination = String.Empty },
                authentication = new DesktopAuthenticationSettings { supported = false, institution = String.Empty, automaticLoginEnabled = false }
            });
        }

        public Task<SettingsSaveResponse> SaveSettingsAsync(SettingsSaveRequest request)
        {
            SaveCalls++;
            LastSettingsRequest = request;
            if (_settingsSaveResponse != null)
                return Task.FromResult(_settingsSaveResponse);
            return Task.FromResult(new SettingsSaveResponse
            {
                schemaVersion = 1,
                ok = true,
                settings = new DesktopSettings
                {
                    schemaVersion = 1,
                    configured = true,
                    baseUrl = request.baseUrl,
                    mirrorDir = request.mirrorDir,
                    mirrorOverrideActive = false,
                    drive = request.drive,
                    authentication = request.authentication
                }
            });
        }
    }

    internal sealed class FakeCredentialStore : ICredentialStore
    {
        private string _username;
        private string _password;

        internal FakeCredentialStore(string username = "", string password = "")
        {
            _username = username ?? String.Empty;
            _password = password ?? String.Empty;
        }

        internal bool FailReads { get; set; }
        internal bool FailWrites { get; set; }
        internal bool FailDeletes { get; set; }
        internal int ReadCalls { get; private set; }
        internal int WriteCalls { get; private set; }
        internal int DeleteCalls { get; private set; }
        internal bool Exists { get { return !String.IsNullOrWhiteSpace(_username) && !String.IsNullOrEmpty(_password); } }
        internal string CurrentPassword { get { return _password; } }

        public CredentialRecord Read(string target)
        {
            ValidateTarget(target);
            ReadCalls++;
            if (FailReads) throw new CredentialStoreException("Windows could not read the saved Brightspace credential.");
            return Exists ? new CredentialRecord(_username, _password.ToCharArray()) : null;
        }

        public string ReadUsername(string target)
        {
            ValidateTarget(target);
            ReadCalls++;
            if (FailReads) throw new CredentialStoreException("Windows could not inspect the saved Brightspace credential.");
            return Exists ? _username : null;
        }

        public void Write(string target, string username, string password)
        {
            ValidateTarget(target);
            WriteCalls++;
            if (FailWrites) throw new CredentialStoreException("Windows could not save the Brightspace credential.");
            _username = username ?? String.Empty;
            _password = password ?? String.Empty;
        }

        public void Delete(string target)
        {
            ValidateTarget(target);
            DeleteCalls++;
            if (FailDeletes) throw new CredentialStoreException("Windows could not remove the saved Brightspace credential.");
            _username = String.Empty;
            _password = String.Empty;
        }

        private static void ValidateTarget(string target)
        {
            if (!String.Equals(target, WindowsCredentialStore.StonyBrookTarget, StringComparison.Ordinal))
                throw new CredentialStoreException("The requested credential target is not supported.");
        }
    }

    internal sealed class ScriptedSettingsDialogService : ISettingsDialogService
    {
        private readonly bool _result;

        internal ScriptedSettingsDialogService(bool result)
        {
            _result = result;
        }

        internal int ShowCalls { get; private set; }
        internal bool LastFirstRun { get; private set; }

        public Task<bool> ShowAsync(IWin32Window owner, IDesktopBackendClient backend, bool firstRun)
        {
            ShowCalls++;
            LastFirstRun = firstRun;
            return Task.FromResult(_result);
        }
    }

    internal sealed class NullFolderPicker : IFolderPicker
    {
        public string SelectFolder(IWin32Window owner, string description, string initialPath)
        {
            return null;
        }
    }
}
