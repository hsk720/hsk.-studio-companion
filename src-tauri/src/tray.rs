//! The tray (Windows) / menu bar (macOS) icon. Closing the window leaves the app working here.

use crate::api;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

const ID: &str = "main";
const NAME: &str = "hsk. Studio Companion";

pub fn show(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

pub fn status(app: &AppHandle, text: &str) {
    if let Some(tray) = app.tray_by_id(ID) {
        let _ = tray.set_tooltip(Some(format!("{NAME}: {text}")));
    }
}

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Deschide fereastra", true, None::<&str>)?;
    let site = MenuItem::with_id(app, "site", "Albumele mele pe hsk.photos", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Ieșire", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &site, &PredefinedMenuItem::separator(app)?, &quit])?;

    let mut tray = TrayIconBuilder::with_id(ID)
        .menu(&menu)
        .tooltip(NAME)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show(app),
            "site" => {
                let _ = app.opener().open_url(format!("{}/fotograf", api::base()), None::<&str>);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show(tray.app_handle());
            }
        });
    // the menu bar wants a one-colour glyph that follows light and dark; the Windows tray gets the app tile
    #[cfg(target_os = "macos")]
    {
        tray = tray.icon(tauri::include_image!("icons/tray.png")).icon_as_template(true);
    }
    #[cfg(not(target_os = "macos"))]
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}
