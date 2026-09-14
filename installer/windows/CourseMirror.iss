#include "includes\Product.iss"

#ifndef AppVersion
  #error AppVersion must be supplied by scripts\build-windows-installer.ps1
#endif
#ifndef SourceBundle
  #error SourceBundle must be supplied by scripts\build-windows-installer.ps1
#endif
#ifndef InstallerOutputDir
  #error InstallerOutputDir must be supplied by scripts\build-windows-installer.ps1
#endif
#ifndef ProjectLicenseFile
  #error ProjectLicenseFile must be supplied by scripts\build-windows-installer.ps1
#endif

[Setup]
AppId={#ProductAppId}
AppName={#ProductName}
AppVersion={#AppVersion}
AppVerName={#ProductName} {#AppVersion}
AppPublisher={#ProductPublisher}
AppPublisherURL={#ProductRepositoryUrl}
AppSupportURL={#ProductSupportUrl}
AppUpdatesURL={#ProductUpdatesUrl}
VersionInfoCompany={#ProductPublisher}
VersionInfoDescription={#ProductName} Setup
VersionInfoProductName={#ProductName}
VersionInfoProductVersion={#AppVersion}
VersionInfoVersion={#AppVersion}
DefaultDirName={localappdata}\Programs\{#ProductName}
DisableDirPage=yes
DisableProgramGroupPage=yes
UsePreviousAppDir=no
UsePreviousGroup=no
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=none
SetupArchitecture=x64
ArchitecturesAllowed=x64compatible and not arm64
MinVersion=10.0.19045
LicenseFile={#ProjectLicenseFile}
OutputDir={#InstallerOutputDir}
OutputBaseFilename={#ProductName}-{#AppVersion}-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
DisableWelcomePage=no
DisableReadyPage=yes
CloseApplications=no
RestartApplications=no
UninstallDisplayIcon={app}\{#ProductExecutable}
UninstallDisplayName={#ProductName}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Messages]
WindowsVersionNotSupported={#ProductName} requires Windows 10 version 22H2 (build 19045) or later on an x64 PC. 32-bit Windows and Windows on ARM are not supported.

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: unchecked

[Files]
Source: "{#SourceBundle}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{userprograms}\{#ProductName}"; Filename: "{app}\{#ProductExecutable}"; WorkingDir: "{app}"
Name: "{userdesktop}\{#ProductName}"; Filename: "{app}\{#ProductExecutable}"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#ProductExecutable}"; Description: "Launch {#ProductName}"; WorkingDir: "{app}"; Flags: nowait postinstall skipifsilent

[Code]
function InitializeSetup(): Boolean;
var
  ErrorCode: Integer;
begin
  Result := IsDotNetInstalled(net48, 0);
  if not Result then
  begin
    if MsgBox(
      '{#ProductName} requires Microsoft .NET Framework 4.8 or newer.' + #13#10 + #13#10 +
      'Open Microsoft''s official .NET Framework 4.8 download page now?',
      mbCriticalError, MB_YESNO) = IDYES then
    begin
      ShellExec('open', '{#DotNet48DownloadUrl}', '', '', SW_SHOWNORMAL, ewNoWait, ErrorCode);
    end;
  end;
end;
