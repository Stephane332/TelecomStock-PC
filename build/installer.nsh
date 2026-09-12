; Ouvre le port du serveur TelecomStock dans le pare-feu Windows.
; Placé ici car l'installateur dispose des droits nécessaires, contrairement
; à l'application lancée ensuite par le commerçant.

!macro customInstall
  DetailPrint "Configuration du pare-feu pour l'acces depuis les telephones..."
  nsExec::Exec 'netsh advfirewall firewall delete rule name="TelecomStock Pro"'
  nsExec::Exec 'netsh advfirewall firewall add rule name="TelecomStock Pro" dir=in action=allow protocol=TCP localport=3002 profile=private,domain'
!macroend

!macro customUnInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="TelecomStock Pro"'
!macroend
