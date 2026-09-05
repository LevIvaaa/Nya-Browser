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
!include "WordFunc.nsh"
!include "WinMessages.nsh"
!include "nsDialogs.nsh"
!include "${BUILD_RESOURCES_DIR}\art-layout.nsh"
!include "${BUILD_RESOURCES_DIR}\installer-langs.nsh"

; The version goes into a sentence whose shape the language decides.
!ifndef BUILD_UNINSTALLER
  !insertmacro WordReplace
!else
  !insertmacro un.WordReplace
!endif

; Without this Windows treats the installer as a program from before high-DPI
; displays and scales the whole window as an image: the artwork, rendered at 2×
; precisely to avoid that, would go soft and stop covering the window.
ManifestDPIAware true

; ---- the few colours still mixed at run time, from the browser's dark theme
!define NYA_BG      "0C0D12"
!define NYA_DIM     "9B9CA0"
!define NYA_TEXT    "F2F3F7"
!define NYA_FAINT   "6C6D72"
!define NYA_WHITE   "FFFFFF"

; The accent and the progress track as COLORREF (0x00BBGGRR), which is what
; the progress bar messages want.
!define NYA_ACCENT_BGR 0x00FF6C7C
!define NYA_TRACK_BGR  0x00221E1D

!define /ifndef PBM_SETBARCOLOR 0x0409
!define /ifndef PBM_SETBKCOLOR  0x2001
!define /ifndef STM_SETIMAGE    0x0172
!define /ifndef STM_GETIMAGE    0x0173
!define /ifndef PBM_SETMARQUEE  0x040A

; WS_CHILD|WS_VISIBLE plus, in turn: SS_NOPREFIX for a plain label, the same
; with SS_PATHELLIPSIS, SS_NOTIFY for an invisible hit area, and
; SS_BITMAP|SS_REALSIZECONTROL for both the checkbox squares and the
; full-window art — every bitmap here is rendered at 2× and has to be scaled
; down to whatever the display makes of the design pixel.
!define NYA_LABEL   0x50000080
!define NYA_PATH    0x50008080
!define NYA_HIT     0x5000010D   ; SS_OWNERDRAW|SS_NOTIFY: unpainted, clickable
!define NYA_TXT_L   0x50000080   ; a line of live text, left-aligned
!define NYA_TXT_C   0x50000081   ; the same, centred in its box
!define NYA_TXT_LV  0x50000280   ; left, and centred on the box's own height
!define NYA_TXT_CV  0x50000281   ; centred both ways — button captions
!define NYA_IMAGE   0x5000004E
!define NYA_ART     0x5000004E

Var nyaScale          ; display scale in percent (100 = 96 dpi)
Var nyaReady          ; window surgery done once
Var nyaW              ; client size, already scaled
Var nyaH
Var nyaFontPath
Var nyaFontSmall
Var nyaFontBody       ; 13.5 px body copy
Var nyaFontBtn        ; 15 px medium — button captions
Var nyaFontBtnSm      ; 12.5 px medium — the small secondary button
Var nyaFontH20        ; the progress headings
Var nyaFontH22
Var nyaFontH24
Var nyaFontH26
Var nyaLangIni        ; the string file the chosen language reads from
Var nyaDialog
Var nyaArt            ; where the bitmaps live for this half of the script

!ifndef BUILD_UNINSTALLER
Var nyaProgressDone
Var nyaPathLabel
Var nyaBoxDesktop
Var nyaBoxDefault
Var nyaSysCode        ; language code Windows itself is set to
Var nyaLang           ; browser language code chosen in the pill; "" = system
Var nyaTagline        ; the welcome page's live text, re-set on every pick
Var nyaInstallLabel
Var nyaPathTitle
Var nyaBrowseLabel
Var nyaDesktopLabel
Var nyaDefaultLabel
Var nyaVersionLabel
Var nyaLangLabel      ; the pill's STATIC with the language name
Var nyaLangStrip      ; the patch of artwork the pill is drawn on
Var nyaLangHit        ; its click zone, which grows with the pill
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
; A line of text the artwork no longer carries. The design measured the box;
; the language decides what goes in it, which is the whole reason these are
; controls and not pixels.
!macro NyaText OUT PARENT STYLE X Y W H FONT COLOUR
  ${control} ${OUT} ${PARENT} ${STYLE} ${X} ${Y} ${W} ${H} ""
  SendMessage ${OUT} ${WM_SETFONT} ${FONT} 1
  SetCtlColors ${OUT} ${COLOUR} transparent
!macroend
!define text "!insertmacro NyaText"

; Reads one string for the language in force. A missing key leaves the
; variable empty rather than failing the install.
!macro NyaStr OUT KEY
  ClearErrors
  ReadINIStr ${OUT} "$nyaLangIni" "strings" "${KEY}"
  ${If} ${Errors}
    StrCpy ${OUT} ""
  ${EndIf}
!macroend
!define str "!insertmacro NyaStr"

; Sets a label from the string file in one line.
!macro NyaSetStr HWND KEY
  ${str} $R7 "${KEY}"
  SendMessage ${HWND} ${WM_SETTEXT} 0 "STR:$R7"
!macroend
!define setstr "!insertmacro NyaSetStr"

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

; One rung of the pill ladder: the first baked width that holds the name wins.
; $R6 is the name's width in device pixels, $R7 the width chosen so far.
!macro NyaPillPick W
  ${If} $R7 == ""
    ${px} $R8 ${W}
    ${IfThen} $R6 <= $R8 ${|} StrCpy $R7 ${W} ${|}
  ${EndIf}
