; الجدار الناري: نسمح للحاسبات الثانية توصل لسيرفر البرنامج (المنفذ 8787) على الشبكة الخاصة
!macro customInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Invoices Server"'
  nsExec::Exec 'netsh advfirewall firewall add rule name="Invoices Server" dir=in action=allow protocol=TCP localport=8787 profile=private,domain'
!macroend

!macro customUnInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Invoices Server"'
!macroend
