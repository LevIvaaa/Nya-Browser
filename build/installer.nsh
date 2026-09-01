; ---------------------------------------------------------------------------
; Nya Browser installer and uninstaller UI.
;
; The windows are the design canvas artboards, not a re-drawing of them:
; build/render-installer-art.cjs renders design/*.dc.html in Chromium and this
; script shows the result full-window. Everything static — the aurora, the
; logo, the headings, the rounded buttons — is in that bitmap, which is why the
; installer looks exactly like the design rather than like NSIS.
;
; Over the bitmap sit only the things that have to be live:
;   * invisible SS_NOTIFY statics where the drawn buttons are,
;   * the install path, which depends on the machine,
;   * the checkbox squares, which have two states,
;   * MUI's progress bar, moved onto the bar drawn in the design.
; Their rectangles come from build/art-layout.nsh, measured in the rendered
; page, so the live parts land exactly where the design put them.
;
; electron-builder's machinery is untouched: elevation, uninstalling the old
; version, shortcuts, and the update path electron-updater drives.
;
; Four ways it runs:
;   fresh install   welcome → progress → done
;   update          progress only, and the new version starts itself
;   uninstall       confirm → progress → done
;   silent          no window at all: no page callback here ever runs
;
; The uninstaller compiles from this same source with BUILD_UNINSTALLER set and
; gets its own namespace, hence two of everything, sharing bodies via macros.
; ---------------------------------------------------------------------------

!include "LogicLib.nsh"
!include "WinMessages.nsh"
!include "nsDialogs.nsh"
!include "${BUILD_RESOURCES_DIR}\art-layout.nsh"

; Without this Windows treats the installer as a program from before high-DPI
; displays and scales the whole window as an image: the artwork, rendered at 2×
; precisely to avoid that, would go soft and stop covering the window.
ManifestDPIAware true

; ---- the few colours still mixed at run time, from the browser's dark theme
!define NYA_BG      "0C0D12"
!define NYA_DIM     "9B9CA0"

; The accent and the progress track as COLORREF (0x00BBGGRR), which is what
; the progress bar messages want.
!define NYA_ACCENT_BGR 0x00FF6C7C
!define NYA_TRACK_BGR  0x00221E1D

!define /ifndef PBM_SETBARCOLOR 0x0409
!define /ifndef PBM_SETBKCOLOR  0x2001
!define /ifndef STM_SETIMAGE    0x0172
!define /ifndef PBM_SETMARQUEE  0x040A

; WS_CHILD|WS_VISIBLE plus, in turn: SS_NOPREFIX for a plain label, the same
; with SS_PATHELLIPSIS, SS_NOTIFY for an invisible hit area, and
; SS_BITMAP|SS_REALSIZECONTROL for both the checkbox squares and the
; full-window art — every bitmap here is rendered at 2× and has to be scaled
; down to whatever the display makes of the design pixel.
!define NYA_LABEL   0x50000080
!define NYA_PATH    0x50008080
!define NYA_HIT     0x5000010D   ; SS_OWNERDRAW|SS_NOTIFY: unpainted, clickable
!define NYA_IMAGE   0x5000004E
!define NYA_ART     0x5000004E

Var nyaScale          ; display scale in percent (100 = 96 dpi)
Var nyaReady          ; window surgery done once
Var nyaW              ; client size, already scaled
Var nyaH
Var nyaFontPath
Var nyaFontSmall
Var nyaDialog
Var nyaArt            ; where the bitmaps live for this half of the script

!ifndef BUILD_UNINSTALLER
Var nyaProgressDone
Var nyaPathLabel
Var nyaBoxDesktop
Var nyaBoxDefault
Var nyaDesktop        ; "1"/"0", empty when the welcome page never ran
Var nyaDefault
Var nyaOldVersion
!else
Var nyaBoxWipe
Var nyaWipe
Var nyaUnShroud       ; the progress-page artwork, over the wizard's own page
Var nyaUnBar          ; MUI's progress bar after it is re-hung on the window
!endif

; Scales a design pixel to the display. Every coordinate is written at 100%, so
; a 150% display gets a 960×600 window rather than a postage stamp.
!macro NyaPx OUT VALUE
  IntOp ${OUT} ${VALUE} * $nyaScale
  IntOp ${OUT} ${OUT} / 100
!macroend
!define px "!insertmacro NyaPx"

; Creates a control on an arbitrary dialog: nsDialogs only builds controls on a
; dialog it created itself, and the progress page is MUI's. Uses $0-$3.
!macro NyaControl OUT PARENT STYLE X Y W H TEXT
  ${px} $0 ${X}
  ${px} $1 ${Y}
  ${px} $2 ${W}
  ${px} $3 ${H}
  System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w "${TEXT}", \
    i ${STYLE}, i $0, i $1, i $2, i $3, p ${PARENT}, p 0, p 0, p 0) p .s'
  Pop ${OUT}
!macroend
!define control "!insertmacro NyaControl"

; Loads a bitmap and rescales it to the size it will be shown at. Letting the
; static control stretch it instead is what makes the artwork look chewed: its
; StretchBlt drops pixels, while HALFTONE averages them, which is the whole
; point of rendering the design at 2×. Uses $2-$8.
!macro NyaScaledImage HWND FILE W H
  System::Call 'user32::LoadImageW(p 0, t "$nyaArt\${FILE}", i 0, i 0, i 0, \
    i 0x10) p .r5'

  ; BITMAP: type, width, height, widthBytes, planes+bitsPixel, bits
  System::Call '*(i, i, i, i, i, p) p .r4'
  System::Call 'gdi32::GetObjectW(p $5, i 32, p $4)'
  System::Call '*$4(i, i .r2, i .r3)'
  System::Free $4

  System::Call 'user32::GetDC(p 0) p .r4'
  System::Call 'gdi32::CreateCompatibleDC(p $4) p .r6'
  System::Call 'gdi32::CreateCompatibleDC(p $4) p .r7'
  System::Call 'gdi32::CreateCompatibleBitmap(p $4, i ${W}, i ${H}) p .r8'
  System::Call 'gdi32::SelectObject(p $6, p $5)'
  System::Call 'gdi32::SelectObject(p $7, p $8)'
  System::Call 'gdi32::SetStretchBltMode(p $7, i 4)'
  System::Call 'gdi32::SetBrushOrgEx(p $7, i 0, i 0, p 0)'
  System::Call 'gdi32::StretchBlt(p $7, i 0, i 0, i ${W}, i ${H}, p $6, i 0, \
    i 0, i $2, i $3, i 0x00CC0020)'
  System::Call 'gdi32::DeleteDC(p $6)'
  System::Call 'gdi32::DeleteDC(p $7)'
  System::Call 'gdi32::DeleteObject(p $5)'
  System::Call 'user32::ReleaseDC(p 0, p $4)'

  SendMessage ${HWND} ${STM_SETIMAGE} 0 $8
!macroend
!define scaledImage "!insertmacro NyaScaledImage"

; The design, full window, pushed behind everything else.
!macro NyaBackdrop PARENT FILE
  ${control} $R1 ${PARENT} ${NYA_ART} 0 0 640 400 ""
  ${scaledImage} $R1 "${FILE}" $nyaW $nyaH
  System::Call 'user32::SetWindowPos(p $R1, p 1, i 0, i 0, i 0, i 0, i 0x13)'
!macroend
!define backdrop "!insertmacro NyaBackdrop"

; An invisible control over a button drawn in the bitmap: owner-drawn with
; nobody willing to draw it, so it paints nothing, and SS_NOTIFY reports the
; clicks. Two traps live here, both learned the hard way: SetCtlColors
; "transparent" sets WS_EX_TRANSPARENT and Windows routes the mouse to
; whatever lies beneath, and nsDialogs::OnClick only fires for controls
; nsDialogs itself created — so the control is made through the plugin, not
; CreateWindowEx. Every page with a clickable spot is an nsDialogs page.
!macro NyaHit PARENT RECT CALLBACK
  ${px} $0 ${${RECT}_X}
  ${px} $1 ${${RECT}_Y}
  ${px} $2 ${${RECT}_W}
  ${px} $3 ${${RECT}_H}
  nsDialogs::CreateControl STATIC ${NYA_HIT} 0 $0 $1 $2 $3 ""
  Pop $R1
  ${NSD_OnClick} $R1 ${CALLBACK}
!macroend
!define hit "!insertmacro NyaHit"

!macro NyaCheckbox OUT PARENT RECT FILE
  ${control} ${OUT} ${PARENT} ${NYA_IMAGE} ${${RECT}_X} ${${RECT}_Y} ${${RECT}_W} ${${RECT}_H} ""
  ${px} $R2 ${${RECT}_W}
  ${px} $R3 ${${RECT}_H}
  ${scaledImage} ${OUT} "${FILE}" $R2 $R3
!macroend
!define checkbox "!insertmacro NyaCheckbox"

; Swaps a checkbox square for its other state. Loading the bitmap again each
; time costs nothing at these sizes and saves keeping handles around.
!macro NyaCheckSwap HWND RECT FILE
  ${px} $R2 ${${RECT}_W}
  ${px} $R3 ${${RECT}_H}
  ${scaledImage} ${HWND} "${FILE}" $R2 $R3
!macroend
!define checkSwap "!insertmacro NyaCheckSwap"

; Sizes the window to the design and strips the frame, because the design
; draws its own title strip. Installer and uninstaller each wrap this.
!macro NyaChromeBody
  ${If} $nyaReady == "1"
    Return
  ${EndIf}
  StrCpy $nyaReady "1"

  ; Display scale. GetDeviceCaps is everywhere; the per-monitor APIs are not,
  ; and the window opens on the primary display anyway.
  System::Call 'user32::GetDC(p 0) p .r0'
  System::Call 'gdi32::GetDeviceCaps(p r0, i 88) i .r1'
  System::Call 'user32::ReleaseDC(p 0, p r0)'
  ${If} $1 < 96
    StrCpy $1 96
  ${EndIf}
  IntOp $nyaScale $1 * 100
  IntOp $nyaScale $nyaScale / 96

  ; Point sizes are scaled by NSIS itself, so these stay as designed: 12.5px
  ; and 11px of the design, in points.
  CreateFont $nyaFontPath "Segoe UI" 9 400
  CreateFont $nyaFontSmall "Segoe UI" 8 400

  ${px} $nyaW 640
  ${px} $nyaH 400

  ; Off with the caption, the resizing border and the system menu: the design
  ; has its own close button and the window is not resizable.
  System::Call 'user32::GetWindowLongW(p $HWNDPARENT, i -16) i .r1'
  IntOp $2 0x00CF0000 ~
  IntOp $1 $1 & $2
  System::Call 'user32::SetWindowLongW(p $HWNDPARENT, i -16, i $1)'

  ; Extended styles: WS_EX_APPWINDOW keeps the window on the taskbar now that
  ; the caption is gone, and off go WS_EX_DLGMODALFRAME and WS_EX_WINDOWEDGE —
  ; the one-pixel raised edge a dialog carries, which the design does not.
  System::Call 'user32::GetWindowLongW(p $HWNDPARENT, i -20) i .r1'
  IntOp $1 $1 | 0x40000
  IntOp $2 0x101 ~
  IntOp $1 $1 & $2
  System::Call 'user32::SetWindowLongW(p $HWNDPARENT, i -20, i $1)'

  System::Call 'user32::GetSystemMetrics(i 0) i .r4'
  System::Call 'user32::GetSystemMetrics(i 1) i .r5'
  IntOp $R6 $4 - $nyaW
  IntOp $R6 $R6 / 2
  IntOp $R7 $5 - $nyaH
  IntOp $R7 $R7 / 2
  ; SWP_FRAMECHANGED, so the frame we just removed is actually recomputed.
  System::Call 'user32::SetWindowPos(p $HWNDPARENT, p 0, i $R6, i $R7, \
    i $nyaW, i $nyaH, i 0x34)'

  ; DWMWA_NCRENDERING_POLICY = DISABLED: no drop shadow and no rounded corners.
  ; The design is a plain rectangle, and on a dark desktop the shadow reads as
  ; a black band down the right side of the window rather than as a shadow.
  System::Call '*(i 1) p .r2'
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 2, p r2, i 4)'
  System::Free $2

  SetCtlColors $HWNDPARENT ${NYA_DIM} ${NYA_BG}

!macroend

; A page of our own: the dialog resized to the whole window with the design
; behind it.
; Everything the Modern UI draws around a page: the header strip and its two
; texts, the header image, both separator lines, the branding bar and the three
; wizard buttons. MUI puts back whichever of them a page wants every time it
; shows one, so hiding them once is not enough — this runs per page.
!macro NyaHideChrome
  Push $R2

  ; NSIS nudges the window around between pages (most visibly after the
  ; install section), so its size and centre are re-asserted with the hiding.
  System::Call 'user32::GetSystemMetrics(i 0) i .r2'
  IntOp $2 $2 - $nyaW
  IntOp $2 $2 / 2
  System::Call 'user32::GetSystemMetrics(i 1) i .r3'
  IntOp $3 $3 - $nyaH
  IntOp $3 $3 / 2
  System::Call 'user32::SetWindowPos(p $HWNDPARENT, p 0, i $2, i $3, i $nyaW, i $nyaH, i 0x14)'

  GetDlgItem $R2 $HWNDPARENT 1
  ShowWindow $R2 ${SW_HIDE}
  GetDlgItem $R2 $HWNDPARENT 2
  ShowWindow $R2 ${SW_HIDE}
  GetDlgItem $R2 $HWNDPARENT 3
  ShowWindow $R2 ${SW_HIDE}
  GetDlgItem $R2 $HWNDPARENT 1028
  ShowWindow $R2 ${SW_HIDE}
  GetDlgItem $R2 $HWNDPARENT 1034
  ShowWindow $R2 ${SW_HIDE}
  GetDlgItem $R2 $HWNDPARENT 1035
  ShowWindow $R2 ${SW_HIDE}
  GetDlgItem $R2 $HWNDPARENT 1037
  ShowWindow $R2 ${SW_HIDE}
  GetDlgItem $R2 $HWNDPARENT 1038
  ShowWindow $R2 ${SW_HIDE}
  GetDlgItem $R2 $HWNDPARENT 1039
  ShowWindow $R2 ${SW_HIDE}
  GetDlgItem $R2 $HWNDPARENT 1045
  ShowWindow $R2 ${SW_HIDE}
  GetDlgItem $R2 $HWNDPARENT 1046
  ShowWindow $R2 ${SW_HIDE}
  GetDlgItem $R2 $HWNDPARENT 1256
  ShowWindow $R2 ${SW_HIDE}
  Pop $R2
!macroend

!macro NyaPage FILE
  nsDialogs::Create 1018
  Pop $nyaDialog
  ${If} $nyaDialog == error
    Abort
  ${EndIf}
  ; After the dialog exists, never before: hiding the wizard's buttons first
  ; leaves nsDialogs without the layout it measures against and the page is
  ; dropped — which is how the uninstaller ended up on MUI's own finish screen.
  !insertmacro NyaHideChrome
  SetCtlColors $nyaDialog ${NYA_DIM} ${NYA_BG}
  System::Call 'user32::MoveWindow(p $nyaDialog, i 0, i 0, i $nyaW, i $nyaH, i 1)'
  ${backdrop} $nyaDialog "${FILE}"
!macroend
!define page "!insertmacro NyaPage"

; MUI's instfiles page, which is the same in both halves: hide its controls,
; lay the design over them and put the progress bar where the design draws it.
!macro NyaProgressBody FILE RECT
  !insertmacro NyaHideChrome

  ; Not just the first child dialog: while pages change, the previous page's
  ; dialog can still be alive, and dressing that one leaves the real progress
  ; page raw — the white box the user saw. The page we want is the one that
  ; owns the progress bar (control 1004).
  FindWindow $R8 "#32770" "" $HWNDPARENT
  ${DoWhile} $R8 <> 0
    GetDlgItem $R9 $R8 1004
    ${IfThen} $R9 <> 0 ${|} ${ExitDo} ${|}
    FindWindow $R8 "#32770" "" $HWNDPARENT $R8
  ${Loop}
  ${If} $R8 = 0
    Return
  ${EndIf}

  SetCtlColors $R8 ${NYA_DIM} ${NYA_BG}
  System::Call 'user32::MoveWindow(p $R8, i 0, i 0, i $nyaW, i $nyaH, i 1)'

  GetDlgItem $R9 $R8 1016     ; the log
  ShowWindow $R9 ${SW_HIDE}
  GetDlgItem $R9 $R8 1027     ; "Show details"
  ShowWindow $R9 ${SW_HIDE}
  GetDlgItem $R9 $R8 1006     ; the status line, which the design draws
  ShowWindow $R9 ${SW_HIDE}

  ${backdrop} $R8 "${FILE}"

  GetDlgItem $R9 $R8 1004
  System::Call 'uxtheme::SetWindowTheme(p $R9, w " ", w " ")'
  SendMessage $R9 ${PBM_SETBARCOLOR} 0 ${NYA_ACCENT_BGR}
  SendMessage $R9 ${PBM_SETBKCOLOR} 0 ${NYA_TRACK_BGR}
  ${px} $0 ${${RECT}_X}
  ${px} $1 ${${RECT}_Y}
  ${px} $2 ${${RECT}_W}
  ${px} $3 ${${RECT}_H}
  System::Call 'user32::MoveWindow(p $R9, i $0, i $1, i $2, i $3, i 1)'
  System::Call 'user32::SetWindowPos(p $R9, p 0, i 0, i 0, i 0, i 0, i 0x13)'
!macroend

; ---------------------------------------------------------------------------

!macro customHeader
!ifndef BUILD_UNINSTALLER
  ; ============================================================== installer
  Function nyaInitChrome
    StrCpy $nyaArt "$PLUGINSDIR"
    !insertmacro NyaChromeBody
  FunctionEnd

  ; --------------------------------------------------------------- welcome
  Function nyaWelcomeCreate
    ; An update has nothing to ask about: straight to the progress page.
    ${If} ${isUpdated}
      Abort
    ${EndIf}

    Call nyaInitChrome
    ${page} "welcome.bmp"

    ; The one line that depends on the machine rather than the design.
    ${control} $nyaPathLabel $nyaDialog ${NYA_PATH} \
      ${ART_WELCOME_PATH_X} ${ART_WELCOME_PATH_Y} \
      ${ART_WELCOME_PATH_W} ${ART_WELCOME_PATH_H} "$INSTDIR"
    SendMessage $nyaPathLabel ${WM_SETFONT} $nyaFontPath 1
    SetCtlColors $nyaPathLabel ${NYA_DIM} transparent

    StrCpy $nyaDesktop "1"
    StrCpy $nyaDefault "1"
    ${checkbox} $nyaBoxDesktop $nyaDialog ART_WELCOME_BOX_DESKTOP \
      "welcome-box-desktop-on.bmp"
    ${checkbox} $nyaBoxDefault $nyaDialog ART_WELCOME_BOX_DEFAULT \
      "welcome-box-default-on.bmp"

    ${hit} $nyaDialog ART_WELCOME_INSTALL nyaInstallClicked
    ${hit} $nyaDialog ART_WELCOME_BROWSE nyaBrowseClicked
    ${hit} $nyaDialog ART_WELCOME_ROW_DESKTOP nyaDesktopClicked
    ${hit} $nyaDialog ART_WELCOME_ROW_DEFAULT nyaDefaultClicked
    ${hit} $nyaDialog ART_WELCOME_CLOSE_X nyaCloseClicked

    nsDialogs::Show
  FunctionEnd

  Function nyaInstallClicked
    Pop $R9
    ; The page's own Next button is hidden; this is what pressing it does.
    SendMessage $HWNDPARENT ${WM_COMMAND} 1 0
  FunctionEnd

  ; Quit inside a click callback leaves a hidden zombie process behind, so
  ; closing is done the way the wizard understands: by pressing its own hidden
  ; buttons. 2 is Cancel (silent — no abort warning is configured), 1 is Next,
  ; which on a last page means Close.
  Function nyaCloseClicked
    Pop $R9
    SendMessage $HWNDPARENT ${WM_COMMAND} 2 0
  FunctionEnd

  Function nyaFinishCloseClicked
    Pop $R9
    SendMessage $HWNDPARENT ${WM_COMMAND} 1 0
  FunctionEnd

  Function nyaDesktopClicked
    Pop $R9
    ${If} $nyaDesktop == "1"
      StrCpy $nyaDesktop "0"
      ${checkSwap} $nyaBoxDesktop ART_WELCOME_BOX_DESKTOP "welcome-box-desktop-off.bmp"
    ${Else}
      StrCpy $nyaDesktop "1"
      ${checkSwap} $nyaBoxDesktop ART_WELCOME_BOX_DESKTOP "welcome-box-desktop-on.bmp"
    ${EndIf}
  FunctionEnd

  Function nyaDefaultClicked
    Pop $R9
    ${If} $nyaDefault == "1"
      StrCpy $nyaDefault "0"
      ${checkSwap} $nyaBoxDefault ART_WELCOME_BOX_DEFAULT "welcome-box-default-off.bmp"
    ${Else}
      StrCpy $nyaDefault "1"
      ${checkSwap} $nyaBoxDefault ART_WELCOME_BOX_DEFAULT "welcome-box-default-on.bmp"
    ${EndIf}
  FunctionEnd

  Function nyaBrowseClicked
    Pop $R9
    nsDialogs::SelectFolderDialog "Куда установить Nya Browser" "$INSTDIR"
    Pop $R0
    ${If} $R0 == error
      Return
    ${EndIf}

    ; A folder picker returns the folder the user clicked, so the application
    ; folder is appended unless it is already there — otherwise pressing
    ; "Изменить" twice would nest the browser inside itself.
    StrLen $R1 "${APP_FILENAME}"
    IntOp $R1 0 - $R1
    StrCpy $R2 $R0 "" $R1
    ${If} $R2 != "${APP_FILENAME}"
      StrCpy $R0 "$R0\${APP_FILENAME}"
    ${EndIf}
    StrCpy $INSTDIR $R0
    SendMessage $nyaPathLabel ${WM_SETTEXT} 0 "STR:$INSTDIR"
  FunctionEnd

  ; -------------------------------------------------------------- progress
  Function nyaInstallShow
    Call nyaInitChrome
    ${If} $nyaProgressDone == "1"
      Return
    ${EndIf}
    StrCpy $nyaProgressDone "1"

    ${If} ${isUpdated}
      !insertmacro NyaProgressBody "updating.bmp" ART_UPDATING_PROGRESS

      ; The design shows which version is replacing which, and only the
      ; installer knows the old one.
      ${If} $nyaOldVersion == ""
        StrCpy $R0 "Версия ${VERSION}"
      ${Else}
        StrCpy $R0 "$nyaOldVersion  →  ${VERSION}"
      ${EndIf}
      ${control} $R9 $R8 0x50000081 ${ART_UPDATING_VERSION_X} \
        ${ART_UPDATING_VERSION_Y} ${ART_UPDATING_VERSION_W} \
        ${ART_UPDATING_VERSION_H} "$R0"
      SendMessage $R9 ${WM_SETFONT} $nyaFontSmall 1
      SetCtlColors $R9 ${NYA_DIM} transparent
    ${Else}
      !insertmacro NyaProgressBody "installing.bmp" ART_INSTALLING_PROGRESS
    ${EndIf}
  FunctionEnd

  ; ---------------------------------------------------------------- finish
  Function nyaFinishCreate
    Call nyaInitChrome
    ${page} "installed.bmp"
    ${hit} $nyaDialog ART_INSTALLED_LAUNCH nyaLaunchClicked
    ${hit} $nyaDialog ART_INSTALLED_CLOSE_X nyaFinishCloseClicked
    nsDialogs::Show
  FunctionEnd

  Function nyaLaunchClicked
    Pop $R9
    HideWindow
    ${StdUtils.ExecShellAsUser} $R0 "$launchLink" "open" ""
    SendMessage $HWNDPARENT ${WM_COMMAND} 1 0
  FunctionEnd

!else
  ; ============================================================ uninstaller
  Function un.nyaInitChrome
    !insertmacro NyaChromeBody
  FunctionEnd

  ; --------------------------------------------------------------- confirm
  Function un.nyaConfirmCreate
    Call un.nyaInitChrome
    ${page} "un-confirm.bmp"

    StrCpy $nyaWipe "0"
    ${checkbox} $nyaBoxWipe $nyaDialog ART_UN_CONFIRM_BOX_WIPE \
      "un-confirm-box-wipe-off.bmp"

    ${hit} $nyaDialog ART_UN_CONFIRM_REMOVE un.nyaRemoveClicked
    ${hit} $nyaDialog ART_UN_CONFIRM_CANCEL un.nyaCancelClicked
    ${hit} $nyaDialog ART_UN_CONFIRM_ROW_WIPE un.nyaWipeClicked
    ${hit} $nyaDialog ART_UN_CONFIRM_CLOSE_X un.nyaCancelClicked

    nsDialogs::Show
  FunctionEnd

  ; The progress page is drawn here rather than in a page callback, and this
  ; is why: MUI's SHOW hook for the uninstall progress page is swallowed at
  ; compile time by the install-mode page that sits in front of it, and windows
  ; created from the uninstall section — a worker thread — never paint. So the
  ; artwork becomes a child of the outer window at the moment of the click,
  ; while the UI thread is still ours and before NSIS builds its own page.
  Function un.nyaRemoveClicked
    Pop $R9

    ; The progress screen is an owned popup, not a control on the page, and
    ; that is deliberate. MUI's SHOW hook for the uninstall progress page is
    ; swallowed at compile time by the install-mode page in front of it; the
    ; uninstall section runs on a worker thread, where a created window never
    ; paints and where ordering the wizard's own windows about has no effect.
    ; A popup owned by the wizard always floats above it, so there is nothing
    ; left to fight: it is built here, on the UI thread, and simply stays up.
    System::Call '*(i, i, i, i) p .r4'
    System::Call 'user32::GetWindowRect(p $HWNDPARENT, p $4)'
    System::Call '*$4(i .r5, i .r6)'
    System::Free $4

    System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w "", \
      i 0x9000004E, i $5, i $6, i $nyaW, i $nyaH, p $HWNDPARENT, p 0, p 0, \
      p 0) p .s'
    Pop $nyaUnShroud
    ${scaledImage} $nyaUnShroud "un-progress.bmp" $nyaW $nyaH

    ; A marquee bar: the section cannot report progress to another thread's
    ; window, and a bar that animates on its own is honest about that.
    ${px} $0 ${ART_UN_PROGRESS_PROGRESS_X}
    ${px} $1 ${ART_UN_PROGRESS_PROGRESS_Y}
    ${px} $2 ${ART_UN_PROGRESS_PROGRESS_W}
    ${px} $3 ${ART_UN_PROGRESS_PROGRESS_H}
    System::Call 'user32::CreateWindowExW(i 0, w "msctls_progress32", w "", \
      i 0x50000008, i $0, i $1, i $2, i $3, p $nyaUnShroud, p 0, p 0, p 0) p .s'
    Pop $nyaUnBar
    System::Call 'uxtheme::SetWindowTheme(p $nyaUnBar, w " ", w " ")'
    SendMessage $nyaUnBar ${PBM_SETBARCOLOR} 0 ${NYA_ACCENT_BGR}
    SendMessage $nyaUnBar ${PBM_SETBKCOLOR} 0 ${NYA_TRACK_BGR}
    SendMessage $nyaUnBar ${PBM_SETMARQUEE} 1 40

    SendMessage $HWNDPARENT ${WM_COMMAND} 1 0
  FunctionEnd

  Function un.nyaCancelClicked
    Pop $R9
    SendMessage $HWNDPARENT ${WM_COMMAND} 2 0
  FunctionEnd

  Function un.nyaDoneCloseClicked
    Pop $R9
    SendMessage $HWNDPARENT ${WM_COMMAND} 1 0
  FunctionEnd

  ; MUI's own uninstall finish page follows ours; skipping the last page ends
  ; the wizard, which is exactly what Close should do.
  Function un.nyaSkipFinish
    Abort
  FunctionEnd

  Function un.nyaWipeClicked
    Pop $R9
    ${If} $nyaWipe == "1"
      StrCpy $nyaWipe "0"
      ${checkSwap} $nyaBoxWipe ART_UN_CONFIRM_BOX_WIPE "un-confirm-box-wipe-off.bmp"
    ${Else}
      StrCpy $nyaWipe "1"
      ${checkSwap} $nyaBoxWipe ART_UN_CONFIRM_BOX_WIPE "un-confirm-box-wipe-on.bmp"
    ${EndIf}
  FunctionEnd

  ; -------------------------------------------------------------- progress


  ; ---------------------------------------------------------------- finish
  ; Shown in place of MUI's finish page: its button quits, so the default one
  ; that follows is never reached.
  Function un.nyaDoneCreate
    Call un.nyaInitChrome
    ${If} $nyaUnShroud <> 0
      System::Call 'user32::DestroyWindow(p $nyaUnShroud)'
      StrCpy $nyaUnShroud 0
      StrCpy $nyaUnBar 0
    ${EndIf}
    ${page} "un-done.bmp"
    ${hit} $nyaDialog ART_UN_DONE_CLOSE un.nyaDoneCloseClicked
    ${hit} $nyaDialog ART_UN_DONE_CLOSE_X un.nyaDoneCloseClicked
    nsDialogs::Show
  FunctionEnd
!endif
!macroend

; ---------------------------------------------------------------------------

!macro customUnInit
  ; The artwork lives in the folder this program is about to delete, so a copy
  ; goes to the temp folder before any page needs it.
  InitPluginsDir
  CopyFiles /SILENT "$INSTDIR\un-confirm.bmp" "$PLUGINSDIR"
  CopyFiles /SILENT "$INSTDIR\un-progress.bmp" "$PLUGINSDIR"
  CopyFiles /SILENT "$INSTDIR\un-done.bmp" "$PLUGINSDIR"
  CopyFiles /SILENT "$INSTDIR\un-confirm-box-wipe-on.bmp" "$PLUGINSDIR"
  CopyFiles /SILENT "$INSTDIR\un-confirm-box-wipe-off.bmp" "$PLUGINSDIR"
  StrCpy $nyaArt "$PLUGINSDIR"
!macroend

!macro customInit
  ; The design's progress page has no "Next" button, and NSIS waits for one
  ; before moving on. This is the switch MUI's own finish page flips: with it
  ; the wizard advances by itself once the section is done.
  SetAutoClose true

  InitPluginsDir
  File "/oname=$PLUGINSDIR\welcome.bmp" "${BUILD_RESOURCES_DIR}\art\welcome.bmp"
  File "/oname=$PLUGINSDIR\installing.bmp" "${BUILD_RESOURCES_DIR}\art\installing.bmp"
  File "/oname=$PLUGINSDIR\updating.bmp" "${BUILD_RESOURCES_DIR}\art\updating.bmp"
  File "/oname=$PLUGINSDIR\installed.bmp" "${BUILD_RESOURCES_DIR}\art\installed.bmp"
  File "/oname=$PLUGINSDIR\welcome-box-desktop-on.bmp" "${BUILD_RESOURCES_DIR}\art\welcome-box-desktop-on.bmp"
  File "/oname=$PLUGINSDIR\welcome-box-desktop-off.bmp" "${BUILD_RESOURCES_DIR}\art\welcome-box-desktop-off.bmp"
  File "/oname=$PLUGINSDIR\welcome-box-default-on.bmp" "${BUILD_RESOURCES_DIR}\art\welcome-box-default-on.bmp"
  File "/oname=$PLUGINSDIR\welcome-box-default-off.bmp" "${BUILD_RESOURCES_DIR}\art\welcome-box-default-off.bmp"

  ; Read before the install section overwrites it, so the update window can
  ; say what it is updating from.
  StrCpy $nyaOldVersion ""
  !ifdef UNINSTALL_REGISTRY_KEY
    ReadRegStr $nyaOldVersion SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
  !endif
!macroend

; This browser installs for the current user. Asking about it would be a page
; with one real answer.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customWelcomePage
  Page custom nyaWelcomeCreate
!macroend

; Inserted immediately before MUI's instfiles page, which is the only place its
; SHOW callback can be declared.
!macro customPageAfterChangeDir
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW nyaInstallShow
!macroend

!macro customFinishPage
  Page custom nyaFinishCreate
!macroend

!macro customUnWelcomePage
  UninstPage custom un.nyaConfirmCreate
!macroend

!macro customUninstallPage
  UninstPage custom un.nyaDoneCreate
  !define MUI_PAGE_CUSTOMFUNCTION_PRE un.nyaSkipFinish
!macroend

!macro customInstall
  ; The uninstaller draws the same windows and cannot unpack anything, so its
  ; artwork travels with the application.
  SetOutPath $INSTDIR
  File "${BUILD_RESOURCES_DIR}\art\un-confirm.bmp"
  File "${BUILD_RESOURCES_DIR}\art\un-progress.bmp"
  File "${BUILD_RESOURCES_DIR}\art\un-done.bmp"
  File "${BUILD_RESOURCES_DIR}\art\un-confirm-box-wipe-on.bmp"
  File "${BUILD_RESOURCES_DIR}\art\un-confirm-box-wipe-off.bmp"

  ; The two checkboxes. Both are empty in a silent or updating run, where the
  ; welcome page never appeared and the existing choices must stand.
  ${If} $nyaDesktop == "0"
    Delete "$newDesktopLink"
  ${EndIf}

  ${If} $nyaDefault == "1"
    WriteRegStr HKCU "Software\Nya Browser" "SetDefaultOnFirstRun" "1"
  ${EndIf}

  ; An update replaces a browser the user was just looking at, so it puts it
  ; back on screen itself instead of ending on a "Finish" button.
  ${If} ${isUpdated}
    HideWindow
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "--updated"
    !insertmacro quitSuccess
  ${EndIf}

  ; The design has no Next button on the progress page, so nothing would move
  ; the wizard on to "Готово". Posted rather than sent: it has to arrive after
  ; this section returns.
  ${IfNot} ${Silent}
    System::Call 'user32::PostMessageW(p $HWNDPARENT, i ${WM_COMMAND}, p 1, p 0)'
  ${EndIf}
!macroend

!macro customUnInstall
  ${If} $nyaWipe == "1"
    RMDir /r "$APPDATA\Nya Browser"
    DeleteRegKey HKCU "Software\Nya Browser"
  ${EndIf}
!macroend
