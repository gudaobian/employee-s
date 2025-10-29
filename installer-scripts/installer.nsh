; NSIS Installer Script for Employee Safety Client
; Handles cleanup before installation

!macro customInit
  DetailPrint "Employee Safety Client - 安装前清理"
  DetailPrint "======================================"

  ; Method 1: Simple process termination (always works)
  DetailPrint "停止运行中的进程..."

  ; Kill EmployeeSafety.exe process
  nsExec::ExecToLog 'taskkill /F /IM EmployeeSafety.exe /T'
  Pop $0

  ; Kill any electron.exe processes
  nsExec::ExecToLog 'taskkill /F /IM electron.exe /T'
  Pop $0

  ; Wait for processes to terminate
  Sleep 2000

  ; Method 2: Run PowerShell cleanup script (if available)
  ; Check if PowerShell script exists in installer directory
  IfFileExists "$EXEDIR\cleanup.ps1" 0 +8
    DetailPrint "运行清理脚本..."
    nsExec::ExecToLog 'powershell.exe -ExecutionPolicy Bypass -NoProfile -File "$EXEDIR\cleanup.ps1"'
    Pop $0
    IntCmp $0 0 +3 0 +3
      DetailPrint "清理脚本执行成功"
      Goto cleanupDone
    DetailPrint "清理脚本未找到，使用基本清理"

  cleanupDone:

  ; Clean old log files manually
  DetailPrint "清理日志文件..."
  RMDir /r "$APPDATA\employee-safety-client\logs"
  RMDir /r "$LOCALAPPDATA\employee-safety-client\logs"

  ; Clean temp files
  Delete "$TEMP\employee-safety-*"

  DetailPrint "清理完成"
  DetailPrint "======================================"
!macroend

!macro customInstall
  ; Delete old log files
  DetailPrint "Cleaning up old log files..."

  ; Get AppData path
  SetShellVarContext current
  StrCpy $0 "$APPDATA\employee-safety-client\logs"

  ; Check if logs directory exists
  IfFileExists "$0\*.*" 0 +3
    DetailPrint "Deleting logs from: $0"
    RMDir /r "$0"

  ; Also clean temp files
  StrCpy $1 "$TEMP\employee-safety-*"
  DetailPrint "Cleaning temp files: $1"
  Delete "$1"

  DetailPrint "Cleanup completed."
!macroend

!macro customUnInit
  ; Stop processes before uninstall
  DetailPrint "Stopping Employee Safety..."

  nsExec::ExecToLog 'taskkill /F /IM EmployeeSafety.exe /T'
  Pop $0

  nsExec::ExecToLog 'taskkill /F /IM electron.exe /T'
  Pop $0

  Sleep 2000
!macroend

!macro customUnInstall
  ; Clean up user data on uninstall
  SetShellVarContext current

  DetailPrint "Removing application data..."
  RMDir /r "$APPDATA\employee-safety-client"

  DetailPrint "Removing local data..."
  RMDir /r "$LOCALAPPDATA\employee-safety-client"

  DetailPrint "Uninstall cleanup completed."
!macroend
