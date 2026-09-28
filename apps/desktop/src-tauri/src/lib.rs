//! Leuria desktop shell.
//!
//! The Rust side stays small: it runs the engine (a Bun-compiled sidecar,
//! the same engine as the `leuria` CLI) with a random admin token, keeps a
//! tray icon, and relays engine events to the window. Everything else,
//! onboarding, sign-in, sites, approvals, goes from the UI to the engine's
//! admin API.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{
    image::Image,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, RunEvent, WindowEvent,
};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};
use tauri_plugin_updater::UpdaterExt;

struct Engine {
    token: String,
    port: Mutex<Option<u16>>,
    child: Mutex<Option<CommandChild>>,
}

#[derive(Serialize, Clone)]
struct EngineInfo {
    port: Option<u16>,
    token: String,
}

/// Where the UI reaches the engine; `port` is null until the engine is ready.
#[tauri::command]
fn engine_info(engine: tauri::State<Engine>) -> EngineInfo {
    EngineInfo {
        port: *engine.port.lock().unwrap(),
        token: engine.token.clone(),
    }
}

/// The engine's admin token. Debug builds may take a fixed one from
/// `LEURIA_DEV_ADMIN_TOKEN` so the admin API can be exercised from a shell.
fn admin_token() -> String {
    #[cfg(debug_assertions)]
    if let Ok(token) = std::env::var("LEURIA_DEV_ADMIN_TOKEN") {
        if token.len() >= 32 {
            return token;
        }
    }
    random_token()
}

fn random_token() -> String {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).expect("no system randomness");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// macOS: show the Dock icon only while the window is open. With the
/// window closed, Leuria lives in the menu bar (Accessory policy).
fn set_dock_visible(app: &AppHandle, visible: bool) {
    #[cfg(target_os = "macos")]
    {
        let policy = if visible {
            tauri::ActivationPolicy::Regular
        } else {
            tauri::ActivationPolicy::Accessory
        };
        let _ = app.set_activation_policy(policy);
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, visible);
}

fn hide_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
    set_dock_visible(app, false);
}

fn show_main(app: &AppHandle) {
    set_dock_visible(app, true);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// `leuria://` links the window hasn't taken yet.
struct Links(Mutex<Vec<String>>);

/// Keep links for the window, bring it forward, and tell it.
fn keep_links(app: &AppHandle, urls: Vec<String>) {
    if urls.is_empty() {
        return;
    }
    app.state::<Links>().0.lock().unwrap().extend(urls);
    show_main(app);
    let _ = app.emit("deep-link", ());
}

/// The links received since the last call.
#[tauri::command]
fn take_links(links: tauri::State<'_, Links>) -> Vec<String> {
    std::mem::take(&mut *links.0.lock().unwrap())
}

/// Start the engine sidecar and relay its JSON-line events.
fn start_engine(app: &AppHandle) -> tauri::Result<()> {
    let engine = app.state::<Engine>();
    let (mut events, child) = app
        .shell()
        .sidecar("leuria-engine")
        .expect("leuria-engine sidecar is not bundled")
        // A debug build (`pnpm desktop`) gets no leuria:// links on macOS (only a bundled
        // app does): its engine lets a site's claim ask the visitor instead.
        .args(if cfg!(debug_assertions) { vec!["start", "--app", "--dev-pairing"] } else { vec!["start", "--app"] })
        .env("LEURIA_ADMIN_TOKEN", &engine.token)
        .spawn()
        .expect("failed to start the Leuria engine");
    *engine.child.lock().unwrap() = Some(child);

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let Ok(value) = serde_json::from_slice::<serde_json::Value>(&line) else {
                        continue;
                    };
                    match value["event"].as_str() {
                        Some("ready") => {
                            let port = value["port"].as_u64().map(|p| p as u16);
                            *app.state::<Engine>().port.lock().unwrap() = port;
                            let _ = app.emit("engine-ready", &value);
                        }
                        Some("pairing") => {
                            // A site asks to connect: bring the approval to the front.
                            show_main(&app);
                            let _ = app.emit("pairing", &value);
                        }
                        Some(kind) => {
                            let _ = app.emit(&format!("engine-{}", kind.replace('_', "-")), &value);
                        }
                        None => {}
                    }
                }
                CommandEvent::Stderr(line) => {
                    eprintln!("[engine] {}", String::from_utf8_lossy(&line).trim_end());
                }
                CommandEvent::Terminated(status) => {
                    let _ = app.emit("engine-exit", status.code);
                }
                _ => {}
            }
        }
    });
    Ok(())
}

/// The Leuria mark alone, as the system expects in the menu bar. On macOS
/// a template image: black with transparency, which macOS draws white on
/// a dark menu bar and dark on a light one. Elsewhere, the white mark.
#[cfg(target_os = "macos")]
const TRAY_ICON: &[u8] = include_bytes!("../icons/tray/tray-template@2x.png");
#[cfg(not(target_os = "macos"))]
const TRAY_ICON: &[u8] = include_bytes!("../icons/tray/tray-white.png");

/// One model in the tray's "Model" menu.
#[derive(Deserialize, Clone)]
struct TrayModel {
    id: String,
    name: String,
}

/// Menu item ids for models: `model:<id>`.
const MODEL_PREFIX: &str = "model:";

/// What the tray menu shows: the default AI's models, and an installed update.
#[derive(Default)]
struct TrayState {
    models: Vec<TrayModel>,
    current: Option<String>,
    /// The version installed in the background, applied on restart.
    update: Option<String>,
}

