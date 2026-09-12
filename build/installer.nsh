; =============================================================================
; build/installer.nsh — the FinCraftly installer UI (electron-builder NSIS include)
; -----------------------------------------------------------------------------
; electron-builder prepends this file to its NSIS script, so the defines and
; macros below shape every page. The installer draws its THREE screens itself:
;
;   Welcome     — brand art + "Install FinCraftly"          (nsDialogs page)
;   Installing  — brand art + a brand-blue progress bar     (MUI instfiles, restyled)
;   Done        — brand art + "Launch FinCraftly" / "Close" (nsDialogs page)
;
; Every screen is a full-window bitmap rendered by build/installer-art.py
; (Geist, brand colours) with bitmap buttons on top, and every piece of stock
; Windows dialog furniture — header, Back/Next/Cancel, branding line,
; hairlines — is hidden. The window keeps only the OS title bar, in dark.
;
; Install policy: per-user (no admin prompt), no folder picker, no
; "for me / everyone" question, shortcuts on the desktop and Start menu.
; What gets installed stays in electron-builder.yml.
; =============================================================================

!include "WinMessages.nsh"
!include "LogicLib.nsh"
!include "nsDialogs.nsh"

; ── Palette ──────────────────────────────────────────────────────────────────
!define FC_BG    "121417"
!define FC_TEXT  "F7F6F3"
!define FC_MUTED "9AA2AE"
; COLORREFs (0x00BBGGRR) for the progress bar
!define FC_BAR_COLOR   0x00F3844E   ; #4E84F3
!define FC_TRACK_COLOR 0x0038302A   ; #2A3038

; The art is drawn for the dialog's client area at 96 dpi.
!define FC_W 497
!define FC_H 334

; Progress bar rectangle on the Installing screen (matches installing.bmp).
!define FC_BAR_X 118
!define FC_BAR_Y 236
!define FC_BAR_W 260
!define FC_BAR_H 6

!define MUI_BGCOLOR   ${FC_BG}
!define MUI_TEXTCOLOR ${FC_TEXT}
!define MUI_HEADER_TRANSPARENT_TEXT
!define MUI_INSTFILESPAGE_COLORS "${FC_TEXT} ${FC_BG}"
!define MUI_INSTFILESPAGE_PROGRESSBAR "smooth"
InstallColors ${FC_TEXT} ${FC_BG}

; Uninstaller copy (the uninstaller keeps MUI's pages, in the dark theme).
!define MUI_UNCONFIRMPAGE_TEXT_TOP "This removes FinCraftly from this PC. Your workspace and data stay on the platform."

; ── Hooks into the electron-builder script ───────────────────────────────────
!ifdef BUILD_UNINSTALLER
  !define MUI_CUSTOMFUNCTION_UNGUIINIT un.fcGuiInit
!else
  !define MUI_CUSTOMFUNCTION_GUIINIT fcGuiInit
!endif

; Per-user install, always — skips the "for me / for everyone" page and the
; elevation prompt that comes with a machine-wide install.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; The screens' bitmaps travel inside the installer and are unpacked on start.
!macro customInit
  InitPluginsDir
  File /oname=$PLUGINSDIR\fc-welcome.bmp     "${BUILD_RESOURCES_DIR}\art\welcome.bmp"
  File /oname=$PLUGINSDIR\fc-installing.bmp  "${BUILD_RESOURCES_DIR}\art\installing.bmp"
  File /oname=$PLUGINSDIR\fc-done.bmp        "${BUILD_RESOURCES_DIR}\art\done.bmp"
  File /oname=$PLUGINSDIR\fc-btn-install.bmp "${BUILD_RESOURCES_DIR}\art\btn-install.bmp"
  File /oname=$PLUGINSDIR\fc-btn-launch.bmp  "${BUILD_RESOURCES_DIR}\art\btn-launch.bmp"
  File /oname=$PLUGINSDIR\fc-btn-close.bmp   "${BUILD_RESOURCES_DIR}\art\btn-close.bmp"
!macroend

; Welcome: our own page instead of MUI's.
!macro customWelcomePage
  Page custom fcWelcomeCreate
!macroend

; electron-builder inserts this immediately before MUI_PAGE_INSTFILES, so a
; SHOW define here lands on the Installing page (the install-mode page that
; precedes it consumes any SHOW define set earlier).
!macro customPageAfterChangeDir
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW fcInstFilesShow
!macroend

; The Installing page only moves on by itself when MUI knows a finish page
; follows; ours is a custom page, so say it explicitly at the end of the
; install section — with Next hidden there is nothing else to click.
!macro customInstall
  SetAutoClose true
!macroend

; Done: our own page instead of MUI's finish page. StartApp lives here (not at
; top level) because it calls the StdUtils plugin, which electron-builder only
; registers after this file has been included.
!macro customFinishPage
  Function StartApp
    ${if} ${isUpdated}
      StrCpy $1 "--updated"
    ${else}
      StrCpy $1 ""
    ${endif}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd

  Function fcLaunchAndClose
    Call StartApp
    Call fcNextPage
  FunctionEnd

  Page custom fcDoneCreate