!macroend

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
  ; The design is drawn in CSS pixels; a point is three quarters of one.
  CreateFont $nyaFontBody "Segoe UI" 10 400
  CreateFont $nyaFontBtn "Segoe UI" 11 500
  CreateFont $nyaFontBtnSm "Segoe UI" 9 500
  CreateFont $nyaFontH20 "Segoe UI" 15 600
  CreateFont $nyaFontH22 "Segoe UI" 17 600
  CreateFont $nyaFontH24 "Segoe UI" 18 600
  CreateFont $nyaFontH26 "Segoe UI" 20 600

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

    ; Everything the design used to have baked in. The artwork keeps the
    ; layout; these carry the words, so the page can speak any language.
    ${text} $nyaTagline $nyaDialog ${NYA_TXT_C}       0 ${ART_WELCOME_TAGLINE_Y} 640 ${ART_WELCOME_TAGLINE_H}       $nyaFontBody ${NYA_DIM}
    ${text} $nyaInstallLabel $nyaDialog ${NYA_TXT_CV}       ${ART_WELCOME_INSTALL_X} ${ART_WELCOME_INSTALL_Y}       ${ART_WELCOME_INSTALL_W} ${ART_WELCOME_INSTALL_H} $nyaFontBtn ${NYA_WHITE}
    ${text} $nyaPathTitle $nyaDialog ${NYA_TXT_L}       ${ART_WELCOME_PATH_LABEL_X} ${ART_WELCOME_PATH_LABEL_Y}       300 ${ART_WELCOME_PATH_LABEL_H} $nyaFontSmall ${NYA_FAINT}
    ${text} $nyaBrowseLabel $nyaDialog ${NYA_TXT_CV}       ${ART_WELCOME_BROWSE_X} ${ART_WELCOME_BROWSE_Y}       ${ART_WELCOME_BROWSE_W} ${ART_WELCOME_BROWSE_H} $nyaFontBtnSm ${NYA_TEXT}
    ${text} $nyaDesktopLabel $nyaDialog ${NYA_TXT_LV}       ${ART_WELCOME_LABEL_DESKTOP_X} ${ART_WELCOME_LABEL_DESKTOP_Y}       ${ART_WELCOME_LABEL_DESKTOP_W} ${ART_WELCOME_LABEL_DESKTOP_H}       $nyaFontPath ${NYA_DIM}
    ${text} $nyaDefaultLabel $nyaDialog ${NYA_TXT_LV}       ${ART_WELCOME_LABEL_DEFAULT_X} ${ART_WELCOME_LABEL_DEFAULT_Y}       ${ART_WELCOME_LABEL_DEFAULT_W} ${ART_WELCOME_LABEL_DEFAULT_H}       $nyaFontPath ${NYA_DIM}
    ${text} $nyaVersionLabel $nyaDialog ${NYA_TXT_L}       ${ART_WELCOME_VERSION_LINE_X} ${ART_WELCOME_VERSION_LINE_Y}       400 ${ART_WELCOME_VERSION_LINE_H} $nyaFontSmall ${NYA_FAINT}

    ; The language pill: a patch of artwork with the pill drawn on it, a
    ; native STATIC for the name, and a click zone over the two. All three are
    ; resized together by nyaLangFit, which is what makes the pill fit its
    ; text instead of standing in a box sized for the longest name.
    StrCpy $nyaLang ""
    ${control} $nyaLangStrip $nyaDialog ${NYA_IMAGE} \
      ${ART_WELCOME_LANG_STRIP_X} ${ART_WELCOME_LANG_STRIP_Y} \
      ${ART_WELCOME_LANG_STRIP_W} ${ART_WELCOME_LANG_STRIP_H} ""
    ${control} $nyaLangLabel $nyaDialog ${NYA_LABEL} \
      ${ART_WELCOME_LANG_X} ${ART_WELCOME_LANG_Y} \
      ${ART_WELCOME_LANG_W} ${ART_WELCOME_LANG_H} ""
    SendMessage $nyaLangLabel ${WM_SETFONT} $nyaFontSmall 1
    SetCtlColors $nyaLangLabel ${NYA_DIM} transparent
    ${hit} $nyaDialog ART_WELCOME_LANG_HIT nyaLangClicked
    StrCpy $nyaLangHit $R1

    ; The browser mirrors its language into the same registry value, so a
    ; second install opens the pill on the language the user is actually
    ; reading rather than on whatever Windows is set to. Left untouched the
    ; pill writes nothing back, and that choice survives the reinstall.
    ReadRegStr $R5 HKCU "Software\Nya Browser" "language"
    ${If} $R5 == ""
    ${OrIf} $R5 == "system"
      Call nyaSystemLangName
      Pop $R5
    ${Else}
      Push $R5
      Call nyaLangNameOf
      Pop $R5
    ${EndIf}
    Call nyaLangFit
    Call nyaApplyStrings

    ${hit} $nyaDialog ART_WELCOME_INSTALL nyaInstallClicked
    ${hit} $nyaDialog ART_WELCOME_BROWSE nyaBrowseClicked
    ${hit} $nyaDialog ART_WELCOME_ROW_DESKTOP nyaDesktopClicked
    ${hit} $nyaDialog ART_WELCOME_ROW_DEFAULT nyaDefaultClicked
    ${hit} $nyaDialog ART_WELCOME_CLOSE_X nyaCloseClicked

    nsDialogs::Show
  FunctionEnd

  ; Which string file the installer is reading. An explicit pick wins; with
  ; none, Windows' own language decides; English is what is left.
  Function nyaLangIniPath
    ${If} $nyaLang != ""
      StrCpy $nyaLangIni "$PLUGINSDIR\lang-$nyaLang.ini"
    ${Else}
      StrCpy $nyaLangIni "$PLUGINSDIR\lang-$nyaSysCode.ini"
    ${EndIf}
    ${IfNot} ${FileExists} "$nyaLangIni"
      StrCpy $nyaLangIni "$PLUGINSDIR\lang-en.ini"
    ${EndIf}
  FunctionEnd

  ; Fills the welcome page from the string file. Called once when the page is
  ; built and again after every pick, which is what makes the whole window —
  ; not just the pill — change language.
  Function nyaApplyStrings
    Call nyaLangIniPath
    ${setstr} $nyaTagline "welcome.tagline"
    ${setstr} $nyaInstallLabel "welcome.install"
    ${setstr} $nyaPathTitle "welcome.pathLabel"
    ${setstr} $nyaBrowseLabel "welcome.browse"
    ${setstr} $nyaDesktopLabel "welcome.desktop"
    ${setstr} $nyaDefaultLabel "welcome.default"
    ${str} $R7 "welcome.version"
    ${WordReplace} "$R7" "{v}" "${VERSION}" "+" $R7
    SendMessage $nyaVersionLabel ${WM_SETTEXT} 0 "STR:$R7"
    ; Transparent labels paint over whatever was there; the page has to be
    ; repainted underneath or the old language shows through the new one.
    System::Call 'user32::RedrawWindow(p $nyaDialog, p 0, p 0, i 0x0185)'
  FunctionEnd

  ; The name of a language code, for the pill to open on whatever language
  ; the browser is already set to. Anything unknown falls back to the system.
  Function nyaLangNameOf
    Exch $R9
    ${Switch} $R9
      ${Case} "ru"
        StrCpy $R9 "Русский"
        ${Break}
      ${Case} "en"
        StrCpy $R9 "English"
        ${Break}
      ${Case} "de"
        StrCpy $R9 "Deutsch"
        ${Break}
      ${Case} "fr"
        StrCpy $R9 "Français"
        ${Break}
      ${Case} "es"
        StrCpy $R9 "Español"
        ${Break}
      ${Case} "it"
        StrCpy $R9 "Italiano"
        ${Break}
      ${Case} "pt-BR"
        StrCpy $R9 "Português (Brasil)"
        ${Break}
      ${Case} "pt-PT"
        StrCpy $R9 "Português (Portugal)"
        ${Break}
      ${Case} "pl"
        StrCpy $R9 "Polski"
        ${Break}
      ${Case} "tr"
        StrCpy $R9 "Türkçe"
        ${Break}
      ${Case} "nl"
        StrCpy $R9 "Nederlands"
        ${Break}
      ${Case} "cs"
        StrCpy $R9 "Čeština"
        ${Break}
      ${Case} "sk"
        StrCpy $R9 "Slovenčina"
        ${Break}
      ${Case} "sl"
        StrCpy $R9 "Slovenščina"
        ${Break}
      ${Case} "hr"
        StrCpy $R9 "Hrvatski"
        ${Break}
      ${Case} "sr"
        StrCpy $R9 "Српски"
        ${Break}
      ${Case} "bg"
        StrCpy $R9 "Български"
        ${Break}
      ${Case} "ro"
        StrCpy $R9 "Română"
        ${Break}
      ${Case} "hu"
        StrCpy $R9 "Magyar"
        ${Break}
      ${Case} "el"
        StrCpy $R9 "Ελληνικά"
        ${Break}
      ${Case} "sv"
        StrCpy $R9 "Svenska"
        ${Break}
      ${Case} "no"
        StrCpy $R9 "Norsk"
        ${Break}
      ${Case} "da"
        StrCpy $R9 "Dansk"
        ${Break}
      ${Case} "fi"
        StrCpy $R9 "Suomi"
        ${Break}
      ${Case} "et"
        StrCpy $R9 "Eesti"
        ${Break}
      ${Case} "lv"
        StrCpy $R9 "Latviešu"
        ${Break}
      ${Case} "lt"
        StrCpy $R9 "Lietuvių"
        ${Break}
      ${Case} "be"
        StrCpy $R9 "Беларуская"
        ${Break}
      ${Case} "kk"
        StrCpy $R9 "Қазақша"
        ${Break}
      ${Case} "ky"
        StrCpy $R9 "Кыргызча"
        ${Break}
      ${Case} "uz"
        StrCpy $R9 "Oʻzbekcha"
        ${Break}
      ${Case} "az"
        StrCpy $R9 "Azərbaycanca"
        ${Break}
      ${Case} "ka"
        StrCpy $R9 "ქართული"
        ${Break}
      ${Case} "hy"
        StrCpy $R9 "Հայերեն"
        ${Break}
      ${Case} "he"
        StrCpy $R9 "עברית"
        ${Break}
      ${Case} "ar"
        StrCpy $R9 "العربية"
        ${Break}
      ${Case} "fa"
        StrCpy $R9 "فارسی"
        ${Break}
      ${Case} "hi"
        StrCpy $R9 "हिन्दी"
        ${Break}
      ${Case} "bn"
        StrCpy $R9 "বাংলা"
        ${Break}
      ${Case} "ur"
        StrCpy $R9 "اردو"
        ${Break}
      ${Case} "ta"
        StrCpy $R9 "தமிழ்"
        ${Break}
      ${Case} "te"
        StrCpy $R9 "తెలుగు"
        ${Break}
      ${Case} "mr"
        StrCpy $R9 "मराठी"
        ${Break}
      ${Case} "id"
        StrCpy $R9 "Bahasa Indonesia"
        ${Break}
      ${Case} "ms"
        StrCpy $R9 "Bahasa Melayu"
        ${Break}
      ${Case} "vi"
        StrCpy $R9 "Tiếng Việt"
        ${Break}
      ${Case} "th"
        StrCpy $R9 "ไทย"
        ${Break}
      ${Case} "fil"
        StrCpy $R9 "Filipino"
        ${Break}
      ${Case} "ja"
        StrCpy $R9 "日本語"
        ${Break}
      ${Case} "ko"
        StrCpy $R9 "한국어"
        ${Break}
      ${Case} "zh-CN"
        StrCpy $R9 "中文（简体）"
        ${Break}
      ${Case} "zh-TW"
        StrCpy $R9 "中文（繁體）"
        ${Break}
      ${Case} "sw"
        StrCpy $R9 "Kiswahili"
        ${Break}
      ${Case} "af"
        StrCpy $R9 "Afrikaans"
        ${Break}
      ${Case} "ca"
        StrCpy $R9 "Català"
        ${Break}
      ${Case} "gl"
        StrCpy $R9 "Galego"
        ${Break}
      ${Case} "sq"
        StrCpy $R9 "Shqip"
        ${Break}
      ${Case} "mk"
        StrCpy $R9 "Македонски"
        ${Break}
      ${Case} "bs"
        StrCpy $R9 "Bosanski"
        ${Break}
      ${Case} "is"
        StrCpy $R9 "Íslenska"
        ${Break}
      ${Case} "mn"
        StrCpy $R9 "Монгол"
        ${Break}
      ${Case} "ne"
        StrCpy $R9 "नेपाली"
        ${Break}
      ${Case} "si"
        StrCpy $R9 "සිංහල"
        ${Break}
      ${Case} "km"
        StrCpy $R9 "ខ្មែរ"
        ${Break}
      ${Case} "am"
        StrCpy $R9 "አማርኛ"
        ${Break}
      ${Default}
        Call nyaSystemLangName
        Pop $R9
        ${Break}
    ${EndSwitch}
    Exch $R9
  FunctionEnd

  ; What the pill says before anyone touches it: the language the system
  ; already speaks. Only an explicit pick writes anything to the registry.
  ;
  ; Windows hands over a full LCID. A handful of languages need the country
  ; half to choose a dictionary — Brazilian against European Portuguese,
  ; simplified against traditional Chinese, the three that share one primary
  ; id in the Balkans — so those are matched whole and everything else is
  ; matched on the primary language alone.
  Function nyaSystemLangName
    StrCpy $nyaSysCode "en"
    ${Switch} $LANGUAGE
      ${Case} 2070
        StrCpy $nyaSysCode "pt-PT"
        Push "Português (Portugal)"
        ${Break}
      ${Case} 1028
        StrCpy $nyaSysCode "zh-TW"
        Push "中文（繁體）"
        ${Break}
      ${Case} 3076
        StrCpy $nyaSysCode "zh-TW"
        Push "中文（繁體）"
        ${Break}
      ${Case} 5124
        StrCpy $nyaSysCode "zh-TW"
        Push "中文（繁體）"
        ${Break}
      ${Case} 1050
        StrCpy $nyaSysCode "hr"
        Push "Hrvatski"
        ${Break}
      ${Case} 5146
        StrCpy $nyaSysCode "bs"
        Push "Bosanski"
        ${Break}
      ${Case} 8218
        StrCpy $nyaSysCode "bs"
        Push "Bosanski"
        ${Break}
      ${Default}
        Call nyaPrimaryLangName
        ${Break}
    ${EndSwitch}
  FunctionEnd

  Function nyaPrimaryLangName
    IntOp $R8 $LANGUAGE & 1023
    ${Switch} $R8
      ${Case} 1
        StrCpy $nyaSysCode "ar"
        Push "العربية"
        ${Break}
      ${Case} 2
        StrCpy $nyaSysCode "bg"
        Push "Български"
        ${Break}
      ${Case} 3
        StrCpy $nyaSysCode "ca"
        Push "Català"
        ${Break}
      ${Case} 4
        StrCpy $nyaSysCode "zh-CN"
        Push "中文（简体）"
        ${Break}
      ${Case} 5
        StrCpy $nyaSysCode "cs"
        Push "Čeština"
        ${Break}
      ${Case} 6
        StrCpy $nyaSysCode "da"
        Push "Dansk"
        ${Break}
      ${Case} 7
        StrCpy $nyaSysCode "de"
        Push "Deutsch"
        ${Break}
      ${Case} 8
        StrCpy $nyaSysCode "el"
        Push "Ελληνικά"
        ${Break}
      ${Case} 9
        StrCpy $nyaSysCode "en"
        Push "English"
        ${Break}
      ${Case} 10
        StrCpy $nyaSysCode "es"
        Push "Español"
        ${Break}
      ${Case} 11
        StrCpy $nyaSysCode "fi"
        Push "Suomi"
        ${Break}
      ${Case} 12
        StrCpy $nyaSysCode "fr"
        Push "Français"
        ${Break}
      ${Case} 13
        StrCpy $nyaSysCode "he"
        Push "עברית"
        ${Break}
      ${Case} 14
        StrCpy $nyaSysCode "hu"
        Push "Magyar"
        ${Break}
      ${Case} 15
        StrCpy $nyaSysCode "is"
        Push "Íslenska"
        ${Break}
      ${Case} 16
        StrCpy $nyaSysCode "it"
        Push "Italiano"
        ${Break}
      ${Case} 17
        StrCpy $nyaSysCode "ja"
        Push "日本語"
        ${Break}
      ${Case} 18
        StrCpy $nyaSysCode "ko"
        Push "한국어"
        ${Break}
      ${Case} 19
        StrCpy $nyaSysCode "nl"
        Push "Nederlands"
        ${Break}
      ${Case} 20
        StrCpy $nyaSysCode "no"
        Push "Norsk"
        ${Break}
      ${Case} 21
        StrCpy $nyaSysCode "pl"
        Push "Polski"
        ${Break}
      ${Case} 22
        StrCpy $nyaSysCode "pt-BR"
        Push "Português (Brasil)"
        ${Break}
      ${Case} 24
        StrCpy $nyaSysCode "ro"
        Push "Română"
        ${Break}
      ${Case} 25
        StrCpy $nyaSysCode "ru"
        Push "Русский"
        ${Break}
      ${Case} 26
        StrCpy $nyaSysCode "sr"
        Push "Српски"
        ${Break}
      ${Case} 27
        StrCpy $nyaSysCode "sk"
        Push "Slovenčina"
        ${Break}
      ${Case} 28
        StrCpy $nyaSysCode "sq"
        Push "Shqip"
        ${Break}
      ${Case} 29
        StrCpy $nyaSysCode "sv"
        Push "Svenska"
        ${Break}
      ${Case} 30
        StrCpy $nyaSysCode "th"
        Push "ไทย"
        ${Break}
      ${Case} 31
        StrCpy $nyaSysCode "tr"
        Push "Türkçe"
        ${Break}
      ${Case} 32
        StrCpy $nyaSysCode "ur"
        Push "اردو"
        ${Break}
      ${Case} 33
        StrCpy $nyaSysCode "id"
        Push "Bahasa Indonesia"
        ${Break}
      ${Case} 35
        StrCpy $nyaSysCode "be"
        Push "Беларуская"
        ${Break}
      ${Case} 36
        StrCpy $nyaSysCode "sl"
        Push "Slovenščina"
        ${Break}
      ${Case} 37
        StrCpy $nyaSysCode "et"
        Push "Eesti"
        ${Break}
      ${Case} 38
        StrCpy $nyaSysCode "lv"
        Push "Latviešu"
        ${Break}
      ${Case} 39
        StrCpy $nyaSysCode "lt"
        Push "Lietuvių"
        ${Break}
      ${Case} 41
        StrCpy $nyaSysCode "fa"
        Push "فارسی"
        ${Break}
      ${Case} 42
        StrCpy $nyaSysCode "vi"
        Push "Tiếng Việt"
        ${Break}
      ${Case} 43
        StrCpy $nyaSysCode "hy"
        Push "Հայերեն"
        ${Break}
      ${Case} 44
        StrCpy $nyaSysCode "az"
        Push "Azərbaycanca"
        ${Break}
      ${Case} 47
        StrCpy $nyaSysCode "mk"
        Push "Македонски"
        ${Break}
      ${Case} 54
        StrCpy $nyaSysCode "af"
        Push "Afrikaans"
        ${Break}
      ${Case} 55
        StrCpy $nyaSysCode "ka"
        Push "ქართული"
        ${Break}
      ${Case} 57
        StrCpy $nyaSysCode "hi"
        Push "हिन्दी"
        ${Break}
      ${Case} 62
        StrCpy $nyaSysCode "ms"
        Push "Bahasa Melayu"
        ${Break}
      ${Case} 63
        StrCpy $nyaSysCode "kk"
        Push "Қазақша"
        ${Break}
      ${Case} 64
        StrCpy $nyaSysCode "ky"
        Push "Кыргызча"
        ${Break}
      ${Case} 65
        StrCpy $nyaSysCode "sw"
        Push "Kiswahili"
        ${Break}
      ${Case} 67
        StrCpy $nyaSysCode "uz"
        Push "Oʻzbekcha"
        ${Break}
      ${Case} 69
        StrCpy $nyaSysCode "bn"
        Push "বাংলা"
        ${Break}
      ${Case} 73
        StrCpy $nyaSysCode "ta"
        Push "தமிழ்"
        ${Break}
      ${Case} 74
        StrCpy $nyaSysCode "te"
        Push "తెలుగు"
        ${Break}
      ${Case} 78
        StrCpy $nyaSysCode "mr"
        Push "मराठी"
        ${Break}
      ${Case} 80
        StrCpy $nyaSysCode "mn"
        Push "Монгол"
        ${Break}
      ${Case} 83
        StrCpy $nyaSysCode "km"
        Push "ខ្មែរ"
        ${Break}
      ${Case} 86
        StrCpy $nyaSysCode "gl"
        Push "Galego"
        ${Break}
      ${Case} 91
        StrCpy $nyaSysCode "si"
        Push "සිංහල"
        ${Break}
      ${Case} 94
        StrCpy $nyaSysCode "am"
        Push "አማርኛ"
        ${Break}
      ${Case} 97
        StrCpy $nyaSysCode "ne"
        Push "नेपाली"
        ${Break}
      ${Case} 100
        StrCpy $nyaSysCode "fil"
        Push "Filipino"
        ${Break}
      ${Default}
        Push "English"
        ${Break}
    ${EndSwitch}
  FunctionEnd

  ; A native popup with the language list. TPM_RETURNCMD hands the picked id
  ; straight back instead of posting WM_COMMAND at a window we do not own.
  Function nyaLangClicked
    Pop $R9
    ${str} $R7 "welcome.systemLang"
    System::Call 'user32::CreatePopupMenu() p .R0'
    System::Call 'user32::AppendMenu(p R0, i 0, i 1, w "$R7")'
    System::Call 'user32::AppendMenu(p R0, i 0x800, i 0, w "")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 2, w "Русский")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 3, w "English")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 4, w "Deutsch")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 5, w "Français")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 6, w "Español")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 7, w "Italiano")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 8, w "Português (Brasil)")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 9, w "Português (Portugal)")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 10, w "Polski")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 11, w "Türkçe")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 12, w "Nederlands")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 13, w "Čeština")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 14, w "Slovenčina")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 15, w "Slovenščina")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 16, w "Hrvatski")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 17, w "Српски")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 18, w "Български")'
    System::Call 'user32::AppendMenu(p R0, i 0x20, i 19, w "Română")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 20, w "Magyar")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 21, w "Ελληνικά")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 22, w "Svenska")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 23, w "Norsk")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 24, w "Dansk")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 25, w "Suomi")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 26, w "Eesti")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 27, w "Latviešu")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 28, w "Lietuvių")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 29, w "Беларуская")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 30, w "Қазақша")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 31, w "Кыргызча")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 32, w "Oʻzbekcha")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 33, w "Azərbaycanca")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 34, w "ქართული")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 35, w "Հայերեն")'
    System::Call 'user32::AppendMenu(p R0, i 0x20, i 36, w "עברית")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 37, w "العربية")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 38, w "فارسی")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 39, w "हिन्दी")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 40, w "বাংলা")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 41, w "اردو")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 42, w "தமிழ்")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 43, w "తెలుగు")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 44, w "मराठी")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 45, w "Bahasa Indonesia")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 46, w "Bahasa Melayu")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 47, w "Tiếng Việt")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 48, w "ไทย")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 49, w "Filipino")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 50, w "日本語")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 51, w "한국어")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 52, w "中文（简体）")'
    System::Call 'user32::AppendMenu(p R0, i 0x20, i 53, w "中文（繁體）")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 54, w "Kiswahili")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 55, w "Afrikaans")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 56, w "Català")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 57, w "Galego")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 58, w "Shqip")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 59, w "Македонски")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 60, w "Bosanski")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 61, w "Íslenska")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 62, w "Монгол")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 63, w "नेपाली")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 64, w "සිංහල")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 65, w "ខ្មែរ")'
    System::Call 'user32::AppendMenu(p R0, i 0, i 66, w "አማርኛ")'

    System::Call '*(i 0, i 0) p .R1'
    System::Call 'user32::GetCursorPos(p R1)'
    System::Call '*$R1(i .R2, i .R3)'
    System::Free $R1
    System::Call 'user32::TrackPopupMenu(p R0, i 0x0180, i R2, i R3, i 0, p $HWNDPARENT, p 0) i .R4'
    System::Call 'user32::DestroyMenu(p R0)'

    ${If} $R4 = 0
      Return
    ${EndIf}
    ${Switch} $R4
      ${Case} 1
        StrCpy $nyaLang "system"
        Call nyaSystemLangName
        Pop $R5
        ${Break}
      ${Case} 2
        StrCpy $nyaLang "ru"
        StrCpy $R5 "Русский"
        ${Break}
      ${Case} 3
        StrCpy $nyaLang "en"
        StrCpy $R5 "English"
        ${Break}
      ${Case} 4
        StrCpy $nyaLang "de"
        StrCpy $R5 "Deutsch"
        ${Break}
      ${Case} 5
        StrCpy $nyaLang "fr"
        StrCpy $R5 "Français"
        ${Break}
      ${Case} 6
        StrCpy $nyaLang "es"
        StrCpy $R5 "Español"
        ${Break}
      ${Case} 7
        StrCpy $nyaLang "it"
        StrCpy $R5 "Italiano"
        ${Break}
      ${Case} 8
        StrCpy $nyaLang "pt-BR"
        StrCpy $R5 "Português (Brasil)"
        ${Break}
      ${Case} 9
        StrCpy $nyaLang "pt-PT"
        StrCpy $R5 "Português (Portugal)"
        ${Break}
      ${Case} 10
        StrCpy $nyaLang "pl"
        StrCpy $R5 "Polski"
        ${Break}
      ${Case} 11
        StrCpy $nyaLang "tr"
        StrCpy $R5 "Türkçe"
        ${Break}
      ${Case} 12
        StrCpy $nyaLang "nl"
        StrCpy $R5 "Nederlands"
        ${Break}
      ${Case} 13
        StrCpy $nyaLang "cs"
        StrCpy $R5 "Čeština"
        ${Break}
      ${Case} 14
        StrCpy $nyaLang "sk"
        StrCpy $R5 "Slovenčina"
        ${Break}
      ${Case} 15
        StrCpy $nyaLang "sl"
        StrCpy $R5 "Slovenščina"
        ${Break}
      ${Case} 16
        StrCpy $nyaLang "hr"
        StrCpy $R5 "Hrvatski"
        ${Break}
      ${Case} 17
        StrCpy $nyaLang "sr"
        StrCpy $R5 "Српски"
        ${Break}
      ${Case} 18
        StrCpy $nyaLang "bg"
        StrCpy $R5 "Български"
        ${Break}
      ${Case} 19
        StrCpy $nyaLang "ro"
        StrCpy $R5 "Română"
        ${Break}
      ${Case} 20
        StrCpy $nyaLang "hu"
        StrCpy $R5 "Magyar"
        ${Break}
      ${Case} 21
        StrCpy $nyaLang "el"
        StrCpy $R5 "Ελληνικά"
        ${Break}
      ${Case} 22
        StrCpy $nyaLang "sv"
        StrCpy $R5 "Svenska"
        ${Break}
      ${Case} 23
        StrCpy $nyaLang "no"
        StrCpy $R5 "Norsk"
        ${Break}
      ${Case} 24
        StrCpy $nyaLang "da"
        StrCpy $R5 "Dansk"
        ${Break}
      ${Case} 25
        StrCpy $nyaLang "fi"
        StrCpy $R5 "Suomi"
        ${Break}
      ${Case} 26
        StrCpy $nyaLang "et"
        StrCpy $R5 "Eesti"
        ${Break}
      ${Case} 27
        StrCpy $nyaLang "lv"
        StrCpy $R5 "Latviešu"
        ${Break}
      ${Case} 28
        StrCpy $nyaLang "lt"
        StrCpy $R5 "Lietuvių"
        ${Break}
      ${Case} 29
        StrCpy $nyaLang "be"
        StrCpy $R5 "Беларуская"
        ${Break}
      ${Case} 30
        StrCpy $nyaLang "kk"
        StrCpy $R5 "Қазақша"
        ${Break}
      ${Case} 31
        StrCpy $nyaLang "ky"
        StrCpy $R5 "Кыргызча"
        ${Break}
      ${Case} 32
        StrCpy $nyaLang "uz"
        StrCpy $R5 "Oʻzbekcha"
        ${Break}
      ${Case} 33
        StrCpy $nyaLang "az"
        StrCpy $R5 "Azərbaycanca"
        ${Break}
      ${Case} 34
        StrCpy $nyaLang "ka"
        StrCpy $R5 "ქართული"
        ${Break}
      ${Case} 35
        StrCpy $nyaLang "hy"
        StrCpy $R5 "Հայերեն"
        ${Break}
      ${Case} 36
        StrCpy $nyaLang "he"
        StrCpy $R5 "עברית"
        ${Break}
      ${Case} 37
        StrCpy $nyaLang "ar"
        StrCpy $R5 "العربية"
        ${Break}
      ${Case} 38
        StrCpy $nyaLang "fa"
        StrCpy $R5 "فارسی"
        ${Break}
      ${Case} 39
        StrCpy $nyaLang "hi"
        StrCpy $R5 "हिन्दी"
        ${Break}
      ${Case} 40
        StrCpy $nyaLang "bn"
        StrCpy $R5 "বাংলা"
        ${Break}
      ${Case} 41
        StrCpy $nyaLang "ur"
        StrCpy $R5 "اردو"
        ${Break}
      ${Case} 42
        StrCpy $nyaLang "ta"
        StrCpy $R5 "தமிழ்"
        ${Break}
      ${Case} 43
        StrCpy $nyaLang "te"
        StrCpy $R5 "తెలుగు"
        ${Break}
      ${Case} 44
        StrCpy $nyaLang "mr"
        StrCpy $R5 "मराठी"
        ${Break}
      ${Case} 45
        StrCpy $nyaLang "id"
        StrCpy $R5 "Bahasa Indonesia"
        ${Break}
      ${Case} 46
        StrCpy $nyaLang "ms"
        StrCpy $R5 "Bahasa Melayu"
        ${Break}
      ${Case} 47
        StrCpy $nyaLang "vi"
        StrCpy $R5 "Tiếng Việt"
        ${Break}
      ${Case} 48
        StrCpy $nyaLang "th"
        StrCpy $R5 "ไทย"
        ${Break}
      ${Case} 49
        StrCpy $nyaLang "fil"
        StrCpy $R5 "Filipino"
        ${Break}
      ${Case} 50
        StrCpy $nyaLang "ja"
        StrCpy $R5 "日本語"
        ${Break}
      ${Case} 51
        StrCpy $nyaLang "ko"
        StrCpy $R5 "한국어"
        ${Break}
      ${Case} 52
        StrCpy $nyaLang "zh-CN"
        StrCpy $R5 "中文（简体）"
        ${Break}
      ${Case} 53
        StrCpy $nyaLang "zh-TW"
        StrCpy $R5 "中文（繁體）"
        ${Break}
      ${Case} 54
        StrCpy $nyaLang "sw"
        StrCpy $R5 "Kiswahili"
        ${Break}
      ${Case} 55
        StrCpy $nyaLang "af"
        StrCpy $R5 "Afrikaans"
        ${Break}
      ${Case} 56
        StrCpy $nyaLang "ca"
        StrCpy $R5 "Català"
        ${Break}
      ${Case} 57
        StrCpy $nyaLang "gl"
        StrCpy $R5 "Galego"
        ${Break}
      ${Case} 58
        StrCpy $nyaLang "sq"
        StrCpy $R5 "Shqip"
        ${Break}
      ${Case} 59
        StrCpy $nyaLang "mk"
        StrCpy $R5 "Македонски"
        ${Break}
      ${Case} 60
        StrCpy $nyaLang "bs"
        StrCpy $R5 "Bosanski"
        ${Break}
      ${Case} 61
        StrCpy $nyaLang "is"
        StrCpy $R5 "Íslenska"
        ${Break}
      ${Case} 62
        StrCpy $nyaLang "mn"
        StrCpy $R5 "Монгол"
        ${Break}
      ${Case} 63
        StrCpy $nyaLang "ne"
        StrCpy $R5 "नेपाली"
        ${Break}
      ${Case} 64
        StrCpy $nyaLang "si"
        StrCpy $R5 "සිංහල"
        ${Break}
      ${Case} 65
        StrCpy $nyaLang "km"
        StrCpy $R5 "ខ្មែរ"
        ${Break}
      ${Case} 66
        StrCpy $nyaLang "am"
        StrCpy $R5 "አማርኛ"
        ${Break}
      ${Default}
        Return
    ${EndSwitch}
    Call nyaLangFit
    Call nyaApplyStrings
  FunctionEnd

  ; Sizes the pill to the name in $R5 and puts the name in it.
  ;
  ; The pill is artwork and cannot stretch, so it is baked at a ladder of
  ; widths and the narrowest one that holds the name is blitted over the
  ; corner of the window. That blit also erases the pill before it — which
  ; matters, because the label is transparent and would otherwise leave the
  ; old name showing through the new one.
  Function nyaLangFit
    ShowWindow $nyaLangLabel ${SW_HIDE}

    ; How wide the name is in the pill's own font.
    StrLen $R6 $R5
    System::Call 'user32::GetDC(p $nyaLangLabel) p .r0'
    System::Call 'gdi32::SelectObject(p r0, p $nyaFontSmall) p .r1'
    System::Call '*(i 0, i 0) p .r2'
    System::Call 'gdi32::GetTextExtentPoint32W(p r0, w "$R5", i $R6, p r2)'
    System::Call '*$2(i .r3, i)'
    System::Call 'gdi32::SelectObject(p r0, p r1)'
    System::Call 'user32::ReleaseDC(p $nyaLangLabel, p r0)'
    System::Free $2
    StrCpy $R6 $3

    StrCpy $R7 ""
    !insertmacro NyaPillPick 30
    !insertmacro NyaPillPick 40
    !insertmacro NyaPillPick 50
    !insertmacro NyaPillPick 60
    !insertmacro NyaPillPick 70
    !insertmacro NyaPillPick 80
    !insertmacro NyaPillPick 90
    !insertmacro NyaPillPick 100
    !insertmacro NyaPillPick 110
    !insertmacro NyaPillPick 120
    !insertmacro NyaPillPick 130
    !insertmacro NyaPillPick 140
    ${If} $R7 == ""
      StrCpy $R7 140
    ${EndIf}

    ; STM_SETIMAGE hands back the bitmap it replaced, and nobody else will
    ; free it: at ~85 KB a rung, clicking through the list would add up.
    SendMessage $nyaLangStrip ${STM_GETIMAGE} 0 0 $R4
    ${px} $R2 ${ART_WELCOME_LANG_STRIP_W}
    ${px} $R3 ${ART_WELCOME_LANG_STRIP_H}
    ${Switch} $R7
      ${Case} 30
        ${scaledImage} $nyaLangStrip "welcome-lang-30.bmp" $R2 $R3
        ${Break}
      ${Case} 40
        ${scaledImage} $nyaLangStrip "welcome-lang-40.bmp" $R2 $R3
        ${Break}
      ${Case} 50
        ${scaledImage} $nyaLangStrip "welcome-lang-50.bmp" $R2 $R3
        ${Break}
      ${Case} 60
        ${scaledImage} $nyaLangStrip "welcome-lang-60.bmp" $R2 $R3
        ${Break}
      ${Case} 70
        ${scaledImage} $nyaLangStrip "welcome-lang-70.bmp" $R2 $R3
        ${Break}
      ${Case} 80
        ${scaledImage} $nyaLangStrip "welcome-lang-80.bmp" $R2 $R3
        ${Break}
      ${Case} 90
        ${scaledImage} $nyaLangStrip "welcome-lang-90.bmp" $R2 $R3
        ${Break}
      ${Case} 100
        ${scaledImage} $nyaLangStrip "welcome-lang-100.bmp" $R2 $R3
        ${Break}
      ${Case} 110
        ${scaledImage} $nyaLangStrip "welcome-lang-110.bmp" $R2 $R3
        ${Break}
      ${Case} 120
        ${scaledImage} $nyaLangStrip "welcome-lang-120.bmp" $R2 $R3
        ${Break}
      ${Case} 130
        ${scaledImage} $nyaLangStrip "welcome-lang-130.bmp" $R2 $R3
        ${Break}
      ${Case} 140
        ${scaledImage} $nyaLangStrip "welcome-lang-140.bmp" $R2 $R3
        ${Break}
    ${EndSwitch}
    ${If} $R4 <> 0
      System::Call 'gdi32::DeleteObject(p $R4)'
    ${EndIf}

    ; The label gets exactly the room the artwork left it, and the click zone
    ; grows by the same amount: the chrome around the label is whatever the
    ; design measured, so the three can never drift apart.
    ${px} $0 ${ART_WELCOME_LANG_X}
    ${px} $1 ${ART_WELCOME_LANG_Y}
    ${px} $2 $R7
    ${px} $3 ${ART_WELCOME_LANG_H}
    System::Call 'user32::MoveWindow(p $nyaLangLabel, i $0, i $1, i $2, i $3, i 1)'
    SendMessage $nyaLangLabel ${WM_SETTEXT} 0 "STR:$R5"

    IntOp $R8 ${ART_WELCOME_LANG_HIT_W} - ${ART_WELCOME_LANG_W}
    IntOp $R8 $R8 + $R7
    ${px} $0 ${ART_WELCOME_LANG_HIT_X}
    ${px} $1 ${ART_WELCOME_LANG_HIT_Y}
    ${px} $2 $R8
    ${px} $3 ${ART_WELCOME_LANG_HIT_H}
    System::Call 'user32::MoveWindow(p $nyaLangHit, i $0, i $1, i $2, i $3, i 1)'

    ShowWindow $nyaLangLabel ${SW_SHOW}
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

    Call nyaLangIniPath

    ${If} ${isUpdated}
      !insertmacro NyaProgressBody "updating.bmp" ART_UPDATING_PROGRESS

      ${text} $R6 $R8 ${NYA_TXT_C} 0 ${ART_UPDATING_TITLE_Y} 640         ${ART_UPDATING_TITLE_H} $nyaFontH20 ${NYA_TEXT}
      ${setstr} $R6 "updating.title"
      ${text} $R6 $R8 ${NYA_TXT_L} ${ART_UPDATING_SUBTITLE_X}         ${ART_UPDATING_SUBTITLE_Y} 260 ${ART_UPDATING_SUBTITLE_H}         $nyaFontSmall ${NYA_FAINT}
      ${setstr} $R6 "updating.subtitle"
      ${text} $R6 $R8 ${NYA_TXT_L} ${ART_UPDATING_HINT_X} ${ART_UPDATING_HINT_Y}         540 ${ART_UPDATING_HINT_H} $nyaFontPath ${NYA_DIM}
      ${setstr} $R6 "updating.hint"

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

      ${text} $R6 $R8 ${NYA_TXT_C} 0 ${ART_INSTALLING_TITLE_Y} 640         ${ART_INSTALLING_TITLE_H} $nyaFontH20 ${NYA_TEXT}
      ${setstr} $R6 "installing.title"
      ${text} $R6 $R8 ${NYA_TXT_C} 0 ${ART_INSTALLING_SUBTITLE_Y} 640         ${ART_INSTALLING_SUBTITLE_H} $nyaFontPath ${NYA_DIM}
      ${setstr} $R6 "installing.subtitle"
      ${text} $R6 $R8 ${NYA_TXT_L} ${ART_INSTALLING_HINT_X}         ${ART_INSTALLING_HINT_Y} 570 ${ART_INSTALLING_HINT_H}         $nyaFontPath ${NYA_DIM}
      ${setstr} $R6 "installing.hint"
    ${EndIf}
  FunctionEnd

  ; ---------------------------------------------------------------- finish
  Function nyaFinishCreate
    Call nyaInitChrome
    ${page} "installed.bmp"
    Call nyaLangIniPath

    ${text} $R6 $nyaDialog ${NYA_TXT_C} 0 ${ART_INSTALLED_TITLE_Y} 640       ${ART_INSTALLED_TITLE_H} $nyaFontH24 ${NYA_TEXT}
    ${setstr} $R6 "installed.title"
    ${text} $R6 $nyaDialog ${NYA_TXT_C} 0 ${ART_INSTALLED_SUBTITLE_Y} 640       ${ART_INSTALLED_SUBTITLE_H} $nyaFontBody ${NYA_DIM}
    ${setstr} $R6 "installed.subtitle"
    ${text} $R6 $nyaDialog ${NYA_TXT_CV} ${ART_INSTALLED_LAUNCH_X}       ${ART_INSTALLED_LAUNCH_Y} ${ART_INSTALLED_LAUNCH_W}       ${ART_INSTALLED_LAUNCH_H} $nyaFontBtn ${NYA_WHITE}
    ${setstr} $R6 "installed.launch"
    ${text} $R6 $nyaDialog ${NYA_TXT_L} ${ART_INSTALLED_HINT_X}       ${ART_INSTALLED_HINT_Y} 500 ${ART_INSTALLED_HINT_H} $nyaFontPath ${NYA_DIM}
    ${setstr} $R6 "installed.hint"

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
    StrCpy $nyaLangIni "$PLUGINSDIR\lang.ini"
    ${IfNot} ${FileExists} "$nyaLangIni"
      StrCpy $nyaLangIni "$PLUGINSDIR\lang-en.ini"
    ${EndIf}
  FunctionEnd

  ; --------------------------------------------------------------- confirm
  Function un.nyaConfirmCreate
    Call un.nyaInitChrome
    ${page} "un-confirm.bmp"

    ${text} $R6 $nyaDialog ${NYA_TXT_C} 0 ${ART_UN_CONFIRM_TITLE_Y} 640 \
      ${ART_UN_CONFIRM_TITLE_H} $nyaFontH26 ${NYA_TEXT}
    ${setstr} $R6 "unconfirm.title"
    ${text} $R6 $nyaDialog ${NYA_TXT_C} 0 ${ART_UN_CONFIRM_SUBTITLE_Y} 640 \
      ${ART_UN_CONFIRM_SUBTITLE_H} $nyaFontBody ${NYA_DIM}
    ${setstr} $R6 "unconfirm.subtitle"
    ${text} $R6 $nyaDialog ${NYA_TXT_CV} ${ART_UN_CONFIRM_REMOVE_X} \
      ${ART_UN_CONFIRM_REMOVE_Y} ${ART_UN_CONFIRM_REMOVE_W} \
      ${ART_UN_CONFIRM_REMOVE_H} $nyaFontBtn ${NYA_WHITE}
    ${setstr} $R6 "unconfirm.remove"
    ${text} $R6 $nyaDialog ${NYA_TXT_CV} ${ART_UN_CONFIRM_CANCEL_X} \
      ${ART_UN_CONFIRM_CANCEL_Y} ${ART_UN_CONFIRM_CANCEL_W} \
      ${ART_UN_CONFIRM_CANCEL_H} $nyaFontBtn ${NYA_TEXT}
    ${setstr} $R6 "unconfirm.cancel"
    ${text} $R6 $nyaDialog ${NYA_TXT_LV} ${ART_UN_CONFIRM_LABEL_WIPE_X} \
      ${ART_UN_CONFIRM_LABEL_WIPE_Y} 500 ${ART_UN_CONFIRM_LABEL_WIPE_H} \
      $nyaFontPath ${NYA_DIM}
    ${setstr} $R6 "unconfirm.wipe"
    ${text} $R6 $nyaDialog ${NYA_TXT_L} ${ART_UN_CONFIRM_VERSION_LINE_X} \
      ${ART_UN_CONFIRM_VERSION_LINE_Y} 240 ${ART_UN_CONFIRM_VERSION_LINE_H} \
      $nyaFontSmall ${NYA_FAINT}
    ${str} $R7 "unconfirm.version"
    ${un.WordReplace} "$R7" "{v}" "${VERSION}" "+" $R7
    SendMessage $R6 ${WM_SETTEXT} 0 "STR:$R7"

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

    ${text} $R6 $nyaUnShroud ${NYA_TXT_C} 0 ${ART_UN_PROGRESS_TITLE_Y} 640 \
      ${ART_UN_PROGRESS_TITLE_H} $nyaFontH20 ${NYA_TEXT}
    ${setstr} $R6 "unprogress.title"
    ${text} $R6 $nyaUnShroud ${NYA_TXT_C} 0 ${ART_UN_PROGRESS_SUBTITLE_Y} 640 \
      ${ART_UN_PROGRESS_SUBTITLE_H} $nyaFontPath ${NYA_DIM}
    ${setstr} $R6 "unprogress.subtitle"
    ${text} $R6 $nyaUnShroud ${NYA_TXT_L} ${ART_UN_PROGRESS_HINT_X} \
      ${ART_UN_PROGRESS_HINT_Y} 560 ${ART_UN_PROGRESS_HINT_H} \
      $nyaFontPath ${NYA_DIM}
    ${setstr} $R6 "unprogress.hint"

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

    ${text} $R6 $nyaDialog ${NYA_TXT_C} 0 ${ART_UN_DONE_TITLE_Y} 640 \
      ${ART_UN_DONE_TITLE_H} $nyaFontH22 ${NYA_TEXT}
    ${setstr} $R6 "undone.title"
    ${text} $R6 $nyaDialog ${NYA_TXT_C} 0 ${ART_UN_DONE_SUBTITLE_Y} 640 \
      ${ART_UN_DONE_SUBTITLE_H} $nyaFontBody ${NYA_DIM}
    ${setstr} $R6 "undone.subtitle"
    ${text} $R6 $nyaDialog ${NYA_TXT_CV} ${ART_UN_DONE_CLOSE_X} \
      ${ART_UN_DONE_CLOSE_Y} ${ART_UN_DONE_CLOSE_W} ${ART_UN_DONE_CLOSE_H} \
      $nyaFontBtn ${NYA_TEXT}
    ${setstr} $R6 "undone.close"
    ${text} $R6 $nyaDialog ${NYA_TXT_L} ${ART_UN_DONE_HINT_X} \
      ${ART_UN_DONE_HINT_Y} 500 ${ART_UN_DONE_HINT_H} $nyaFontPath ${NYA_DIM}
    ${setstr} $R6 "undone.hint"

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
  CopyFiles /SILENT "$INSTDIR\lang.ini" "$PLUGINSDIR"
  StrCpy $nyaArt "$PLUGINSDIR"
