; Custom NSIS installer script — Running Sheet Transcriber
; Detects and silently removes any older version before installing v1.1.0.
; This is a one-time migration script included only for v1.1.0.

!macro customInit
  ; Enumerate HKLM Uninstall keys and remove legacy Running Sheet Transcriber entries
  StrCpy $0 0
  ${Do}
    EnumRegKey $1 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall" $0
    ${If} $1 == ""
      ${ExitDo}
    ${EndIf}

    ReadRegStr $2 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$1" "DisplayName"
    ${If} $2 == "Running Sheet Transcriber"
      ReadRegStr $3 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$1" "DisplayVersion"
      ReadRegStr $4 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$1" "UninstallString"
      ; Only remove entries that are NOT the version we are about to install
      ${If} $3 != "1.1.0"
        ${If} $4 != ""
          ExecWait '$4 /S'
        ${EndIf}
        ; Restart enumeration from index 0 — registry shifts after an uninstall
        StrCpy $0 0
      ${Else}
        IntOp $0 $0 + 1
      ${EndIf}
    ${Else}
      IntOp $0 $0 + 1
    ${EndIf}
  ${Loop}

  ; Also check WOW6432Node (32-bit entries on 64-bit Windows)
  StrCpy $0 0
  ${Do}
    EnumRegKey $1 HKLM "SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall" $0
    ${If} $1 == ""
      ${ExitDo}
    ${EndIf}

    ReadRegStr $2 HKLM "SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\$1" "DisplayName"
    ${If} $2 == "Running Sheet Transcriber"
      ReadRegStr $3 HKLM "SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\$1" "DisplayVersion"
      ReadRegStr $4 HKLM "SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\$1" "UninstallString"
      ${If} $3 != "1.1.0"
        ${If} $4 != ""
          ExecWait '$4 /S'
        ${EndIf}
        StrCpy $0 0
      ${Else}
        IntOp $0 $0 + 1
      ${EndIf}
    ${Else}
      IntOp $0 $0 + 1
    ${EndIf}
  ${Loop}
!macroend