/// Open, a waiting update, the default AI's models (when it offers a choice), Quit.
fn tray_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let state = app.state::<Mutex<TrayState>>();
    let state = state.lock().unwrap();
    let (models, current) = (&state.models, state.current.as_deref());
    let menu = Menu::new(app)?;
    menu.append(&MenuItem::with_id(app, "open", "Open Leuria", true, None::<&str>)?)?;
    if state.update.is_some() {
        menu.append(&MenuItem::with_id(app, "update", "Restart to update Leuria", true, None::<&str>)?)?;
    }
    if models.len() > 1 {
        let submenu = Submenu::new(app, "Model", true)?;
        for model in models {
            let checked = current == Some(model.id.as_str());
            submenu.append(&CheckMenuItem::with_id(
                app,
                format!("{MODEL_PREFIX}{}", model.id),
                &model.name,
                true,
                checked,
                None::<&str>,
            )?)?;
        }
        menu.append(&PredefinedMenuItem::separator(app)?)?;
        menu.append(&submenu)?;
    }
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(app, "quit", "Quit Leuria", true, None::<&str>)?)?;
    Ok(menu)
}

/// Open a page in the browser: a sign-in page, or a connected site.
/// Web links only (a local site may be plain http); nothing else opens.
#[tauri::command]
fn open_link(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("only web links".into());
    }
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("/usr/bin/open").arg(&url).status();
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("rundll32").args(["url.dll,FileProtocolHandler", &url]).status();
    #[cfg(all(unix, not(target_os = "macos")))]
    let result = std::process::Command::new("xdg-open").arg(&url).status();
    result.map(|_| ()).map_err(|e| e.to_string())
}

/// "Restart Leuria" when the engine stopped: a fresh app starts a fresh engine.
#[tauri::command]
fn restart_app(app: AppHandle) {
    app.restart();
}

/// The window keeps the tray's model list in step with the default AI.
#[tauri::command]
fn set_tray_models(app: AppHandle, models: Vec<TrayModel>, current: Option<String>) -> Result<(), String> {
    {
        let state = app.state::<Mutex<TrayState>>();
        let mut state = state.lock().unwrap();
        state.models = models;
        state.current = current;
    }
    refresh_tray(&app).map_err(|e| e.to_string())
}

fn refresh_tray(app: &AppHandle) -> tauri::Result<()> {
    if let Some(tray) = app.tray_by_id("main") {
        tray.set_menu(Some(tray_menu(app)?))?;
    }
    Ok(())
}

/// How often a running Leuria looks for a new version.
const UPDATE_EVERY: std::time::Duration = std::time::Duration::from_secs(6 * 60 * 60);

/// Look for a new version soon after launch, then every few hours. A new one
/// installs in the background and applies on the next start; the tray offers
/// to restart now, so a conversation is never cut short.
fn watch_updates(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(20)).await;
        loop {
            match install_update(&app).await {
                Ok(Some(version)) => {
                    app.state::<Mutex<TrayState>>().lock().unwrap().update = Some(version.clone());
                    let _ = refresh_tray(&app);
                    let _ = app.emit("update-ready", serde_json::json!({ "version": version }));
                    return;
                }
                Ok(None) => {}
                Err(error) => eprintln!("[update] {error}"),
            }
            tokio::time::sleep(UPDATE_EVERY).await;
        }
    });
}

/// The version installed, if there was a newer one.
async fn install_update(app: &AppHandle) -> tauri_plugin_updater::Result<Option<String>> {
    let Some(update) = app.updater()?.check().await? else {
        return Ok(None);
    };
    update.download_and_install(|_, _| {}, || {}).await?;
    Ok(Some(update.version))
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let menu = tray_menu(app)?;
    TrayIconBuilder::with_id("main")
        .icon(Image::from_bytes(TRAY_ICON)?)
        .icon_as_template(cfg!(target_os = "macos"))
        .tooltip("Leuria: your AI for websites")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main(app),
            "update" => app.restart(),
            "quit" => app.exit(0),
            // The window applies it (engine call, tray refresh), even while hidden.
            id => {
                if let Some(model) = id.strip_prefix(MODEL_PREFIX) {
                    let _ = app.emit("tray-model", serde_json::json!({ "id": model }));
                }
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // One Leuria at a time: a second launch (or a leuria:// link) focuses the first.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main(app);
        }));
    }

    let app = builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .manage(Engine {
            token: admin_token(),
            port: Mutex::new(None),
            child: Mutex::new(None),
        })
        .manage(Links(Mutex::new(Vec::new())))
        .manage(Mutex::new(TrayState::default()))
        .invoke_handler(tauri::generate_handler![engine_info, set_tray_models, restart_app, open_link, take_links])
        .setup(|app| {
            build_tray(app.handle())?;
            start_engine(app.handle())?;
            // Development builds don't update themselves.
            if !cfg!(debug_assertions) {
                watch_updates(app.handle());
            }

            // leuria://connect links: kept until the window takes them, so a
            // link that started the app waits for the engine instead of being lost.
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                keep_links(app.handle(), urls.iter().map(|u| u.to_string()).collect());
            }
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                keep_links(&handle, event.urls().iter().map(|u| u.to_string()).collect());
            });

            // Started at login: stay in the menu bar, no window, no Dock icon.
            if std::env::args().any(|arg| arg == "--hidden") {
                hide_main(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window keeps Leuria running in the tray, without a Dock icon.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                hide_main(window.app_handle());
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Leuria");

    app.run(|app, event| match event {
        RunEvent::Exit => {
            if let Some(child) = app.state::<Engine>().child.lock().unwrap().take() {
                let _ = child.kill();
            }
        }
        // macOS: clicking the app again (Finder, Spotlight) reopens the window.
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => show_main(app),
        _ => {}
    });
}