!macroend

!macro customUnWelcomePage
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW un.fcHideLines
  !insertmacro MUI_UNPAGE_WELCOME
!macroend

; ── Shared: hide the stock dialog furniture, paint the frame dark ────────────
; Control ids on the outer dialog: 1 Next, 2 Cancel, 3 Back, 1028/1256
; branding, 1034 header background, 1037/1038 header texts, 1039 header image,
; 1035 standard hairline, 1045 full-window hairline.
!macro FC_HIDE_CHROME
  GetDlgItem $R9 $HWNDPARENT 1
  ShowWindow $R9 ${SW_HIDE}
  GetDlgItem $R9 $HWNDPARENT 2
  ShowWindow $R9 ${SW_HIDE}
  GetDlgItem $R9 $HWNDPARENT 3
  ShowWindow $R9 ${SW_HIDE}
  GetDlgItem $R9 $HWNDPARENT 1028
  ShowWindow $R9 ${SW_HIDE}
  GetDlgItem $R9 $HWNDPARENT 1256
  ShowWindow $R9 ${SW_HIDE}
  GetDlgItem $R9 $HWNDPARENT 1034
  ShowWindow $R9 ${SW_HIDE}
  GetDlgItem $R9 $HWNDPARENT 1037
  ShowWindow $R9 ${SW_HIDE}
  GetDlgItem $R9 $HWNDPARENT 1038
  ShowWindow $R9 ${SW_HIDE}
  GetDlgItem $R9 $HWNDPARENT 1039
  ShowWindow $R9 ${SW_HIDE}
  GetDlgItem $R9 $HWNDPARENT 1035
  ShowWindow $R9 ${SW_HIDE}
  GetDlgItem $R9 $HWNDPARENT 1045
  ShowWindow $R9 ${SW_HIDE}
!macroend

!macro FC_THEME_PARENT
  ; Windows 10 20H1+ / 11: dark title bar. Harmless elsewhere.
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 20, *i 1, i 4)'
  SetCtlColors $HWNDPARENT ${FC_TEXT} ${FC_BG}
!macroend

; Stretches a window (a page dialog) over the whole client area of the frame,
; covering the header and the button strip. $R0 = hwnd.
!macro FC_FULL_WINDOW
  System::Call '*(i, i, i, i) p .R1'
  System::Call 'user32::GetClientRect(p $HWNDPARENT, p R1)'
  System::Call '*$R1(i, i, i .R2, i .R3)'
  System::Free $R1
  System::Call 'user32::SetWindowPos(p $R0, p 0, i 0, i 0, i R2, i R3, i 0x14)'
!macroend

