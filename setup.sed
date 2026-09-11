[Version]
Class=IEXPRESS
SEDVersion=3
[Options]
InstallPrompt=%InstallPrompt%
ShowInstallProgramWindow=0
ExtractAnimated=1
UseLongFileName=1
RebootMode=I
InstallPrompt=Voulez-vous installer TelecomStock Pro ?
DisplayLicense=%DisplayLicense%
FinishMessage=TelecomStock Pro a été installé avec succès !
FriendlyName=TelecomStock Pro v1.0
TargetName=.\TelecomStock-Pro-Setup.exe
AppLaunched=AppLaunched
PostInstallCmd=<None>
AdminQuietInstCmd=UserQuietInstCmd=
UserQuietInstCmd=
SourceFiles=SourceFiles
[Strings]
InstallPrompt=
DisplayLicense=
AppLaunched=Installer.bat
[SourceFiles]
SourceFiles0=C:\Users\winds\telecom-stock\
[SourceFiles0]
%FILE0%=server.js
%FILE1%=package.json
%FILE2%=package-lock.json
%FILE3%=README.md
%FILE4%=Installer.bat
%FILE5%=Lancer-TelecomStock.bat
%FILE6%=public\index.html
%FILE7%=db\setup.js