!macroend

!macro customInit
  ; The design's progress page has no "Next" button, and NSIS waits for one
  ; before moving on. This is the switch MUI's own finish page flips: with it
  ; the wizard advances by itself once the section is done.
  SetAutoClose true

  InitPluginsDir
  ; One string file per language: the pill switches between them live.
  !insertmacro NyaLangFiles

  File "/oname=$PLUGINSDIR\welcome.bmp" "${BUILD_RESOURCES_DIR}\art\welcome.bmp"
  File "/oname=$PLUGINSDIR\installing.bmp" "${BUILD_RESOURCES_DIR}\art\installing.bmp"
  File "/oname=$PLUGINSDIR\updating.bmp" "${BUILD_RESOURCES_DIR}\art\updating.bmp"
  File "/oname=$PLUGINSDIR\installed.bmp" "${BUILD_RESOURCES_DIR}\art\installed.bmp"
  File "/oname=$PLUGINSDIR\welcome-box-desktop-on.bmp" "${BUILD_RESOURCES_DIR}\art\welcome-box-desktop-on.bmp"
  File "/oname=$PLUGINSDIR\welcome-box-desktop-off.bmp" "${BUILD_RESOURCES_DIR}\art\welcome-box-desktop-off.bmp"
  File "/oname=$PLUGINSDIR\welcome-box-default-on.bmp" "${BUILD_RESOURCES_DIR}\art\welcome-box-default-on.bmp"
  File "/oname=$PLUGINSDIR\welcome-box-default-off.bmp" "${BUILD_RESOURCES_DIR}\art\welcome-box-default-off.bmp"

  ; One strip per pill width; nyaLangFit blits whichever fits the name.
  File "/oname=$PLUGINSDIR\welcome-lang-30.bmp" "${BUILD_RESOURCES_DIR}\art\welcome-lang-30.bmp"
  File "/oname=$PLUGINSDIR\welcome-lang-40.bmp" "${BUILD_RESOURCES_DIR}\art\welcome-lang-40.bmp"
  File "/oname=$PLUGINSDIR\welcome-lang-50.bmp" "${BUILD_RESOURCES_DIR}\art\welcome-lang-50.bmp"
  File "/oname=$PLUGINSDIR\welcome-lang-60.bmp" "${BUILD_RESOURCES_DIR}\art\welcome-lang-60.bmp"
  File "/oname=$PLUGINSDIR\welcome-lang-70.bmp" "${BUILD_RESOURCES_DIR}\art\welcome-lang-70.bmp"
  File "/oname=$PLUGINSDIR\welcome-lang-80.bmp" "${BUILD_RESOURCES_DIR}\art\welcome-lang-80.bmp"
  File "/oname=$PLUGINSDIR\welcome-lang-90.bmp" "${BUILD_RESOURCES_DIR}\art\welcome-lang-90.bmp"
  File "/oname=$PLUGINSDIR\welcome-lang-100.bmp" "${BUILD_RESOURCES_DIR}\art\welcome-lang-100.bmp"
  File "/oname=$PLUGINSDIR\welcome-lang-110.bmp" "${BUILD_RESOURCES_DIR}\art\welcome-lang-110.bmp"
  File "/oname=$PLUGINSDIR\welcome-lang-120.bmp" "${BUILD_RESOURCES_DIR}\art\welcome-lang-120.bmp"
  File "/oname=$PLUGINSDIR\welcome-lang-130.bmp" "${BUILD_RESOURCES_DIR}\art\welcome-lang-130.bmp"
  File "/oname=$PLUGINSDIR\welcome-lang-140.bmp" "${BUILD_RESOURCES_DIR}\art\welcome-lang-140.bmp"

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

  ; The uninstaller speaks whatever language was chosen here, so the strings
  ; for it travel with the application rather than all sixty-five.
  Call nyaLangIniPath
  CopyFiles /SILENT "$nyaLangIni" "$INSTDIR\lang.ini"

  ; The two checkboxes. Both are empty in a silent or updating run, where the
  ; welcome page never appeared and the existing choices must stand.
  ${If} $nyaDesktop == "0"
    Delete "$newDesktopLink"
  ${EndIf}

  ${If} $nyaDefault == "1"
    WriteRegStr HKCU "Software\Nya Browser" "SetDefaultOnFirstRun" "1"
  ${EndIf}

  ; The language pill. Only an explicit pick lands here; "язык системы" writes
  ; nothing and leaves the browser to resolve the system locale itself.
  ${If} $nyaLang != ""
    WriteRegStr HKCU "Software\Nya Browser" "language" "$nyaLang"
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