; Loads a BMP from $PLUGINSDIR into a static control. $1 = hwnd, $2 = file. Returns the HBITMAP in $3.
!macro FC_SET_BITMAP
  System::Call 'user32::LoadImageW(p 0, w r2, i 0, i 0, i 0, i 0x10) p .r3'
  SendMessage $1 ${STM_SETIMAGE} ${IMAGE_BITMAP} $3
!macroend

; ═════════════════════════════════════════════════════════════════════════════
; INSTALLER
; ═════════════════════════════════════════════════════════════════════════════
!ifndef BUILD_UNINSTALLER

Var fcDialog
Var fcBackground
Var fcButton
Var fcButton2
Var fcImage1
Var fcImage2
Var fcImage3

Function fcGuiInit
  !insertmacro FC_THEME_PARENT
  !insertmacro FC_HIDE_CHROME
FunctionEnd

; Creates a full-window nsDialogs page with a background bitmap. Leaves the
; dialog in $fcDialog and the background's HBITMAP in $fcImage1.
; $R5 = background bitmap path.
Function fcBeginScreen
  nsDialogs::Create 1018
  Pop $fcDialog
  ${If} $fcDialog == error
    Abort
  ${EndIf}
  !insertmacro FC_HIDE_CHROME
  StrCpy $R0 $fcDialog
  !insertmacro FC_FULL_WINDOW
  SetCtlColors $fcDialog "" ${FC_BG}

  ${NSD_CreateBitmap} 0 0 ${FC_W} ${FC_H} ""
  Pop $1
  StrCpy $fcBackground $1
  StrCpy $2 $R5
  !insertmacro FC_SET_BITMAP
  StrCpy $fcImage1 $3
FunctionEnd

; Call after the buttons are created: the background goes to the bottom of the
; z-order so the controls created after it paint on top, whatever the order.
Function fcEndScreen
  System::Call 'user32::SetWindowPos(p $fcBackground, p 1, i 0, i 0, i 0, i 0, i 0x13)'
  nsDialogs::Show
FunctionEnd

; A clickable bitmap "button". $0 = bitmap path, $1..$4 = x y w h. Returns hwnd in $5, HBITMAP in $3.
Function fcCreateButton
  ${NSD_CreateBitmap} $1 $2 $3 $4 ""
  Pop $5
  ${NSD_AddStyle} $5 ${SS_NOTIFY}
  StrCpy $2 $0
  StrCpy $1 $5
  !insertmacro FC_SET_BITMAP
  ; hand cursor
  System::Call 'user32::LoadCursorW(p 0, i 32649) p .r6'
  System::Call 'user32::SetClassLongPtrW(p r5, i -12, p r6)'
FunctionEnd

Function fcNextPage
  ; Same as pressing the (hidden) Next button.
  SendMessage $HWNDPARENT ${WM_COMMAND} 1 0
FunctionEnd

; ── Welcome ──────────────────────────────────────────────────────────────────
Function fcWelcomeCreate
  StrCpy $R5 "$PLUGINSDIR\fc-welcome.bmp"
  Call fcBeginScreen

  StrCpy $0 "$PLUGINSDIR\fc-btn-install.bmp"
  StrCpy $1 164
  StrCpy $2 246
  StrCpy $3 168
  StrCpy $4 34
  Call fcCreateButton
  StrCpy $fcButton $5
  StrCpy $fcImage2 $3
  ${NSD_OnClick} $fcButton fcNextPage

  Call fcEndScreen
  ${NSD_FreeImage} $fcImage1
  ${NSD_FreeImage} $fcImage2
FunctionEnd

; ── Installing (MUI's instfiles page, restyled in place) ─────────────────────
Function fcInstFilesShow
  !insertmacro FC_HIDE_CHROME

  ; The page dialog: full window, dark.
  FindWindow $R0 "#32770" "" $HWNDPARENT
  !insertmacro FC_FULL_WINDOW
  SetCtlColors $R0 ${FC_TEXT} ${FC_BG}

  ; Status line, details toggle and log list: gone. The art says it all.
  GetDlgItem $1 $R0 1006
  ShowWindow $1 ${SW_HIDE}
  GetDlgItem $1 $R0 1027
  ShowWindow $1 ${SW_HIDE}
  GetDlgItem $1 $R0 1016
  ShowWindow $1 ${SW_HIDE}

  ; Progress bar: classic rendering so it takes our colours, placed on the art.
  GetDlgItem $1 $R0 1004
  System::Call 'uxtheme::SetWindowTheme(p r1, w " ", w " ")'
  SendMessage $1 ${PBM_SETBARCOLOR} 0 ${FC_BAR_COLOR}
  SendMessage $1 ${PBM_SETBKCOLOR} 0 ${FC_TRACK_COLOR}
  System::Call 'user32::SetWindowPos(p r1, p 0, i ${FC_BAR_X}, i ${FC_BAR_Y}, i ${FC_BAR_W}, i ${FC_BAR_H}, i 0x14)'
  StrCpy $R4 $1

  ; Background art, behind everything else on the page.
  System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w "", i 0x5400000E, i 0, i 0, i ${FC_W}, i ${FC_H}, p R0, p 0, p 0, p 0) p .r1'
  StrCpy $2 "$PLUGINSDIR\fc-installing.bmp"
  !insertmacro FC_SET_BITMAP
  StrCpy $fcImage3 $3
  System::Call 'user32::SetWindowPos(p r1, p 1, i 0, i 0, i 0, i 0, i 0x13)'
  ; …and the bar back on top of it, repainted.
  System::Call 'user32::SetWindowPos(p $R4, p 0, i 0, i 0, i 0, i 0, i 0x53)'
  System::Call 'user32::InvalidateRect(p $R4, p 0, i 1)'
FunctionEnd

; ── Done ─────────────────────────────────────────────────────────────────────
Function fcDoneCreate
  StrCpy $R5 "$PLUGINSDIR\fc-done.bmp"
  Call fcBeginScreen

  StrCpy $0 "$PLUGINSDIR\fc-btn-launch.bmp"
  StrCpy $1 164
  StrCpy $2 232
  StrCpy $3 168
  StrCpy $4 34
  Call fcCreateButton
  StrCpy $fcButton $5
  StrCpy $fcImage2 $3
  ${NSD_OnClick} $fcButton fcLaunchAndClose

  StrCpy $0 "$PLUGINSDIR\fc-btn-close.bmp"
  StrCpy $1 200
  StrCpy $2 276
  StrCpy $3 96
  StrCpy $4 32
  Call fcCreateButton
  StrCpy $fcButton2 $5
  StrCpy $fcImage3 $3
  ${NSD_OnClick} $fcButton2 fcNextPage

  Call fcEndScreen
  ${NSD_FreeImage} $fcImage1
  ${NSD_FreeImage} $fcImage2
  ${NSD_FreeImage} $fcImage3
FunctionEnd

!endif

; ═════════════════════════════════════════════════════════════════════════════
; UNINSTALLER — MUI pages in the dark theme, no hairlines.
; ═════════════════════════════════════════════════════════════════════════════
!ifdef BUILD_UNINSTALLER

Function un.fcGuiInit
  !insertmacro FC_THEME_PARENT
  GetDlgItem $0 $HWNDPARENT 1028
  SetCtlColors $0 ${FC_MUTED} ${FC_BG}
  GetDlgItem $0 $HWNDPARENT 1256
  SetCtlColors $0 ${FC_MUTED} ${FC_BG}
  GetDlgItem $0 $HWNDPARENT 1035
  ShowWindow $0 ${SW_HIDE}
FunctionEnd

Function un.fcHideLines
  GetDlgItem $0 $HWNDPARENT 1045
  ShowWindow $0 ${SW_HIDE}
FunctionEnd

!endif
